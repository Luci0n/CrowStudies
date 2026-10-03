"""Reference CHIP-8 interpreter: the 'emulator' that recompiled output is checked against.

Semantics are pinned down precisely because the recompiled C runtime (runtime.h)
must reproduce them bit-for-bit:
  * 500 instructions per frame, then DT/ST tick down once
  * sprites start position wraps, pixels clip at the edges
  * FX55/FX65 leave I unchanged; 8XY6/8XYE shift VX in place
  * CXNN uses a fixed LCG so runs are deterministic
"""
FONT = [
    0xF0, 0x90, 0x90, 0x90, 0xF0, 0x20, 0x60, 0x20, 0x20, 0x70,
    0xF0, 0x10, 0xF0, 0x80, 0xF0, 0xF0, 0x10, 0xF0, 0x10, 0xF0,
    0x90, 0x90, 0xF0, 0x10, 0x10, 0xF0, 0x80, 0xF0, 0x10, 0xF0,
    0xF0, 0x80, 0xF0, 0x90, 0xF0, 0xF0, 0x10, 0x20, 0x40, 0x40,
    0xF0, 0x90, 0xF0, 0x90, 0xF0, 0xF0, 0x90, 0xF0, 0x10, 0xF0,
    0xF0, 0x90, 0xF0, 0x90, 0x90, 0xE0, 0x90, 0xE0, 0x90, 0xE0,
    0xF0, 0x80, 0x80, 0x80, 0xF0, 0xE0, 0x90, 0x90, 0x90, 0xE0,
    0xF0, 0x80, 0xF0, 0x80, 0xF0, 0xF0, 0x80, 0xF0, 0x80, 0x80,
]
W, H = 64, 32
IPF = 500


def fnv1a(data):
    h = 0x811C9DC5
    for b in data:
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


class Chip8:
    def __init__(self, rom, seed=1):
        self.mem = bytearray(4096)
        self.mem[0:len(FONT)] = bytes(FONT)
        self.mem[0x200:0x200 + len(rom)] = rom
        self.V = [0] * 16
        self.I = 0
        self.pc = 0x200
        self.stack = []
        self.dt = self.st = 0
        self.fb = bytearray(W * H)
        self.keys = 0
        self.rng = seed

    def rand(self):
        self.rng = (self.rng * 1103515245 + 12345) & 0xFFFFFFFF
        return (self.rng >> 16) & 0xFF

    def draw(self, x, y, n):
        x0, y0 = self.V[x] % W, self.V[y] % H
        hit = 0
        for row in range(n):
            if y0 + row >= H:
                break
            bits = self.mem[(self.I + row) & 0xFFF]
            for col in range(8):
                if x0 + col >= W:
                    break
                if bits & (0x80 >> col):
                    i = (y0 + row) * W + x0 + col
                    hit |= self.fb[i]
                    self.fb[i] ^= 1
        self.V[0xF] = hit

    def step(self):
        m, V = self.mem, self.V
        op = m[self.pc] << 8 | m[self.pc + 1]
        self.pc += 2
        x, y = op >> 8 & 0xF, op >> 4 & 0xF
        nn, nnn = op & 0xFF, op & 0xFFF
        t = op >> 12
        if op == 0x00E0:
            self.fb[:] = bytes(W * H)
        elif op == 0x00EE:
            self.pc = self.stack.pop()
        elif t == 1:
            self.pc = nnn
        elif t == 2:
            self.stack.append(self.pc)
            self.pc = nnn
        elif t == 3:
            if V[x] == nn: self.pc += 2
        elif t == 4:
            if V[x] != nn: self.pc += 2
        elif t == 5:
            if V[x] == V[y]: self.pc += 2
        elif t == 6:
            V[x] = nn
        elif t == 7:
            V[x] = (V[x] + nn) & 0xFF
        elif t == 8:
            k = op & 0xF
            if k == 0: V[x] = V[y]
            elif k == 1: V[x] |= V[y]
            elif k == 2: V[x] &= V[y]
            elif k == 3: V[x] ^= V[y]
            elif k == 4:
                r = V[x] + V[y]; V[x] = r & 0xFF; V[0xF] = int(r > 0xFF)
            elif k == 5:
                f = int(V[x] >= V[y]); V[x] = (V[x] - V[y]) & 0xFF; V[0xF] = f
            elif k == 6:
                f = V[x] & 1; V[x] >>= 1; V[0xF] = f
            elif k == 7:
                f = int(V[y] >= V[x]); V[x] = (V[y] - V[x]) & 0xFF; V[0xF] = f
            elif k == 0xE:
                f = V[x] >> 7; V[x] = (V[x] << 1) & 0xFF; V[0xF] = f
        elif t == 9:
            if V[x] != V[y]: self.pc += 2
        elif t == 0xA:
            self.I = nnn
        elif t == 0xB:
            self.pc = nnn + V[0]
        elif t == 0xC:
            V[x] = self.rand() & nn
        elif t == 0xD:
            self.draw(x, y, op & 0xF)
        elif t == 0xE:
            down = bool(self.keys >> V[x] & 1)
            if (nn == 0x9E and down) or (nn == 0xA1 and not down): self.pc += 2
        elif t == 0xF:
            if nn == 0x07: V[x] = self.dt
            elif nn == 0x15: self.dt = V[x]
            elif nn == 0x18: self.st = V[x]
            elif nn == 0x1E: self.I = (self.I + V[x]) & 0xFFFF
            elif nn == 0x29: self.I = (V[x] & 0xF) * 5
            elif nn == 0x33:
                m[self.I], m[self.I + 1], m[self.I + 2] = V[x] // 100, V[x] // 10 % 10, V[x] % 10
            elif nn == 0x55: m[self.I:self.I + x + 1] = bytes(V[:x + 1])
            elif nn == 0x65: V[:x + 1] = list(m[self.I:self.I + x + 1])
            elif nn == 0x0A:
                if self.keys:
                    V[x] = (self.keys & -self.keys).bit_length() - 1
                else:
                    self.pc -= 2  # block until a key is down

    def frame(self, keys):
        self.keys = keys
        for _ in range(IPF):
            self.step()
        if self.dt: self.dt -= 1
        if self.st: self.st -= 1

    def state_hash(self):
        return fnv1a(bytes(self.fb) + bytes(self.V) + bytes([self.I & 0xFF, self.I >> 8]))

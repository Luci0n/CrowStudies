"""Static recompiler: CHIP-8 ROM -> C, the same idea N64Recomp / XenonRecomp use.

It never sees the assembly source, only ROM bytes. It finds code by following
control flow from the entry point, then turns every reachable instruction into
a labelled C statement. Mods attach as hooks: a C function called right before
the instruction at a given ROM address runs.

Usage: python3 recomp.py ROM PREFIX OUT.c [--hook ADDR:FUNC ...]
"""
import sys

ENTRY = 0x200


def fetch(rom, a):
    o = a - ENTRY
    return rom[o] << 8 | rom[o + 1]


def successors(op, a):
    """Where control can go after the instruction at a. None = computed target."""
    t, nn = op >> 12, op & 0xFF
    if op == 0x00EE: return []
    if t == 1: return [op & 0xFFF]
    if t == 2: return [op & 0xFFF, a + 2]  # callee, and the return site
    if t == 0xB: return None
    if t in (3, 4, 5, 9) or (t == 0xE and nn in (0x9E, 0xA1)): return [a + 2, a + 4]
    return [a + 2]


def discover(rom):
    seen, todo, unresolved = set(), [ENTRY], []
    while todo:
        a = todo.pop()
        if a in seen or not (ENTRY <= a < ENTRY + len(rom) - 1):
            continue
        seen.add(a)
        nxt = successors(fetch(rom, a), a)
        if nxt is None:
            unresolved.append(a)
        else:
            todo += nxt
    return sorted(seen), unresolved


def translate(op, a):
    x, y = op >> 8 & 0xF, op >> 4 & 0xF
    nn, nnn, t, k = op & 0xFF, op & 0xFFF, op >> 12, op & 0xF
    Vx, Vy = f"s->V[{x}]", f"s->V[{y}]"
    L = lambda n: f"goto L_{n:03X};"
    skip = lambda cond: f"if ({cond}) {L(a + 4)} else {L(a + 2)}"
    if op == 0x00E0: return "memset(s->fb, 0, sizeof s->fb);"
    if op == 0x00EE: return "s->pc = s->stack[--s->sp]; goto dispatch;"
    if t == 1: return L(nnn)
    if t == 2: return f"s->stack[s->sp++] = 0x{a + 2:03X}; {L(nnn)}"
    if t == 3: return skip(f"{Vx} == 0x{nn:02X}")
    if t == 4: return skip(f"{Vx} != 0x{nn:02X}")
    if t == 5: return skip(f"{Vx} == {Vy}")
    if t == 9: return skip(f"{Vx} != {Vy}")
    if t == 6: return f"{Vx} = 0x{nn:02X};"
    if t == 7: return f"{Vx} += 0x{nn:02X};"
    if t == 8:
        return {
            0: f"{Vx} = {Vy};", 1: f"{Vx} |= {Vy};", 2: f"{Vx} &= {Vy};", 3: f"{Vx} ^= {Vy};",
            4: f"{{ int r = {Vx} + {Vy}; {Vx} = r; s->V[15] = r > 0xFF; }}",
            5: f"{{ int f = {Vx} >= {Vy}; {Vx} -= {Vy}; s->V[15] = f; }}",
            6: f"{{ int f = {Vx} & 1; {Vx} >>= 1; s->V[15] = f; }}",
            7: f"{{ int f = {Vy} >= {Vx}; {Vx} = {Vy} - {Vx}; s->V[15] = f; }}",
            0xE: f"{{ int f = {Vx} >> 7; {Vx} <<= 1; s->V[15] = f; }}",
        }[k]
    if t == 0xA: return f"s->I = 0x{nnn:03X};"
    if t == 0xB: return f"s->pc = 0x{nnn:03X} + s->V[0]; goto dispatch;"
    if t == 0xC: return f"{Vx} = c8_rand(s) & 0x{nn:02X};"
    if t == 0xD: return f"c8_draw(s, {x}, {y}, {k});"
    if t == 0xE and nn == 0x9E: return skip(f"s->keys >> {Vx} & 1")
    if t == 0xE and nn == 0xA1: return skip(f"!(s->keys >> {Vx} & 1)")
    if t == 0xF:
        return {
            0x07: f"{Vx} = s->dt;", 0x15: f"s->dt = {Vx};", 0x18: f"s->st = {Vx};",
            0x1E: f"s->I += {Vx};", 0x29: f"s->I = ({Vx} & 0xF) * 5;",
            0x33: f"s->mem[s->I] = {Vx} / 100; s->mem[s->I + 1] = {Vx} / 10 % 10; s->mem[s->I + 2] = {Vx} % 10;",
            0x55: f"memcpy(s->mem + s->I, s->V, {x + 1});",
            0x65: f"memcpy(s->V, s->mem + s->I, {x + 1});",
            0x0A: f"if (!s->keys) {L(a)} {Vx} = __builtin_ctz(s->keys);",
        }[nn]
    raise ValueError(f"unsupported opcode {op:04X} at {a:03X}")


def recompile(rom, prefix, hooks):
    addrs, unresolved = discover(rom)
    out = [
        f"/* Recompiled from ROM by recomp.py: {len(addrs)} instructions. */",
        '#include "runtime.h"',
        f"const unsigned char {prefix}_rom[] = {{{', '.join(str(b) for b in rom)}}};",
        f"const unsigned {prefix}_rom_len = {len(rom)};",
    ]
    out += [f"void {fn}(chip8_t *s);" for fns in hooks.values() for fn in fns]
    out += [f"void {prefix}_frame(chip8_t *s) {{", "  int budget = IPF;", "dispatch:", "  switch (s->pc) {"]
    out += [f"  case 0x{a:03X}: goto L_{a:03X};" for a in addrs]
    out += ['  default: fprintf(stderr, "' + prefix + ': jumped to unrecompiled code at %03X\\n", s->pc); abort();', "  }"]
    for i, a in enumerate(addrs):
        op = fetch(rom, a)
        out.append(f"L_{a:03X}: if (budget-- == 0) {{ s->pc = 0x{a:03X}; return; }}  /* {op:04X} */")
        for fn in hooks.get(a, []):
            out.append(f"  {fn}(s);  /* mod hook */")
        body = translate(op, a)
        nxt = addrs[i + 1] if i + 1 < len(addrs) else None
        succ = successors(op, a)
        if succ == [a + 2] and nxt != a + 2:
            body += f" goto L_{a + 2:03X};"
        out.append("  " + body)
    out.append("}")
    if unresolved:
        print(f"warning: computed jumps at {[hex(u) for u in unresolved]}", file=sys.stderr)
    return "\n".join(out) + "\n", addrs


if __name__ == "__main__":
    rom_path, prefix, out_path = sys.argv[1:4]
    hooks = {}
    args = sys.argv[4:]
    for i, arg in enumerate(args):
        if arg == "--hook":
            addr, fn = args[i + 1].split(":")
            hooks.setdefault(int(addr, 16), []).append(fn)
    rom = open(rom_path, "rb").read()
    src, addrs = recompile(rom, prefix, hooks)
    open(out_path, "w").write(src)
    print(f"{out_path}: {len(addrs)} instructions recompiled, {len(hooks)} hook site(s)")

"""Minimal CHIP-8 assembler, just enough to write our two test games.

Usage: python3 asm.py games/dodge.asm build/dodge.ch8
"""
import re
import sys


def reg(tok):
    m = re.fullmatch(r"V([0-9A-F])", tok.upper())
    return int(m.group(1), 16) if m else None


def num(tok, labels):
    tok = tok.strip()
    if tok in labels:
        return labels[tok]
    v = int(tok, 0)
    return v & 0xFF if v < 0 else v


def encode(op, args, labels):
    a = [x.strip() for x in args]
    R = [reg(x) for x in a]
    op = op.upper()
    if op == "CLS": return 0x00E0
    if op == "RET": return 0x00EE
    if op == "JP":
        if len(a) == 2: return 0xB000 | num(a[1], labels)
        return 0x1000 | num(a[0], labels)
    if op == "CALL": return 0x2000 | num(a[0], labels)
    if op in ("SE", "SNE"):
        if R[1] is not None:
            return (0x5000 if op == "SE" else 0x9000) | R[0] << 8 | R[1] << 4
        return (0x3000 if op == "SE" else 0x4000) | R[0] << 8 | num(a[1], labels)
    if op == "ADD":
        if a[0].upper() == "I": return 0xF01E | R[1] << 8
        if R[1] is not None: return 0x8004 | R[0] << 8 | R[1] << 4
        return 0x7000 | R[0] << 8 | num(a[1], labels)
    alu = {"OR": 1, "AND": 2, "XOR": 3, "SUB": 5, "SHR": 6, "SUBN": 7, "SHL": 0xE}
    if op in alu:
        y = R[1] if len(R) > 1 and R[1] is not None else 0
        return 0x8000 | R[0] << 8 | y << 4 | alu[op]
    if op == "RND": return 0xC000 | R[0] << 8 | num(a[1], labels)
    if op == "DRW": return 0xD000 | R[0] << 8 | R[1] << 4 | num(a[2], labels)
    if op == "SKP": return 0xE09E | R[0] << 8
    if op == "SKNP": return 0xE0A1 | R[0] << 8
    if op == "LD":
        d, s = a[0].upper(), a[1].upper()
        if d == "I": return 0xA000 | num(a[1], labels)
        if d == "DT": return 0xF015 | R[1] << 8
        if d == "ST": return 0xF018 | R[1] << 8
        if d == "F": return 0xF029 | R[1] << 8
        if d == "B": return 0xF033 | R[1] << 8
        if d == "[I]": return 0xF055 | R[1] << 8
        if s == "[I]": return 0xF065 | R[0] << 8
        if s == "DT": return 0xF007 | R[0] << 8
        if s == "K": return 0xF00A | R[0] << 8
        if R[1] is not None: return 0x8000 | R[0] << 8 | R[1] << 4
        return 0x6000 | R[0] << 8 | num(a[1], labels)
    raise ValueError(f"unknown instruction {op} {args}")


def assemble(src):
    lines = []
    for raw in src.splitlines():
        line = raw.split(";")[0].strip()
        if line:
            lines.append(line)
    # pass 1: label addresses
    labels, addr = {}, 0x200
    for line in lines:
        if line.endswith(":"):
            labels[line[:-1]] = addr
        elif line.upper().startswith("DB "):
            addr += len(line[3:].split(","))
        else:
            addr += 2
    # pass 2: emit
    out = bytearray()
    for line in lines:
        if line.endswith(":"):
            continue
        if line.upper().startswith("DB "):
            out += bytes(num(x, labels) for x in line[3:].split(","))
            continue
        parts = line.split(None, 1)
        args = parts[1].split(",") if len(parts) > 1 else []
        word = encode(parts[0], args, labels)
        out += bytes([word >> 8, word & 0xFF])
    return bytes(out), labels


if __name__ == "__main__":
    rom, labels = assemble(open(sys.argv[1]).read())
    open(sys.argv[2], "wb").write(rom)
    print(f"{sys.argv[2]}: {len(rom)} bytes")

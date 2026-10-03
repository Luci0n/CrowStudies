"""Reverse-engineer hook points from ROM bytes only (no source, no labels).

Two techniques modders use on real games, scaled down:
  1. Memory scanning (Cheat Engine style): play the game, record every
     register each frame, keep the ones that behave like a counter.
  2. Cross-referencing the disassembly: find the instructions that write the
     counter (the "event" site) and draw-then-test-VF pairs (collision checks).

Usage: python3 re_scan.py ROM [--json]
"""
import json
import sys

from chip8 import Chip8
from difftest import key_script
from recomp import discover, fetch


def disasm(op):
    x, y, nn, nnn, t = op >> 8 & 0xF, op >> 4 & 0xF, op & 0xFF, op & 0xFFF, op >> 12
    names = {1: f"JP {nnn:03X}", 2: f"CALL {nnn:03X}", 3: f"SE V{x:X}, {nn}", 4: f"SNE V{x:X}, {nn}",
             6: f"LD V{x:X}, {nn}", 7: f"ADD V{x:X}, {nn}", 0xA: f"LD I, {nnn:03X}",
             0xC: f"RND V{x:X}, {nn:#x}", 0xD: f"DRW V{x:X}, V{y:X}, {op & 0xF}"}
    if op == 0x00E0: return "CLS"
    if op == 0x00EE: return "RET"
    return names.get(t, f"{op:04X}")


def find_counters(rom, frames=900):
    vm = Chip8(rom)
    history = []
    for k in key_script(frames, seed=3):
        vm.frame(k)
        history.append(list(vm.V))
    counters = []
    for r in range(15):
        vals = [h[r] for h in history]
        steps = [(a, b) for a, b in zip(vals, vals[1:]) if a != b]
        ups = sum(1 for a, b in steps if b == a + 1)
        resets = sum(1 for a, b in steps if b == 0)
        # A score/counter only ever goes up by one, or resets to zero.
        if ups >= 3 and ups + resets == len(steps):
            counters.append({"reg": r, "increments": ups, "resets": resets, "max": max(vals)})
    return counters


def scan(rom):
    addrs, _ = discover(rom)
    code = {a: fetch(rom, a) for a in addrs}
    counters = find_counters(rom)
    result = {"counters": counters, "increment_sites": [], "collision_checks": []}
    for c in counters:
        for a, op in code.items():
            if op == 0x7001 | c["reg"] << 8:  # ADD Vr, 1
                result["increment_sites"].append({"addr": a, "reg": c["reg"]})
    for a, op in code.items():
        nxt = code.get(a + 2)
        # DRW followed by SE VF,0 / SNE VF,0: game reacts to a sprite collision
        if op >> 12 == 0xD and nxt in (0x3F00, 0x4F00):
            result["collision_checks"].append({"draw_addr": a, "test_addr": a + 2,
                                               "x_reg": op >> 8 & 0xF, "y_reg": op >> 4 & 0xF})
    return result, code


if __name__ == "__main__":
    rom = open(sys.argv[1], "rb").read()
    result, code = scan(rom)
    if "--json" in sys.argv:
        print(json.dumps(result))
        sys.exit()
    print(f"== {sys.argv[1]}: {len(code)} reachable instructions")
    for c in result["counters"]:
        print(f"  counter-like register V{c['reg']:X}: +1 x{c['increments']}, reset x{c['resets']}, peak {c['max']}")
    for s in result["increment_sites"]:
        print(f"  {s['addr']:03X}: {disasm(code[s['addr']]):16} <- event site (writes V{s['reg']:X})")
    for s in result["collision_checks"]:
        a = s["draw_addr"]
        print(f"  {a:03X}: {disasm(code[a]):16} then {disasm(code[a + 2])} <- collision check")

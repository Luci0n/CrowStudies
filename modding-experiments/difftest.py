"""Differential test: recompiled native binary vs reference interpreter, frame by frame.

Usage: python3 difftest.py ROM BINARY [FRAMES]
"""
import random
import subprocess
import sys

from chip8 import Chip8


def key_script(frames, seed=7):
    rng = random.Random(seed)
    keys, held = [], 0
    for _ in range(frames):
        if rng.random() < 0.15:
            held = rng.choice([0, 1 << 4, 1 << 6])
        keys.append(held)
    return keys


def main():
    rom = open(sys.argv[1], "rb").read()
    binary = sys.argv[2]
    frames = int(sys.argv[3]) if len(sys.argv) > 3 else 600
    keys = key_script(frames)
    ref = Chip8(rom)
    expected = []
    for k in keys:
        ref.frame(k)
        expected.append(f"{ref.state_hash():08x}")
    got = subprocess.run([binary], input="\n".join(f"{k:x}" for k in keys),
                         capture_output=True, text=True, check=True).stdout.split()
    for i, (e, g) in enumerate(zip(expected, got)):
        if e != g:
            print(f"MISMATCH at frame {i}: interpreter {e}, recompiled {g}")
            sys.exit(1)
    print(f"{sys.argv[1]}: {len(got)}/{frames} frames match the interpreter")


if __name__ == "__main__":
    main()

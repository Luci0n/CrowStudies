# Recomp & mashup experiment

**Part 2 (real game): [quake3/](quake3/README.md)**: OpenArena's game logic statically recompiled and diff-tested
against ioquake3's interpreter, reverse-engineered from the stripped binary (17/17 graded), and mashed up with
ClassiCube's block physics. AI-assisted RE tools usable in this cloud container are surveyed in [TOOLS.md](TOOLS.md).

A small, fully legal version of the pipeline behind 2026's "whole games inside other games" mods.
Both games are original ones written here; the tools only use their ROM bytes.

```
games/*.asm --asm.py--> ROM --recomp.py--> C --gcc--> native port
                          |                               ^ diff-tested frame by frame
                          |                               | against chip8.py (the "emulator")
                          +--re_scan.py--> hook addresses -+--> recomp.py --hook ... --> mashup.c
```

Run everything: `python3 build.py` (needs gcc and Pillow). Output: `out/dodgeball.gif`.

| File | Real-world counterpart |
|---|---|
| `chip8.py` | Emulator, used as ground truth |
| `recomp.py` | N64Recomp / XenonRecomp / ReXGlue: ROM → C with no decompilation |
| `difftest.py` | Decomp "matching": proving the port behaves the same as the original |
| `re_scan.py` | Cheat Engine memory scan + Ghidra cross-references |
| `mashup.c` | DLL-injection / recomp mod-loader hooks that bridge two games |

## Results

- Both recompiled games match the interpreter on **900/900 frames** (framebuffer + registers + I hashed each frame).
- `re_scan.py` found Dodge's score register (V3), its increment site (`240`), and the collision test (`214`/`216`)
  from bytes alone. It also produced a realistic **false positive** (V2, the rock's Y coordinate, behaves like
  a counter). It was filtered out because no `ADD V2, 1` instruction writes it.
- **DODGEBALL**: Bounce's ball is injected into Dodge as a hazard (setting VF so *Dodge's own* hit code runs),
  and each dodged rock speeds up Bounce. A/B check over 600 frames: final Dodge score 19 without the ball
  hazard, 0 with it, so the cross-game mechanic changes play.
- The panels agree on the ball's position on 595/600 frames. The other 5 are a one-tick lag: the two game
  loops are not synchronised to each other.

## What this shows about the real trend

1. **Once a game is C functions, it can be linked with another game.** Two recompiled games become two
   functions in one process, and hooks can read and write each other's state. That is the step that makes
   cross-game mashups possible, rather than just reskins.
2. **The hard part is semantics, not code.** Finding *which* register is "the ball" and *where* a collision is
   decided took the RE pass. AI agents speed that up (Snowboard Kids was decompiled in 84 days), but the human
   judgement in step 1 is where bad mashups go wrong (Kotaku's complaint: mechanics that don't interact).
3. **Timing is the next problem.** The flicker and one-tick lag here are tiny versions of the frame-pacing
   problems that make vibe-coded recomps hard to maintain.

## Limits

No self-modifying code, and computed jumps (`BNNN`) are only reported. Real recompilers also face these on
N64 (overlays) and 360 (jump tables).

"""Full pipeline: assemble -> recompile -> diff-test -> RE scan -> mashup build -> GIF."""
import json
import subprocess

from PIL import Image


def sh(*cmd, **kw):
    print("$", " ".join(cmd))
    return subprocess.run(cmd, check=True, **kw)


GCC = ["gcc", "-O2", "-Wall", "-I."]

# 1. Build both games as stand-alone recompiled ports and verify them.
for g in ("dodge", "bounce"):
    sh("python3", "asm.py", f"games/{g}.asm", f"build/{g}.ch8")
    sh("python3", "recomp.py", f"build/{g}.ch8", g, f"build/{g}.c")
    sh(*GCC, f"-DGAME={g}", "single.c", f"build/{g}.c", "-o", f"build/{g}")
    sh("python3", "difftest.py", f"build/{g}.ch8", f"build/{g}", "900")

# 2. Locate hook points from the ROM bytes alone.
scan = json.loads(sh("python3", "re_scan.py", "build/dodge.ch8", "--json",
                     capture_output=True, text=True).stdout)
collision = scan["collision_checks"][0]["test_addr"]
score = scan["increment_sites"][0]["addr"]


def timer_write(rom_path):
    from recomp import discover, fetch
    rom = open(rom_path, "rb").read()
    return next(a for a in discover(rom)[0] if fetch(rom, a) & 0xF0FF == 0xF015)  # LD DT, Vx


present = {g: timer_write(f"build/{g}.ch8") for g in ("dodge", "bounce")}
print(f"hooks: present @ {present}")
print(f"hooks: ball hazard @ {collision:03X}, score bridge @ {score:03X}")

# 3. Recompile both again with the mod hooks; link both games into one binary.
sh("python3", "recomp.py", "build/dodge.ch8", "dodge", "build/dodge_modded.c",
   "--hook", f"{collision:x}:hook_ball_hazard", "--hook", f"{score:x}:hook_score",
   "--hook", f"{present['dodge']:x}:hook_present_dodge")
sh("python3", "recomp.py", "build/bounce.ch8", "bounce", "build/bounce_modded.c",
   "--hook", f"{present['bounce']:x}:hook_present_bounce")
sh(*GCC, "mashup.c", "build/dodge_modded.c", "build/bounce_modded.c", "-o", "build/dodgeball")

# 4. Run it and render a GIF.
frames = 600
raw = sh("./build/dodgeball", str(frames), capture_output=True).stdout
W, H, S = 128, 32, 5
imgs = []
for f in range(0, frames, 2):
    chunk = raw[f * W * H:(f + 1) * W * H]
    img = Image.new("RGB", (W * S + S, H * S))
    px = img.load()
    for y in range(H):
        for x in range(W):
            on = chunk[y * W + x]
            col = (240, 200, 90) if x < 64 else (110, 200, 240)
            c = col if on else (24, 22, 30)
            ox = x * S + (S if x >= 64 else 0)
            for dy in range(S):
                for dx in range(S):
                    px[ox + dx, y * S + dy] = c
    for y in range(H * S):
        for dx in range(S):
            px[64 * S + dx, y] = (90, 90, 100)
    imgs.append(img)
imgs[0].save("out/dodgeball.gif", save_all=True, append_images=imgs[1:], duration=33, loop=0)
print("wrote out/dodgeball.gif")

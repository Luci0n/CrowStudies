#!/usr/bin/env python3
"""BLOCKFORT A/B analysis and top-down GIF.

usage: analyze.py on_events.log off_events.log snapshots.bin on_server.out off_server.out out.gif

on/off events come from BLOCKFORT_LOG with and without BLOCKFORT_OFF; snapshots.bin from
`bw_replay bf.rec snapshots.bin 10` (the block world every 10 ticks = 0.5 s, re-simulated from the
recording, not taken from the mashup process).
"""
import sys, re, struct
from collections import Counter

W, H, L, CELL = 15, 10, 15, 32.0
# classic blocks with COLLIDE_SOLID, minus bedrock (it marks the map's own walls, where players never are)
SOLID = {1, 2, 3, 4, 5, 12, 13, 17, 18, 19, 20, 45, 46, 49}
PMINS, PMAXS = (-15, -15, -24), (15, 15, 32)                     # Quake 3 standing player box


def read_events(path):
    pos, ev, base = {}, [], None
    for line in open(path):
        t, rest = line.split(" ", 1)
        t = int(t)
        if rest.startswith("pos"):
            pos[t] = [(int(c), tuple(map(float, xyz.split(",")))) for c, xyz in
                      (p.split(":") for p in rest.split()[1:])]
        else:
            ev.append((t, rest.strip()))
            m = re.match(r"fort built at (\S+) (\S+) (\S+)", rest)
            if m:
                base = tuple(map(float, m.groups()))
    return pos, ev, base


def read_snaps(path):
    d, out, n = open(path, "rb").read(), {}, W * H * L
    for k in range(0, len(d), 4 + n):
        t = struct.unpack_from("<i", d, k)[0]
        out[t] = d[k + 4:k + 4 + n]
    return out


def tick_of(ms):          # the fort is built, and ticks 1, at levelTime 3000; 20 ticks/s
    return (ms - 3000) // 50 + 1


def solid_overlaps(world, base, p):
    """cells of `world` that are solid and overlap the player box by more than 1 unit"""
    hits = 0
    for y in range(H):
        for z in range(L):
            for x in range(W):
                if world[(y * L + z) * W + x] not in SOLID:
                    continue
                lo = (base[0] + x * CELL, base[1] + z * CELL, base[2] + y * CELL)
                if all(p[k] + PMAXS[k] > lo[k] + 1 and p[k] + PMINS[k] < lo[k] + CELL - 1 for k in range(3)):
                    hits += 1
    return hits


def kills(path):
    c = Counter()
    for l in open(path):
        if l.startswith("Kill:"):
            c[l.split(" by ")[-1].strip()] += 1
    return c


def main():
    on, off, snapf, on_out, off_out, gif = sys.argv[1:7]
    pos_on, ev_on, base = read_events(on)
    pos_off, _, _ = read_events(off)
    snaps = read_snaps(snapf)
    first = snaps[min(snaps)]
    def world_at(ms):
        t = tick_of(ms)
        k = max([s for s in snaps if s <= t] or [min(snaps)])
        return snaps[k]
    # 1. are blocks solid to Quake players?
    stats = {}
    for name, pos, worldfn in (("with BLOCKFORT", pos_on, world_at), ("without (same layout, not solid)", pos_off, lambda ms: first)):
        samples = inside = 0
        for ms, ps in pos.items():
            if ms < 3500 or ms > 120000:      # first 2 minutes: the fort is still mostly intact
                continue
            w = worldfn(ms)
            for c, p in ps:
                samples += 1
                inside += solid_overlaps(w, base, p) > 0
        stats[name] = (inside, samples)
        print("%-34s player samples inside a solid block: %d / %d" % (name, inside, samples))
    # 2. what the block world did
    kinds = Counter(e.split()[0] for _, e in ev_on)
    broken = sum(int(re.search(r"broke (\d+)", e).group(1)) for _, e in ev_on if e.startswith("blast"))
    print("events:", dict(kinds), " blocks broken by Quake explosions:", broken)
    final = snaps[max(snaps)]
    print("cells inside map geometry (bedrock): %d" % sum(b == 7 for b in first))
    print("blocks at start: %d solid, %d lava; at end: %d solid, %d lava" % (
        sum(b in SOLID for b in first), sum(b in (10, 11) for b in first),
        sum(b in SOLID for b in final), sum(b in (10, 11) for b in final)))
    # 3. kills by cause, A/B
    kon, koff = kills(on_out), kills(off_out)
    print("kills by cause (without -> with):")
    for m in sorted(set(kon) | set(koff), key=lambda m: -(kon[m] + koff[m])):
        print("   %-20s %3d -> %3d" % (m, koff[m], kon[m]))
    make_gif(pos_on, snaps, base, ev_on, gif)


COLORS = {0: None, 5: (176, 132, 76), 12: (226, 210, 140), 13: (130, 125, 120), 20: (190, 230, 240),
          8: (60, 110, 230), 9: (60, 110, 230), 10: (240, 90, 20), 11: (240, 90, 20), 46: (220, 40, 40),
          7: (70, 70, 78)}


def make_gif(pos, snaps, base, ev, path):
    from PIL import Image, ImageDraw
    S, M = 14, 12                    # px per block, margin in blocks around the 15x15 world
    size = (W + 2 * M) * S
    blasts = [(t, e) for t, e in ev if e.startswith("blast") or e.startswith("tnt")]
    frames = []
    for t in sorted(snaps):
        ms = 3000 + 50 * (t - 1)
        if t % 20:                   # one frame per second of game time
            continue
        world = snaps[t]
        im = Image.new("RGB", (size, size + 18), (24, 26, 30))
        d = ImageDraw.Draw(im)
        for z in range(L):
            for x in range(W):
                # map walls (bedrock at player height) in grey; otherwise the highest ClassiCube block
                top = 7 if world[(1 * L + z) * W + x] == 7 else 0
                for y in range(H - 1, -1, -1):
                    b = world[(y * L + z) * W + x]
                    if top or not b or b == 7:
                        continue
                    top = b; break
                col = COLORS.get(top, (150, 150, 150)) if top else (40, 44, 50)
                px, py = (x + M) * S, (W + 2 * M - 1 - (z + M)) * S
                d.rectangle([px, py, px + S - 2, py + S - 2], fill=col)
        near = min(pos, key=lambda k: abs(k - ms)) if pos else None
        for c, p in pos.get(near, []):
            gx, gz = (p[0] - base[0]) / CELL + M, (p[1] - base[1]) / CELL + M
            if 0 <= gx < W + 2 * M and 0 <= gz < W + 2 * M:
                px, py = gx * S, (W + 2 * M - gz) * S
                d.ellipse([px - 4, py - 4, px + 4, py + 4], fill=(255, 255, 255))
        for bt, e in blasts:
            if 0 <= ms - bt < 1000:
                m = re.search(r"at (\S+) (\S+)", e)
                if m and e.startswith("blast"):
                    gx, gz = (float(m.group(1)) - base[0]) / CELL + M, (float(m.group(2)) - base[1]) / CELL + M
                    d.ellipse([gx * S - 20, (W + 2 * M - gz) * S - 20, gx * S + 20, (W + 2 * M - gz) * S + 20], outline=(255, 200, 0), width=3)
        d.text((6, size + 3), "BLOCKFORT  t=%3ds  ClassiCube blocks in OpenArena  (white: bots)" % (ms // 1000), fill=(220, 220, 220))
        frames.append(im)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=120, loop=0)
    print("wrote %s (%d frames)" % (path, len(frames)))


if __name__ == "__main__":
    main()

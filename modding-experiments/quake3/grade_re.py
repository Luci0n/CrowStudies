#!/usr/bin/env python3
"""Grade qvm_re.py's identifications against real symbols.

usage: grade_re.py shipped.qvm ref.qvm ref.map re.json

ref.qvm/ref.map are rebuilt from the GPL OpenArena gamecode (commit ddb8819, the closest source to
the 0.8.8 release: same data/lit/bss sizes, 14 instructions shorter). Functions are aligned between
the two binaries by opcode shape, then the symbol for each shipped function is read from the map.
"""
import sys, json, difflib, hashlib
from qvmrecomp import load_qvm, split_functions


def shapes(path):
    ins, _, _ = load_qvm(path)
    out = []
    for lo, hi in split_functions(ins):
        # opcodes plus syscall numbers; drop addresses that move between builds
        sig = " ".join(n + (str(a) if n == "CONST" and a is not None and a < 0 else "") for n, a, _ in ins[lo:hi])
        out.append((lo, hashlib.md5(sig.encode()).hexdigest(), sig))
    return out


def main():
    ship, ref, mapf, rej = sys.argv[1:5]
    S, R = shapes(ship), shapes(ref)
    _, _, rh = load_qvm(ref)
    # q3asm map addresses are relative to their segment: 1 data, 2 lit, 3 bss
    segbase = {"1": 0, "2": rh["dlen"], "3": rh["dlen"] + rh["llen"]}
    names, data = {}, {}
    for line in open(mapf):
        seg, addr, name = line.split()
        if seg == "0":
            names[int(addr, 16)] = name
        elif seg in segbase:
            data[segbase[seg] + int(addr, 16)] = name
    sm = difflib.SequenceMatcher(None, [h for _, h, _ in S], [h for _, h, _ in R], autojunk=False)
    truth, exact = {}, 0
    for tag, a0, a1, b0, b1 in sm.get_opcodes():
        if tag == "equal":
            for k in range(a1 - a0):
                truth[S[a0 + k][0]] = names.get(R[b0 + k][0]); exact += 1
        elif tag == "replace":
            # changed functions: pair by best shape similarity inside the region
            for k in range(a0, a1):
                best = max(range(b0, b1), key=lambda j: difflib.SequenceMatcher(None, S[k][2], R[j][2]).quick_ratio())
                truth[S[k][0]] = names.get(R[best][0]) + "?"
    print("aligned %d/%d shipped functions exactly, %d by similarity" % (exact, len(S), len(truth) - exact))
    found = json.load(open(rej))["found"]
    ok = 0
    for name, addr in sorted(found.items(), key=lambda kv: kv[1]):
        if name == "sizeof(gentity_t)":
            continue   # checked against the headers by the mod build instead
        # data symbols: the ref build has identical data/lit/bss sizes, so addresses line up
        t = data.get(addr, "<no symbol>") if name.islower() and name.startswith("g_") else truth.get(addr, "<unaligned>")
        good = t.rstrip("?") == name
        ok += good
        print("  %-18s %-8s truth: %-22s %s" % (name, addr, t, "OK" if good else "WRONG"))
    print("%d/%d identifications correct" % (ok, len([k for k in found if k != "sizeof(gentity_t)"])))


if __name__ == "__main__":
    main()

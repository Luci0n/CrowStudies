#!/usr/bin/env python3
"""Mutation test for the difftest: does a single wrong operation in executed code get caught?

usage: mutate.py <generated aot dir> <icoverage.txt> <outdir> <n> [seed]
Writes <outdir>/mutN/ copies of the generated C, each with one arithmetic or comparison operator
swapped in a QVM instruction that the coverage run (QVM_AOT_ICOVERAGE) showed was executed. build each with build_aot.sh's
compile step and difftest it; a mutant that leaves every hash unchanged "survives".
"""
import glob, os, random, re, shutil, sys, json

SWAPS = [(" + ", " - "), (" - ", " + "), (") * F(", ") + F("), (") + F(", ") - F("),
         (" < ", " <= "), (" <= ", " < "), (" > ", " >= "), (" >= ", " > "), (" == ", " != "), (" != ", " == ")]


def main():
    src, cov, out, n = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
    rnd = random.Random(int(sys.argv[5]) if len(sys.argv) > 5 else 1)
    hit = {int(a) for a, c in (l.split() for l in open(cov)) if int(c) > 0}
    sites = []   # (file, line number, swap, instruction)
    for f in sorted(glob.glob(os.path.join(src, "aot_[0-9]*.c"))):
        cur = None
        for ln, line in enumerate(open(f).read().split("\n")):
            m = re.match(r"/\*@(\d+)\*/", line)
            if m:
                cur = int(m.group(1))
            elif cur in hit and line.startswith("  ") and "ps -= " not in line and "ps + " not in line:
                for a, b in SWAPS:
                    if a in line:
                        sites.append((f, ln, a, b, cur))
                        break
    picks = rnd.sample(sites, n)
    manifest = []
    for k, (f, ln, a, b, fn) in enumerate(picks):
        d = os.path.join(out, "mut%d" % k)
        shutil.rmtree(d, ignore_errors=True)
        shutil.copytree(src, d, ignore=shutil.ignore_patterns("*.o"))
        p = os.path.join(d, os.path.basename(f))
        lines = open(p).read().split("\n")
        old = lines[ln]
        lines[ln] = old.replace(a, b, 1)
        open(p, "w").write("\n".join(lines))
        manifest.append(dict(mutant=k, instruction=fn, before=old.strip(), after=lines[ln].strip()))
    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=1)
    print("%d candidate sites in executed functions; wrote %d mutants" % (len(sites), n))


if __name__ == "__main__":
    main()

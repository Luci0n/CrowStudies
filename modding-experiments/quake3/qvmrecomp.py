#!/usr/bin/env python3
"""Static recompiler: Quake 3 QVM bytecode -> C (an ahead-of-time backend for ioquake3).

Same idea as recomp.py for CHIP-8, at real-game scale: every QVM function becomes a C function,
the QVM operand stack becomes C locals, and VM memory stays the engine's own data image, so
syscalls, pointers and saved games work unchanged. The generated code must leave VM memory
*byte-identical* to ioq3's interpreter (vm_interpreted.c), including the return addresses and
syscall numbers that the interpreter writes into the VM stack, because difftest compares a hash
of the whole image after every call.

usage: qvmrecomp.py game.qvm outdir [--chunks N] [--hook FUNC_INDEX=c_name ...]

--hook makes calls to that QVM function go through `c_name(ps, orig)` (declared by the mod), so a
mod can run code before/after or instead of the original. This is the recompiled-mod-loader trick.
"""
import struct, sys, os, argparse
from collections import defaultdict

OPS = ("UNDEF IGNORE BREAK ENTER LEAVE CALL PUSH POP CONST LOCAL JUMP "
       "EQ NE LTI LEI GTI GEI LTU LEU GTU GEU EQF NEF LTF LEF GTF GEF "
       "LOAD1 LOAD2 LOAD4 STORE1 STORE2 STORE4 ARG BLOCK_COPY "
       "SEX8 SEX16 NEGI ADD SUB DIVI DIVU MODI MODU MULI MULU BAND BOR BXOR BCOM "
       "LSH RSHI RSHU NEGF ADDF SUBF DIVF MULF CVIF CVFI").split()
OP = {n: i for i, n in enumerate(OPS)}
WORD_OPERAND = {"ENTER", "CONST", "LOCAL", "LEAVE", "BLOCK_COPY"} | set(OPS[OP["EQ"]:OP["GEF"] + 1])
BRANCHES = set(OPS[OP["EQ"]:OP["GEF"] + 1])
MAX_VMMAIN_ARGS, MAX_VMSYSCALL_ARGS = 13, 16

# stack effect for straight-line ops (branches, CALL, JUMP, LEAVE handled separately)
EFFECT = {"BREAK": 0, "ENTER": 0, "PUSH": 1, "POP": -1, "CONST": 1, "LOCAL": 1,
          "LOAD1": 0, "LOAD2": 0, "LOAD4": 0, "STORE1": -2, "STORE2": -2, "STORE4": -2,
          "ARG": -1, "BLOCK_COPY": -2, "SEX8": 0, "SEX16": 0, "NEGI": 0, "BCOM": 0,
          "NEGF": 0, "CVIF": 0, "CVFI": 0, "CALL": 0, "IGNORE": 0}
for n in ("ADD SUB DIVI DIVU MODI MODU MULI MULU BAND BOR BXOR LSH RSHI RSHU "
          "ADDF SUBF DIVF MULF").split():
    EFFECT[n] = -1

INT_BIN = {"ADD": "{a} + {b}", "SUB": "{a} - {b}", "MULI": "{a} * {b}",
           "MULU": "(int)((unsigned){a} * (unsigned){b})",
           "DIVI": "{a} / {b}", "MODI": "{a} % {b}",
           "DIVU": "(int)((unsigned){a} / (unsigned){b})", "MODU": "(int)((unsigned){a} % (unsigned){b})",
           "BAND": "{a} & {b}", "BOR": "{a} | {b}", "BXOR": "{a} ^ {b}",
           # x86 masks the shift count to 5 bits; the interpreter relies on that hardware behaviour
           "LSH": "(int)((unsigned){a} << ({b} & 31))", "RSHI": "{a} >> ({b} & 31)",
           "RSHU": "(int)((unsigned){a} >> ({b} & 31))"}
FLT_BIN = {"ADDF": "+", "SUBF": "-", "MULF": "*", "DIVF": "/"}
CMP = {"EQ": ("==", "i"), "NE": ("!=", "i"), "LTI": ("<", "i"), "LEI": ("<=", "i"),
       "GTI": (">", "i"), "GEI": (">=", "i"), "LTU": ("<", "u"), "LEU": ("<=", "u"),
       "GTU": (">", "u"), "GEU": (">=", "u"), "EQF": ("==", "f"), "NEF": ("!=", "f"),
       "LTF": ("<", "f"), "LEF": ("<=", "f"), "GTF": (">", "f"), "GEF": (">=", "f")}


def load_qvm(path):
    d = open(path, "rb").read()
    magic, icount, coff, clen, doff, dlen, llen, blen = struct.unpack_from("<8i", d)
    jtrg = []
    if magic == 0x12721445:  # VM_MAGIC_VER2
        jlen = struct.unpack_from("<i", d, 32)[0] & ~3
        base = doff + dlen + llen
        jtrg = list(struct.unpack_from("<%di" % (jlen // 4), d, base))
    code = d[coff:coff + clen]
    data = d[doff:doff + dlen]
    ins, pc, ipc = [], 0, 0   # (op name, operand, int_pc as the interpreter numbers it)
    for _ in range(icount):
        name = OPS[code[pc]]
        pc += 1
        arg = None
        if name in WORD_OPERAND:
            arg = struct.unpack_from("<i", code, pc)[0]; pc += 4
        elif name == "ARG":
            arg = code[pc]; pc += 1
        ins.append((name, arg, ipc))
        ipc += 1 if arg is None else 2
    return ins, set(jtrg), dict(magic=magic, dlen=dlen, llen=llen, blen=blen, data=data)


def split_functions(ins):
    starts = [i for i, (n, _, _) in enumerate(ins) if n == "ENTER"]
    assert starts and starts[0] == 0, "vmMain must be instruction 0"
    return [(s, (starts[k + 1] if k + 1 < len(starts) else len(ins))) for k, s in enumerate(starts)]


def switch_targets(ins, i, lo, hi, data):
    """Targets of the computed JUMP at i. lcc compiles `switch` to
    CONST table; ADD; LOAD4; JUMP with the table (instruction indices) in the data segment.
    (OpenArena 0.8.8's jtrg pseudo-segment is not usable: it points into mid-expression code.)"""
    if i - 3 >= lo and [ins[i - k][0] for k in (1, 2, 3)] == ["LOAD4", "ADD", "CONST"]:
        base = ins[i - 3][1]
        # the bounds check before it: CONST min; LTI default ... CONST max; GTI default
        lo_case = hi_case = None
        for k in range(i - 1, max(lo, i - 24), -1):
            if ins[k][0] == "LTI" and ins[k - 1][0] == "CONST" and lo_case is None:
                lo_case = ins[k - 1][1]
            if ins[k][0] == "GTI" and ins[k - 1][0] == "CONST" and hi_case is None:
                hi_case = ins[k - 1][1]
        entry = lambda c: struct.unpack_from("<i", data, base + 4 * c)[0]
        if lo_case is not None and hi_case is not None:
            out = [entry(c) for c in range(lo_case, hi_case + 1)]
            if all(lo <= v < hi for v in out):
                return sorted(set(out))
        if hi_case is not None:
            # lower bound held in a temporary (lcc reuses the shift-count local): walk down from max
            out, c = [], hi_case
            while base + 4 * c >= 0 and lo <= entry(c) < hi:
                out.append(entry(c)); c -= 1
            if out:
                return sorted(set(out))
    raise ValueError("unrecognised computed jump at %d" % i)


def analyse(ins, lo, hi, data):
    """Operand-stack depth before every instruction of one function, by abstract interpretation."""
    labels = set()
    for i in range(lo, hi):
        n, a, _ = ins[i]
        if n in BRANCHES:
            labels.add(a)
    jumps = {}
    for i in range(lo, hi):
        if ins[i][0] == "JUMP" and ins[i - 1][0] == "CONST" and i not in labels:
            labels.add(ins[i - 1][1])   # plain goto
    for i in range(lo, hi):
        if ins[i][0] == "JUMP" and not (ins[i - 1][0] == "CONST" and i not in labels):
            jumps[i] = switch_targets(ins, i, lo, hi, data)
            labels |= set(jumps[i])
    depth = {lo: 0}
    work = [lo]
    def flow(t, d, src):
        if not (lo <= t < hi):
            raise ValueError("branch out of function at %d -> %d" % (src, t))
        if t in depth:
            if depth[t] != d:
                raise ValueError("stack depth mismatch at %d: %d vs %d" % (t, depth[t], d))
        else:
            depth[t] = d; work.append(t)
    while work:
        i = work.pop()
        d = depth[i]
        n, a, _ = ins[i]
        if n == "LEAVE":
            continue
        if n in BRANCHES:
            flow(a, d - 2, i); flow(i + 1, d - 2, i)
        elif n == "JUMP":
            if i > lo and ins[i - 1][0] == "CONST" and i not in labels:
                flow(ins[i - 1][1], d - 1, i)
            else:
                for t in jumps[i]:
                    flow(t, d - 1, i)
        else:
            if i + 1 < hi:
                flow(i + 1, d + EFFECT[n], i)
    return depth, labels, jumps


def gen_function(ins, lo, hi, data, hooks, out, coverage=False):
    depth, labels, jumps = analyse(ins, lo, hi, data)
    maxd = max(list(depth.values()) + [1]) + 2
    w = out.append
    w("int f_%d(int ps) {" % lo)
    if coverage:
        w("  aot_cov[%d]++;" % FUNCS_INDEX[lo])
    w("  int %s;" % ", ".join("s%d" % k for k in range(1, maxd + 1)))
    w("  (void)s1;")
    for i in range(lo, hi):
        if i not in depth:
            continue  # unreachable (e.g. code after an unconditional jump)
        n, a, ipc = ins[i]
        d = depth[i]
        r0, r1 = "s%d" % d, "s%d" % (d - 1)
        if i in labels:
            w("L%d:;" % i)
        w("/*@%d*/" % i if not coverage else "  aot_icov[%d]++; /*@%d*/" % (i, i))
        if n == "ENTER":
            w("  ps -= %d;" % a)
        elif n == "LEAVE":
            w("  return %s;" % (r0 if d >= 1 else "0"))
        elif n == "CONST":
            w("  s%d = %d;" % (d + 1, a))
        elif n == "LOCAL":
            w("  s%d = ps + %d;" % (d + 1, a))
        elif n == "PUSH":
            w("  s%d = 0;" % (d + 1))
        elif n in ("POP", "BREAK", "IGNORE"):
            pass
        elif n == "LOAD4":
            w("  %s = LD4(%s);" % (r0, r0))
        elif n == "LOAD2":
            w("  %s = LD2(%s);" % (r0, r0))
        elif n == "LOAD1":
            w("  %s = LD1(%s);" % (r0, r0))
        elif n == "STORE4":
            w("  ST4(%s, %s);" % (r1, r0))
        elif n == "STORE2":
            w("  ST2(%s, %s);" % (r1, r0))
        elif n == "STORE1":
            w("  ST1(%s, %s);" % (r1, r0))
        elif n == "ARG":
            w("  ST4(ps + %d, %s);" % (a, r0))
        elif n == "BLOCK_COPY":
            w("  env->blockCopy(%s, %s, %d);" % (r1, r0, a))
        elif n == "CALL":
            ret = ipc + 1  # interpreter's programCounter after fetching CALL
            w("  RAW4(ps) = %d;" % ret)
            direct = ins[i - 1][0] == "CONST" and i not in labels and i - 1 >= lo
            if direct and ins[i - 1][1] < 0:
                w("  %s = SYSCALL(ps, %d);" % (r0, -1 - ins[i - 1][1]))
            elif direct and ins[i - 1][1] in FUNCS:
                t = ins[i - 1][1]
                if t in hooks:
                    w("  %s = %s(ps, f_%d);" % (r0, hooks[t], t))
                else:
                    w("  %s = f_%d(ps);" % (r0, t))
            else:
                w("  %s = aot_dispatch(%s, ps);" % (r0, r0))
        elif n == "JUMP":
            if i > lo and ins[i - 1][0] == "CONST" and i not in labels:
                w("  goto L%d;" % ins[i - 1][1])
            else:
                w("  switch (%s) {" % r0)
                for t in jumps[i]:
                    w("    case %d: goto L%d;" % (t, t))
                w("    default: env->error(\"computed jump out of range\");")
                w("  }")
        elif n in BRANCHES:
            op, kind = CMP[n]
            if kind == "i":
                cond = "%s %s %s" % (r1, op, r0)
            elif kind == "u":
                cond = "(unsigned)%s %s (unsigned)%s" % (r1, op, r0)
            else:
                cond = "F(%s) %s F(%s)" % (r1, op, r0)
            w("  if (%s) goto L%d;" % (cond, a))
        elif n in INT_BIN:
            w("  %s = %s;" % (r1, INT_BIN[n].format(a=r1, b=r0)))
        elif n in FLT_BIN:
            w("  %s = I(F(%s) %s F(%s));" % (r1, r1, FLT_BIN[n], r0))
        elif n == "NEGI":
            w("  %s = -%s;" % (r0, r0))
        elif n == "BCOM":
            w("  %s = ~%s;" % (r0, r0))
        elif n == "NEGF":
            w("  %s = I(-F(%s));" % (r0, r0))
        elif n == "CVIF":
            w("  %s = I((float)%s);" % (r0, r0))
        elif n == "CVFI":
            w("  %s = FTOL(F(%s));" % (r0, r0))
        elif n == "SEX8":
            w("  %s = (signed char)%s;" % (r0, r0))
        elif n == "SEX16":
            w("  %s = (short)%s;" % (r0, r0))
        else:
            raise ValueError("unhandled op %s at %d" % (n, i))
    w("  return 0;")
    w("}")


RUNTIME = r"""/* generated by qvmrecomp.py: runtime shared by all chunks */
#include <stdint.h>
#include <string.h>
#include <stddef.h>
typedef struct {
	int *programStack; unsigned char *dataBase; int dataMask;
	intptr_t (*systemCall)(intptr_t *);
	void (*blockCopy)(unsigned int, unsigned int, size_t);
	void (*error)(const char *);
} aotEnv_t;
extern aotEnv_t *env;
extern unsigned char *img;
extern int mask;
static inline int LD4(int a) { int v; memcpy(&v, img + (a & mask), 4); return v; }
static inline int LD2(int a) { unsigned short v; memcpy(&v, img + (a & mask), 2); return v; }
static inline int LD1(int a) { return img[a & mask]; }
static inline void ST4(int a, int v) { memcpy(img + (a & mask), &v, 4); }
static inline void ST2(int a, int v) { short s = (short)v; memcpy(img + (a & mask), &s, 2); }
static inline void ST1(int a, int v) { img[a & mask] = (unsigned char)v; }
#define RAW4(a) (*(int *)(img + (a)))     /* the interpreter writes these without masking */
static inline float F(int i) { float f; memcpy(&f, &i, 4); return f; }
static inline int I(float f) { int i; memcpy(&i, &f, 4); return i; }
/* Q_ftol on x86-64 is a 64-bit cvttss2si, truncated to int when stored on the op stack */
static inline int FTOL(float f) { long r; __asm__ volatile("cvttss2si %1, %0" : "=r"(r) : "x"(f)); return (int)r; }
int aot_syscall(int ps, int num);
#define SYSCALL(ps, num) aot_syscall(ps, num)
int aot_dispatch(int target, int ps);
"""

MAIN = r"""
aotEnv_t *env;
unsigned char *img;
int mask;

void aot_init(aotEnv_t *e) { env = e; img = e->dataBase; mask = e->dataMask; }

int aot_syscall(int ps, int num) {
	intptr_t args[%(nsys)d];
	int i;
	*env->programStack = ps - 4;
	RAW4(ps + 4) = num;
	for (i = 0; i < %(nsys)d; i++) args[i] = RAW4(ps + 4 + 4 * i);
	return (int)env->systemCall(args);
}

int aot_call(int *args) {
	int entry = *env->programStack, ps = entry - (8 + 4 * %(nmain)d), i, r;
	for (i = 0; i < %(nmain)d; i++) RAW4(ps + 8 + i * 4) = args[i];
	RAW4(ps + 4) = 0;
	RAW4(ps) = -1;
	r = f_0(ps);
	*env->programStack = entry;
	return r;
}
"""

FUNCS = set()
FUNCS_INDEX = {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("qvm"); ap.add_argument("outdir")
    ap.add_argument("--chunks", type=int, default=8)
    ap.add_argument("--hook", action="append", default=[], help="FUNC_INDEX=c_name")
    ap.add_argument("--hook-header", default=None, help="header declaring the hook functions")
    ap.add_argument("--coverage", action="store_true", help="count calls per function; written to $QVM_AOT_COVERAGE at exit")
    o = ap.parse_args()
    ins, jtrg, hdr = load_qvm(o.qvm)
    funcs = split_functions(ins)
    FUNCS.update(lo for lo, _ in funcs)
    FUNCS_INDEX.update({lo: k for k, (lo, _) in enumerate(funcs)})
    hooks = {int(k): v for k, v in (h.split("=") for h in o.hook)}
    os.makedirs(o.outdir, exist_ok=True)
    proto = "".join("int f_%d(int ps);\n" % lo for lo, _ in funcs)
    proto += "extern unsigned long long aot_cov[%d];\n" % len(funcs)
    proto += "extern unsigned aot_icov[%d];\n" % len(ins)
    hookdecl = ('#include "%s"\n' % o.hook_header) if o.hook_header else ""
    open(os.path.join(o.outdir, "aot.h"), "w").write(RUNTIME + proto + hookdecl)
    # dispatch for calls through function pointers (ent->think etc.)
    disp = ['#include "aot.h"', "#include <stdio.h>\n#include <stdlib.h>",
            "unsigned long long aot_cov[%d];" % len(funcs),
            "unsigned aot_icov[%d];" % len(ins),
            "static const int aot_func_start[] = {%s};" % ",".join(str(lo) for lo, _ in funcs),
            "__attribute__((destructor)) static void aot_cov_dump(void) {",
            "  const char *p = getenv(\"QVM_AOT_COVERAGE\"); FILE *f; int i;",
            "  if (!p || !(f = fopen(p, \"w\"))) return;",
            "  for (i = 0; i < %d; i++) fprintf(f, \"%%d %%llu\\n\", aot_func_start[i], aot_cov[i]);" % len(funcs),
            "  fclose(f);",
            "  if ((p = getenv(\"QVM_AOT_ICOVERAGE\")) && (f = fopen(p, \"w\"))) {",
            "    for (i = 0; i < %d; i++) if (aot_icov[i]) fprintf(f, \"%%d %%u\\n\", i, aot_icov[i]);" % len(ins),
            "    fclose(f);", "  }", "}",
            MAIN % dict(nsys=MAX_VMSYSCALL_ARGS, nmain=MAX_VMMAIN_ARGS),
            "int aot_dispatch(int t, int ps) {", "  switch (t) {"]
    for lo, _ in funcs:
        disp.append("    case %d: return %s;" % (lo, ("%s(ps, f_%d)" % (hooks[lo], lo)) if lo in hooks else "f_%d(ps)" % lo))
    disp += ["  }", "  if (t < 0) return aot_syscall(ps, -1 - t);",
             "  env->error(\"call to a non-function\");", "  return 0;", "}"]
    open(os.path.join(o.outdir, "aot_main.c"), "w").write("\n".join(disp) + "\n")
    per = (len(funcs) + o.chunks - 1) // o.chunks
    stats = defaultdict(int)
    for c in range(o.chunks):
        out = ['#include "aot.h"']
        for lo, hi in funcs[c * per:(c + 1) * per]:
            gen_function(ins, lo, hi, hdr['data'], hooks, out, o.coverage)
            stats["functions"] += 1
        open(os.path.join(o.outdir, "aot_%d.c" % c), "w").write("\n".join(out) + "\n")
    print("%d instructions, %d functions -> %s" % (len(ins), stats["functions"], o.outdir))


if __name__ == "__main__":
    main()

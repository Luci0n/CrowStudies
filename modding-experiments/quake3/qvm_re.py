#!/usr/bin/env python3
"""Reverse-engineer a *stripped* Quake 3 qagame.qvm: find the functions a mod needs to hook.

usage: qvm_re.py game.qvm g_public.h [--json out.json]

Uses only the binary plus the public engine ABI (g_public.h syscall numbers, which every mod
author has). Ghidra has no QVM processor module, so this is the hand-rolled equivalent of a
Ghidra + MCP session: disassemble, build the call graph, collect string / syscall /
function-pointer references per function, then apply inference rules. Every identification keeps
its evidence, so it can be checked, and grade_re.py scores it against symbols rebuilt from source.
"""
import re, sys, json, struct, argparse
from collections import defaultdict, Counter
from qvmrecomp import load_qvm, split_functions


def syscall_names(header):
    """gameImport_t from g_public.h: enum values, honouring explicit `= N` resets."""
    src = open(header).read()
    body = src[src.index("typedef enum", src.index("GAME_API_VERSION")):]
    body = body[:body.index("} gameImport_t;")]
    names, v = {}, 0
    for m in re.finditer(r"^\s*((?:G|BOTLIB|TRAP)_[A-Z0-9_]+)\s*(?:=\s*(\d+))?\s*,", body, re.M):
        if m.group(2):
            v = int(m.group(2))
        names[v] = m.group(1)
        v += 1
    return names


class QVM:
    def __init__(self, path, header):
        self.ins, _, self.hdr = load_qvm(path)
        d = open(path, "rb").read()
        doff, dlen, llen = struct.unpack_from("<i", d, 16)[0], self.hdr["dlen"], self.hdr["llen"]
        self.lit = d[doff + dlen: doff + dlen + llen]
        self.dlen = dlen
        self.funcs = split_functions(self.ins)
        self.start = {lo for lo, _ in self.funcs}
        self.sys = syscall_names(header)
        self.info = {}
        for lo, hi in self.funcs:
            self.info[lo] = self._scan(lo, hi)
        self.callers = defaultdict(set)
        for f, inf in self.info.items():
            for c in inf["calls"]:
                self.callers[c].add(f)

    def string_at(self, addr):
        off = addr - self.dlen
        if 0 <= off < len(self.lit):
            end = self.lit.find(b"\0", off)
            return self.lit[off:end].decode("latin-1")
        return None

    def _scan(self, lo, hi):
        ins = self.ins
        calls, sysc, strings, fptrs = Counter(), Counter(), [], []
        callargs = defaultdict(list)   # callee -> list of arg-counts at each call site
        args_since_call = []
        for i in range(lo, hi):
            n, a, _ = ins[i]
            if n == "ARG":
                args_since_call.append(a)
            if n == "CALL" and ins[i - 1][0] == "CONST":
                t = ins[i - 1][1]
                nargs = (max(args_since_call) - 8) // 4 + 1 if args_since_call else 0
                if t < 0:
                    sysc[self.sys.get(-1 - t, "SYSCALL_%d" % (-1 - t))] += 1
                else:
                    calls[t] += 1
                    callargs[t].append(nargs)
                args_since_call = []
            elif n == "CALL":
                args_since_call = []
            if n == "CONST" and not (i + 1 < hi and ins[i + 1][0] in ("CALL", "JUMP")):
                s = self.string_at(a)
                if s is not None:
                    strings.append(s)
                elif a in self.start and a != lo:
                    fptrs.append(a)    # address of a function used as data (think/touch/die...)
        frame = ins[lo][1]
        offs = [ins[i][1] for i in range(lo, hi) if ins[i][0] == "LOCAL" and ins[i][1] >= frame + 8]
        params = (max(offs) - frame - 8) // 4 + 1 if offs else 0   # incoming args live above the frame
        return dict(calls=calls, sys=sysc, strings=strings, fptrs=fptrs, callargs=callargs,
                    size=hi - lo, frame=frame, params=params)

    # -- queries an analyst (or an agent over MCP) would run --
    def with_string(self, pred):
        return [f for f, inf in self.info.items() if any(pred(s) for s in inf["strings"])]

    def calling_sys(self, name):
        return [f for f, inf in self.info.items() if name in inf["sys"]]

    def vmmain_case_target(self, case):
        """First function called in vmMain's handler for a given GAME_* command."""
        ins = self.ins
        lo, hi = self.funcs[0]
        # vmMain is `switch (command)`: find the table jump and read entry `case`
        for i in range(lo, hi):
            if ins[i][0] == "JUMP" and ins[i - 1][0] == "LOAD4" and ins[i - 2][0] == "ADD" and ins[i - 3][0] == "CONST":
                base = ins[i - 3][1]
                tgt = struct.unpack_from("<i", self.hdr["data"], base + 4 * case)[0]
                for k in range(tgt, hi):
                    if ins[k][0] == "CALL" and ins[k - 1][0] == "CONST" and ins[k - 1][1] >= 0:
                        return ins[k - 1][1]
        return None


GAME_INIT, GAME_RUN_FRAME, GAME_CLIENT_THINK = 0, 8, 7


def identify(q):
    found, ev = {}, {}
    def put(name, f, why):
        if f is not None:
            found[name] = f; ev[name] = why

    put("vmMain", 0, "instruction 0 is the module entry point (engine ABI)")
    put("G_InitGame", q.vmmain_case_target(GAME_INIT), "first call in vmMain's GAME_INIT case")
    put("G_RunFrame", q.vmmain_case_target(GAME_RUN_FRAME), "first call in vmMain's GAME_RUN_FRAME case")
    put("ClientThink", q.vmmain_case_target(GAME_CLIENT_THINK), "first call in vmMain's GAME_CLIENT_THINK case")

    sp = q.with_string(lambda s: "G_Spawn" in s and "free" in s)
    put("G_Spawn", sp[0] if len(sp) == 1 else None, "only function with the 'G_Spawn: no free entities' error string")
    fr = [f for f in q.with_string(lambda s: s == "freed")]
    fr = [f for f in fr if q.info[f]["sys"].get("G_UNLINKENTITY")]
    put("G_FreeEntity", fr[0] if len(fr) == 1 else None, "sets classname \"freed\" and calls trap_UnlinkEntity")
    te = [f for f in q.with_string(lambda s: s == "tempEntity") if found.get("G_Spawn") in q.info[f]["calls"]]
    put("G_TempEntity", te[0] if len(te) == 1 else None, "calls G_Spawn and sets classname \"tempEntity\"")

    # G_Damage: every trap_EntitiesInBox user that hurts things calls the same 8-argument function
    eight = Counter()
    boxers = q.calling_sys("G_ENTITIES_IN_BOX")
    for f in boxers:
        for c, na in q.info[f]["callargs"].items():
            if 8 in na:
                eight[c] += 1
    if eight:
        g, n = eight.most_common(1)[0]
        if n == sum(eight.values()):
            put("G_Damage", g, "the one 8-arg function called by all %d trap_EntitiesInBox users that deal damage "
                "(targ, inflictor, attacker, dir, point, damage, dflags, mod)" % n)
    # G_RadiusDamage(origin, attacker, damage, radius, ignore, mod): of those, the 6-parameter one
    # that checks line of sight through a trap_Trace helper (CanDamage)
    cand = [f for f in boxers if found.get("G_Damage") in q.info[f]["calls"] and q.info[f]["params"] == 6
            and any(q.info[c]["sys"].get("G_TRACE") for c in q.info[f]["calls"])]
    put("G_RadiusDamage", cand[0] if len(cand) == 1 else None,
        "6 params, trap_EntitiesInBox + G_Damage + a trap_Trace line-of-sight helper")
    if len(cand) == 1:
        cd = [c for c in q.info[cand[0]]["calls"] if q.info[c]["sys"].get("G_TRACE")]
        put("CanDamage", cd[0] if len(cd) == 1 else None, "G_RadiusDamage's trap_Trace helper")

    # missiles: fire_* spawn an entity with a classname string and install a think function
    for cls, name in (("rocket", "fire_rocket"), ("grenade", "fire_grenade"), ("plasma", "fire_plasma")):
        c = [f for f in q.with_string(lambda s, cls=cls: s == cls)
             if found.get("G_Spawn") in q.info[f]["calls"] and q.info[f]["fptrs"]]
        put(name, c[0] if len(c) == 1 else None, "calls G_Spawn, sets classname \"%s\", stores a think pointer" % cls)
    if "fire_rocket" in found:
        thinks = [p for p in q.info[found["fire_rocket"]]["fptrs"] if found.get("G_RadiusDamage") in q.info[p]["calls"]]
        put("G_ExplodeMissile", thinks[0] if len(thinks) == 1 else None,
            "function pointer stored by fire_rocket (ent->think) that calls G_RadiusDamage")
    # G_MissileImpact: calls both G_Damage and G_RadiusDamage, and is called (not pointed to) by the missile runner
    rd, dmg = found.get("G_RadiusDamage"), found.get("G_Damage")
    mi = [f for f, inf in q.info.items() if rd in inf["calls"] and dmg in inf["calls"]
          and f != found.get("G_ExplodeMissile") and q.callers[f] and
          any(q.info[c]["sys"].get("G_TRACE") for c in q.callers[f])]
    put("G_MissileImpact", mi[0] if len(mi) == 1 else None,
        "calls G_Damage and G_RadiusDamage; its caller traces the missile path (G_RunMissile)")
    if "G_MissileImpact" in found:
        rm = [c for c in q.callers[found["G_MissileImpact"]] if q.info[c]["sys"].get("G_TRACE")]
        put("G_RunMissile", rm[0] if len(rm) == 1 else None, "the trap_Trace caller of G_MissileImpact")
    # data: trap_LocateGameData(level.gentities, num, sizeof(gentity_t), ...). The pointer argument is
    # loaded from a global (CONST p; LOAD4; ARG 8); G_InitGame stores the array's address there.
    ptr_slot = None
    for f in q.calling_sys("G_LOCATE_GAME_DATA"):
        lo, hi = [x for x in q.funcs if x[0] == f][0]
        args = {}
        for i in range(lo, hi):
            n, a, _ = q.ins[i]
            if n == "ARG":
                p1, p2 = q.ins[i - 1], q.ins[i - 2]
                args[a] = ("const", p1[1]) if p1[0] == "CONST" else ("load", p2[1]) if p1[0] == "LOAD4" and p2[0] == "CONST" else None
            if n == "CALL":
                if q.ins[i - 1][0] == "CONST" and q.sys.get(-1 - q.ins[i - 1][1]) == "G_LOCATE_GAME_DATA":
                    if args.get(16) and args[16][0] == "const":
                        put("sizeof(gentity_t)", args[16][1], "3rd argument of trap_LocateGameData")
                    if args.get(8) and args[8][0] == "load":
                        ptr_slot = args[8][1]
                args = {}
    if ptr_slot is not None and "G_InitGame" in found:
        lo, hi = [x for x in q.funcs if x[0] == found["G_InitGame"]][0]
        st = [q.ins[i + 1][1] for i in range(lo, hi - 2)
              if q.ins[i] == ("CONST", ptr_slot, q.ins[i][2]) and q.ins[i + 1][0] == "CONST" and q.ins[i + 2][0] == "STORE4"]
        if len(st) == 1:
            put("g_entities", st[0], "G_InitGame stores it into level.gentities (%d), which is "
                "trap_LocateGameData's 1st argument" % ptr_slot)
    if not ("G_MissileImpact" in found):
        ev["G_MissileImpact"] = "ambiguous: %s" % mi
    return found, ev


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("qvm"); ap.add_argument("header"); ap.add_argument("--json")
    o = ap.parse_args()
    q = QVM(o.qvm, o.header)
    found, ev = identify(q)
    print("%d functions, %d syscalls named from g_public.h" % (len(q.funcs), len(q.sys)))
    for k in sorted(ev, key=lambda k: found.get(k, 1 << 30)):
        print("  %-18s %-8s %s" % (k, found.get(k, "?"), ev[k]))
    if o.json:
        json.dump(dict(found=found, evidence=ev), open(o.json, "w"), indent=1)


if __name__ == "__main__":
    main()

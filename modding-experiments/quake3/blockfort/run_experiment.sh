#!/bin/sh
# run_experiment.sh <workdir> [frames]: build BLOCKFORT and run every check. Needs setup.sh's workdir
# plus ClassiCube cloned at <workdir>/ClassiCube.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); W=$1; N=${2:-6000}; O=$W/blockfort_out; mkdir -p "$O"
[ -d "$W/ClassiCube" ] || git clone --depth 1 https://github.com/ClassiCube/ClassiCube "$W/ClassiCube"
"$HERE/build_blockfort.sh" "$W" "$W/qagame_bf.so"
export BOTS="+addbot Angelyss 3 +addbot Sarge 3 +addbot Grism 3 +addbot Kyonshi 3 +addbot Major 3 +addbot Gargoyle 3 +addbot Ayumi 3 +addbot Penguin 3"
R=$W/run.sh
"$R" "$O/interp.log" "$N" > "$O/interp.out" 2>&1 &
BLOCKFORT_OFF=1 BLOCKFORT_LOG="$O/off_events.log" QVM_AOT=$W/qagame_bf.so "$R" "$O/off.log" "$N" > "$O/off.out" 2>&1 &
BLOCKFORT_LOG="$O/on_events.log" BLOCKFORT_REC="$O/on.rec" QVM_AOT=$W/qagame_bf.so "$R" "$O/on.log" "$N" > "$O/on.out" 2>&1 &
BLOCKFORT_LOG="$O/on2_events.log" BLOCKFORT_REC="$O/on2.rec" QVM_AOT=$W/qagame_bf.so "$R" "$O/on2.log" "$N" > "$O/on2.out" 2>&1 &
wait
python3 - "$O" <<'P'
import sys
o = sys.argv[1]
L = lambda n: [l for l in open("%s/%s" % (o, n)).read().split("\n") if l]
a, b = L("interp.log"), L("off.log")
print("A  hooks compiled in but off vs interpreter: %d/%d calls identical (memory + syscalls)" % (sum(x == y for x, y in zip(a, b)), len(a)))
a, b = L("on.log"), L("on2.log")
print("C  mashup determinism: %d/%d calls identical; block recordings identical: %s" % (
    sum(x == y for x, y in zip(a, b)), len(a), open(o + "/on.rec", "rb").read() == open(o + "/on2.rec", "rb").read()))
P
printf "B  "; "$W/bw/bw_replay" "$O/on.rec" "$O/snap.bin" 10
python3 "$HERE/analyze.py" "$O/on_events.log" "$O/off_events.log" "$O/snap.bin" "$O/on.out" "$O/off.out" "$O/blockfort.gif"

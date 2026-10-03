#!/bin/sh
# build_blockfort.sh <workdir> <out.so>: RE -> hooks -> recompile qagame.qvm with BLOCKFORT linked in
set -e
HERE=$(cd "$(dirname "$0")" && pwd); W=$1; SO=$2
Q=$W/oa/vm/qagame.qvm; H=$W/ioq3/code/game/g_public.h
python3 "$HERE/../qvm_re.py" "$Q" "$H" --json "$W/re.json" > /dev/null
HOOKS=$(python3 "$HERE/gen_symbols.py" "$Q" "$H" "$W/re.json" "$W/re_symbols.h")
"$HERE/build_cc.sh" "$W/ClassiCube/src" "$W/bw"
python3 "$HERE/../qvmrecomp.py" "$Q" "$W/aot_bf" $HOOKS --hook-header "$W/re_symbols.h" > /dev/null
cd "$W/aot_bf" && rm -f ./*.o
ls ./*.c | xargs -P"$(nproc)" -I{} gcc -O2 -fPIC -fwrapv -fno-strict-aliasing -w -c {} -o {}.o
gcc -O2 -fPIC -Wall -Wno-unused-function -I"$W/aot_bf" -I"$W" -I"$HERE" -c "$HERE/blockfort.c" -o blockfort.o
gcc -shared -o "$SO" ./*.o -L"$W/bw" -lblockworld -lm
echo "built $SO ($HOOKS)"

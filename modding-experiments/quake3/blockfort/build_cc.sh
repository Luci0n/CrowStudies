#!/bin/sh
# build_cc.sh <ClassiCube/src> <outdir>: compile ClassiCube's modules (unmodified) + the shim into libblockworld.a
set -e
CC_SRC=$1; OUT=$2; HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
for f in GameVersion BlockPhysics ExtMath Generator Block World String Event Vectors PackedCol Utils Lighting; do
  gcc -O2 -fPIC -w -I"$CC_SRC" -c "$CC_SRC/$f.c" -o "$OUT/cc_$f.o"
done
for f in cc_vars cc_stubs blockworld; do gcc -O2 -fPIC -Wall -I"$CC_SRC" -c "$HERE/$f.c" -o "$OUT/$f.o"; done
ar rcs "$OUT/libblockworld.a" "$OUT"/*.o
gcc -O2 -I"$HERE" "$HERE/bw_replay.c" -L"$OUT" -lblockworld -lm -o "$OUT/bw_replay"

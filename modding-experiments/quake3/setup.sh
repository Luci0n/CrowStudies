#!/bin/sh
# setup.sh <workdir>: fetch ioquake3 (GPL) + OpenArena 0.8.8 (GPL data), apply the AOT/difftest patch,
# build the headless dedicated server, and unpack OpenArena's shipped qagame.qvm.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${1:-$HERE/work}; mkdir -p "$W"; cd "$W"
[ -d ioq3 ] || git clone https://github.com/ioquake/ioq3
(cd ioq3 && git checkout -q "$(cat "$HERE/ioq3-commit.txt")" && git apply "$HERE/ioq3-aot.patch")
(cd ioq3 && cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_CLIENT=OFF \
   -DBUILD_RENDERER_GL1=OFF -DBUILD_RENDERER_GL2=OFF && cmake --build build --target ioq3ded)
[ -f oa.zip ] || curl -L -o oa.zip https://download.tuxfamily.org/openarena/rel/088/openarena-0.8.8.zip
[ -d openarena-0.8.8 ] || unzip -q oa.zip
mkdir -p oa && (cd oa && unzip -o -q ../openarena-0.8.8/baseoa/pak6-patch088.pk3 'vm/*')
cp "$HERE/run_match.sh" "$W/run.sh"
echo "ready: $W (qagame.qvm in $W/oa/vm)"

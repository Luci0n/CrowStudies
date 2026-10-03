#!/bin/sh
# build_aot.sh <qvm> <outdir> <out.so> [qvmrecomp args...]: recompile a QVM and build the AOT module
set -e
Q=$1; D=$2; SO=$3; shift 3
python3 "$(dirname "$0")/qvmrecomp.py" "$Q" "$D" "$@"
cd "$D" && rm -f ./*.o
ls ./*.c | xargs -P"$(nproc)" -I{} gcc -O2 -fPIC -fwrapv -fno-strict-aliasing -w -c {} -o {}.o
gcc -shared -o "$SO" ./*.o

#!/bin/bash
# usage: run.sh <hashlog> <frames-ms> [extra +set args...]
W=$(dirname $(readlink -f $0)); LOG=$1; MS=$2; shift 2
H=$(mktemp -d $W/home.XXXXXX)
QVM_DETERMINISTIC=1 QVM_FAST=${QVM_FAST-1} HOME=$H env ${LOG:+QVM_HASHLOG=$LOG} timeout 600 setarch -R $W/ioq3/build/Release/ioq3ded \
  +set fs_basepath $W/openarena-0.8.8 +set fs_homepath $H/oa +set com_basegame baseoa +set com_standalone 1 \
  +set vm_game 1 +set sv_pure 0 +set net_enabled 0 +set dedicated 1 +set fixedtime 50 +set sv_fps 20 +set com_maxfps 0 \
  +set bot_enable 1 +set bot_minplayers 0 +set g_gametype 0 +set fraglimit 0 +set timelimit 0 \
  +set g_spSkill 3 "$@" +map ${MAP:-oa_dm1} \
  +wait 2 ${BOTS:-+addbot Angelyss 3 +addbot Sarge 3 +addbot Grism 3 +addbot Kyonshi 3} +wait $MS +quit

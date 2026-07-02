#!/usr/bin/env bash
set -e
. "$(dirname "$0")/env.sh"
mode="${1:-off}"
v=0; [ "$mode" = "on" ] && v=1
"$ADB" shell settings put global window_animation_scale "$v"
"$ADB" shell settings put global transition_animation_scale "$v"
"$ADB" shell settings put global animator_duration_scale "$v"
echo "animasyonlar: $mode"

#!/usr/bin/env bash
set -e
. "$(dirname "$0")/env.sh"
pkg="${1:?kullanım: monkey.sh <package> [olay=3000] [seed=42] [logcat_cikti=monkey-logcat.txt]}"
n="${2:-3000}"
seed="${3:-42}"
out="${4:-monkey-logcat.txt}"
"$ADB" logcat -c
"$ADB" shell monkey -p "$pkg" -s "$seed" --throttle 50 --pct-syskeys 0 --ignore-timeouts -v "$n" || true
"$ADB" logcat -d > "$out"
echo "logcat: $out"

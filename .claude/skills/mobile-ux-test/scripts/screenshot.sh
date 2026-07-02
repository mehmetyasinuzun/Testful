#!/usr/bin/env bash
set -e
. "$(dirname "$0")/env.sh"
out="${1:?kullanım: screenshot.sh <cikti.png>}"
"$ADB" exec-out screencap -p > "$out"
echo "$out"

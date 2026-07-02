#!/usr/bin/env bash
f="${1:?kullanım: logcat-scan.sh <logcat.txt>}"
patterns='FATAL EXCEPTION|ANR in |Force finishing activity|E/flutter|RenderFlex overflowed|OutOfMemoryError|native crash|CRASH'
hits=$(grep -nE "$patterns" "$f" 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "$hits"
  echo "--- $(printf '%s\n' "$hits" | wc -l) kritik satır bulundu ---"
  exit 1
fi
echo "temiz"

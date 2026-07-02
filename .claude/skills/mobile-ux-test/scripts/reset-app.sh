#!/usr/bin/env bash
set -e
. "$(dirname "$0")/env.sh"
pkg="${1:?kullanım: reset-app.sh <package>}"
"$ADB" shell am force-stop "$pkg"
"$ADB" shell pm clear "$pkg"
echo "sıfırlandı: $pkg (veri + runtime izinleri)"

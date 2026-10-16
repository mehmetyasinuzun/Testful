#!/usr/bin/env bash
# Bu dosya `source` ile yüklenir; ADB/MAESTRO/PATROL çağıran betikte kullanılır.
# shellcheck disable=SC2034
# Araç yolları: PATH → ANDROID_HOME/ANDROID_SDK_ROOT → platform varsayılanı
# (Windows %LOCALAPPDATA%\Android\Sdk · macOS ~/Library/Android/sdk · Linux ~/Android/Sdk).
# Node tarafındaki karşılığı: cli/lib/platform.mjs
first_exec() {
  local c
  for c in "$@"; do
    if [ -n "$c" ] && [ -x "$c" ]; then echo "$c"; return 0; fi
  done
  return 1
}
resolve_adb() {
  if command -v adb >/dev/null 2>&1; then echo "adb"; return 0; fi
  first_exec \
    "${ANDROID_HOME:+$ANDROID_HOME/platform-tools/adb}" \
    "${ANDROID_SDK_ROOT:+$ANDROID_SDK_ROOT/platform-tools/adb}" \
    "$HOME/Library/Android/sdk/platform-tools/adb" \
    "$HOME/Android/Sdk/platform-tools/adb" \
    "${LOCALAPPDATA:+$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}" \
    "$HOME/AppData/Local/Android/Sdk/platform-tools/adb.exe"
}
resolve_maestro() {
  if command -v maestro >/dev/null 2>&1; then echo "maestro"; return 0; fi
  first_exec "$HOME/.maestro/bin/maestro" "C:/dev/maestro/bin/maestro"
}
resolve_patrol() {
  if command -v patrol >/dev/null 2>&1; then echo "patrol"; return 0; fi
  first_exec "$HOME/.pub-cache/bin/patrol" || {
    [ -f "$LOCALAPPDATA/Pub/Cache/bin/patrol.bat" ] && echo "$LOCALAPPDATA/Pub/Cache/bin/patrol.bat"
  }
}
ADB="$(resolve_adb)" || { echo "HATA: adb bulunamadı (Android SDK platform-tools kur ya da PATH/ANDROID_HOME ayarla)"; exit 2; }
MAESTRO="$(resolve_maestro || true)"
PATROL="$(resolve_patrol || true)"

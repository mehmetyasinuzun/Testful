#!/usr/bin/env bash
resolve_adb() {
  if command -v adb >/dev/null 2>&1; then echo "adb"; return 0; fi
  local c
  for c in "$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" \
           "$HOME/AppData/Local/Android/Sdk/platform-tools/adb.exe"; do
    if [ -x "$c" ]; then echo "$c"; return 0; fi
  done
  return 1
}
resolve_maestro() {
  if command -v maestro >/dev/null 2>&1; then echo "maestro"; return 0; fi
  if [ -x "C:/dev/maestro/bin/maestro" ]; then echo "C:/dev/maestro/bin/maestro"; return 0; fi
  return 1
}
resolve_patrol() {
  if command -v patrol >/dev/null 2>&1; then echo "patrol"; return 0; fi
  if [ -f "$LOCALAPPDATA/Pub/Cache/bin/patrol.bat" ]; then echo "$LOCALAPPDATA/Pub/Cache/bin/patrol.bat"; return 0; fi
  return 1
}
ADB="$(resolve_adb)" || { echo "HATA: adb bulunamadı (Android SDK platform-tools kur ya da PATH'e ekle)"; exit 2; }
MAESTRO="$(resolve_maestro || true)"
PATROL="$(resolve_patrol || true)"

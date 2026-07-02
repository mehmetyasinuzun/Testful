#!/usr/bin/env bash
ok=0; bad=0
pass() { echo "[TAMAM] $1"; ok=$((ok+1)); }
fail() { echo "[EKSİK] $1 -> $2"; bad=$((bad+1)); }

echo "=== Testful doctor ==="

if command -v adb >/dev/null 2>&1; then ADB="adb"
elif [ -x "$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" ]; then ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
else ADB=""; fi

if [ -n "$ADB" ]; then pass "adb ($ADB)"; else fail "adb" "Android SDK platform-tools kur ya da PATH'e ekle"; fi

if [ -n "$ADB" ]; then
  devices=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}')
  unauth=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="unauthorized" {print $1}')
  if [ -n "$devices" ]; then
    pass "cihaz: $(printf '%s ' $devices)"
  elif [ -n "$unauth" ]; then
    fail "cihaz yetkisiz: $(printf '%s ' $unauth)" "telefonda 'USB hata ayıklamaya izin ver' diyaloğunu onayla (bu bilgisayara her zaman izin ver)"
  else
    fail "bağlı cihaz yok" "emülatör başlat ya da USB ile cihaz bağla"
  fi
fi

free_gb=$(df -BG /c 2>/dev/null | awk 'NR==2 {gsub("G","",$4); print $4}')
if [ -n "$free_gb" ] && [ "$free_gb" -lt 8 ]; then
  fail "disk: ${free_gb}GB boş" "en az 8GB önerilir — emülatör boot etmeyebilir (TEMP maestro*, flutter clean, gradle cache)"
else
  pass "disk: ${free_gb:-?}GB boş"
fi

command -v flutter >/dev/null 2>&1 && pass "flutter" || fail "flutter" "Flutter SDK PATH'te değil"
command -v java    >/dev/null 2>&1 && pass "java"    || fail "java" "JDK 17+ gerekli (Maestro için)"

if command -v maestro >/dev/null 2>&1; then M="maestro"
elif [ -x "C:/dev/maestro/bin/maestro" ]; then M="C:/dev/maestro/bin/maestro"
else M=""; fi
if [ -n "$M" ]; then pass "maestro ($M)"; else fail "maestro" "kurulum: GitHub releases maestro.zip -> C:\\dev\\maestro (references/engines.md)"; fi

if command -v patrol >/dev/null 2>&1; then P="patrol"
elif [ -f "$LOCALAPPDATA/Pub/Cache/bin/patrol.bat" ]; then P="$LOCALAPPDATA/Pub/Cache/bin/patrol.bat"
else P=""; fi
if [ -n "$P" ]; then pass "patrol_cli ($P)"; else fail "patrol_cli" "dart pub global activate patrol_cli"; fi

echo "=== sonuç: $ok tamam, $bad eksik ==="
[ "$bad" -eq 0 ]

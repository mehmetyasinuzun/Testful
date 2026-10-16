#!/usr/bin/env bash
# Testful CI: emülatör açıkken koşan ölçüm boru hattı.
# install → keşif (map) → senaryolar (run) → logcat → kaos (monkey).
# Her adımın sonucu $OUT/steps.env'e yazılır; karar summary.mjs'te verilir.
# Bu script bilerek 0 ile çıkar: emülatör adımı yarıda kesilmesin, rapor her zaman çıksın.
#
# env: TESTFUL_HOME APK PKG OUT APP_DIR MAX_ACTIONS MONKEY_EVENTS SCENARIOS_GLOB MATRIX HAS_SCENARIOS
set -u

T="node $TESTFUL_HOME/cli/testful.mjs"
mkdir -p "$OUT"
export TESTFUL_LOG_DIR="$OUT/logs"
step() { echo "$1=$2" >> "$OUT/steps.env"; }

echo "::group::Kurulum ($PKG)"
adb wait-for-device
adb logcat -c || true
if adb install -r -g "$APK"; then step install ok; else step install fail; echo "::endgroup::"; exit 0; fi
$T animations off || true
echo "::endgroup::"

echo "::group::Otonom keşif (map, en çok $MAX_ACTIONS eylem)"
if $T map --pkg "$PKG" --out "$OUT/map" --max "$MAX_ACTIONS"; then step map ok; else step map fail; fi
echo "::endgroup::"

if [ "$HAS_SCENARIOS" = "true" ]; then
  echo "::group::Senaryolar ($SCENARIOS_GLOB)"
  args=(run "$APP_DIR" "$SCENARIOS_GLOB")
  [ -n "$MATRIX" ] && args+=(--matrix "$MATRIX")
  if node "$TESTFUL_HOME/cli/testful.mjs" "${args[@]}"; then step run ok; else step run fail; fi
  latest="$(ls -1d "$APP_DIR"/.qa/results/*/ 2>/dev/null | sort | tail -1)"
  [ -n "$latest" ] && cp -r "$latest" "$OUT/run"
  echo "::endgroup::"
else
  step run skipped
fi

adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true

if [ "${MONKEY_EVENTS:-0}" -gt 0 ] 2>/dev/null; then
  echo "::group::Kaos (monkey, $MONKEY_EVENTS olay, seed 42)"
  $T monkey "$PKG" "$MONKEY_EVENTS" 42 "$OUT/monkey-logcat.txt" && step monkey ok || step monkey fail
  echo "::endgroup::"
else
  step monkey skipped
fi

# Son durumun ekran görüntüsü (çökme sonrası teşhis için).
adb exec-out screencap -p > "$OUT/final.png" 2>/dev/null || true
exit 0

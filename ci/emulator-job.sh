#!/usr/bin/env bash
# Testful CI: emülatör açıkken koşan ölçüm boru hattı.
# install → keşif (map) → senaryolar (run) → smoke (soğuk açılış + a11y + kaos).
# Her aşama ekran videosuna kaydedilir ($OUT/video/<aşama>.mp4).
# Her adımın sonucu $OUT/steps.env'e yazılır; karar summary.mjs'te verilir.
# Bu script bilerek 0 ile çıkar: emülatör adımı yarıda kesilmesin, rapor her zaman çıksın.
#
# env: TESTFUL_HOME APK PKG OUT APP_DIR MAX_ACTIONS MONKEY_EVENTS SCENARIOS_GLOB MATRIX
#      HAS_SCENARIOS RECORD_VIDEO
set -u

T="node $TESTFUL_HOME/cli/testful.mjs"
mkdir -p "$OUT"
export TESTFUL_LOG_DIR="$OUT/logs"
step() { echo "$1=$2" >> "$OUT/steps.env"; }

# --- Ekran videosu ---------------------------------------------------------
# screenrecord tek seferde en çok 180 sn kaydeder; aşama boyunca parça parça
# kaydedip sonunda ffmpeg ile birleştiririz. SIGINT ile durdurulan parça düzgün kapanır.
REC_DIR=/sdcard/testful-rec
REC_PID=""
REC_SIZE=""
rec_start() {
  [ "${RECORD_VIDEO:-true}" = "true" ] || return 0
  if [ -z "$REC_SIZE" ]; then
    # Yarı çözünürlük: telefonda izlemeye yeter, dosyayı küçük tutar.
    REC_SIZE="$(adb shell wm size | sed -n 's/.*size: \([0-9]*\)x\([0-9]*\).*/\1 \2/p' | tail -1 | awk '{printf "%dx%d", $1/2, $2/2}')"
  fi
  local name="$1"
  rm -f "$OUT/.rec-stop"
  adb shell mkdir -p "$REC_DIR" >/dev/null 2>&1
  (
    i=1
    while [ ! -f "$OUT/.rec-stop" ]; do
      adb shell screenrecord --time-limit 170 --bit-rate 1500000 ${REC_SIZE:+--size "$REC_SIZE"} \
        "$REC_DIR/$name-$(printf %02d "$i").mp4" >/dev/null 2>&1 || break
      i=$((i + 1))
    done
  ) &
  REC_PID=$!
}
rec_stop() {
  [ -n "$REC_PID" ] || return 0
  touch "$OUT/.rec-stop"
  # Döngü tam o an yeni parça başlatmış olabilir: döngü bitene kadar durdurmayı tekrarla.
  for _ in $(seq 1 15); do
    adb shell pkill -INT screenrecord >/dev/null 2>&1 || true
    kill -0 "$REC_PID" 2>/dev/null || break
    sleep 1
  done
  wait "$REC_PID" 2>/dev/null
  REC_PID=""
  sleep 1
  mkdir -p "$OUT/video/parts"
  adb pull "$REC_DIR/." "$OUT/video/parts/" >/dev/null 2>&1 || true
  adb shell rm -rf "$REC_DIR" >/dev/null 2>&1
}
rec_merge() {
  local parts="$OUT/video/parts"
  [ -d "$parts" ] || return 0
  for name in $(ls "$parts" | sed -n 's/-[0-9][0-9]\.mp4$//p' | sort -u); do
    local segs=("$parts/$name"-*.mp4)
    if [ "${#segs[@]}" -eq 1 ]; then
      mv "${segs[0]}" "$OUT/video/$name.mp4"
    elif command -v ffmpeg >/dev/null 2>&1 || { sudo apt-get install -y -qq ffmpeg >/dev/null 2>&1 && command -v ffmpeg >/dev/null; }; then
      printf "file '%s'\n" "${segs[@]}" > "$parts/$name.txt"
      if ffmpeg -loglevel error -f concat -safe 0 -i "$parts/$name.txt" -c copy "$OUT/video/$name.mp4"; then
        rm -f "${segs[@]}"
      fi
    else
      mv "${segs[@]}" "$OUT/video/"   # ffmpeg yoksa parçalar sırayla kalır
    fi
  done
  rm -rf "$parts"
}

echo "::group::Kurulum ($PKG)"
adb wait-for-device
# Logcat'i koşu boyunca kesintisiz dosyaya akıt: cihazdaki halka tampon küçüktür
# (~256KB) ve sonradan "logcat -d" ile alınınca hata anı çoktan silinmiş olur.
adb logcat -G 16M >/dev/null 2>&1 || true
adb logcat -c || true
adb logcat -v threadtime > "$OUT/logcat.txt" 2>/dev/null &
LOGCAT_PID=$!
trap 'kill "$LOGCAT_PID" 2>/dev/null' EXIT
if adb install -r -g "$APK"; then step install ok; else step install fail; echo "::endgroup::"; exit 0; fi
echo "::endgroup::"

# testful çıkış kodları: 0 hazır · 1 engelleyici bulgu (ölçüm tamam) · 2 kullanım · 3 ortam hatası
outcome() { case "$1" in 0) echo ok ;; 1) echo findings ;; 3) echo env-error ;; *) echo fail ;; esac; }
latest_result() { ls -1d "$APP_DIR"/.qa/results/*/ 2>/dev/null | sort | tail -1; }

echo "::group::Otonom keşif (map, en çok $MAX_ACTIONS eylem / ${MAX_MINUTES:-8} dk)"
rec_start 1-kesif
$T map --pkg "$PKG" --out "$OUT/map" --max "$MAX_ACTIONS" --max-minutes "${MAX_MINUTES:-8}"
step map "$(outcome $?)"
rec_stop
echo "::endgroup::"

if [ "$HAS_SCENARIOS" = "true" ]; then
  echo "::group::Senaryolar ($SCENARIOS_GLOB)"
  rec_start 2-senaryolar
  args=(run "$APP_DIR" "$SCENARIOS_GLOB")
  [ -n "$MATRIX" ] && args+=(--matrix "$MATRIX")
  node "$TESTFUL_HOME/cli/testful.mjs" "${args[@]}"
  step run "$(outcome $?)"
  rec_stop
  latest="$(latest_result)"
  [ -n "$latest" ] && cp -r "$latest" "$OUT/run"
  echo "::endgroup::"
else
  step run skipped
fi

if [ "${MONKEY_EVENTS:-0}" -gt 0 ] 2>/dev/null; then
  echo "::group::Smoke + kaos (soğuk açılış, a11y, monkey $MONKEY_EVENTS olay, seed 42)"
  rec_start 3-kaos
  before="$(latest_result)"
  $T smoke "$APP_DIR" --pkg "$PKG" --events "$MONKEY_EVENTS" --seed 42
  step smoke "$(outcome $?)"
  rec_stop
  latest="$(latest_result)"
  [ -n "$latest" ] && [ "$latest" != "$before" ] && cp -r "$latest" "$OUT/smoke"
  echo "::endgroup::"
else
  step smoke skipped
fi

# Son durumun ekran görüntüsü (çökme sonrası teşhis için).
adb exec-out screencap -p > "$OUT/final.png" 2>/dev/null || true
kill "$LOGCAT_PID" 2>/dev/null; wait "$LOGCAT_PID" 2>/dev/null
rec_merge
rm -f "$OUT/.rec-stop"
exit 0

#!/usr/bin/env bash
# Testful deterministik koşucu (Faz 2 motorunun bash çekirdeği).
# Kullanım: run-suite.sh <app_dir> [scenario_id_glob]
#   <app_dir>: .qa/scenarios/<ID>.flow.yaml içeren uygulama kökü
# Güven kuralı: geçen senaryo 1 kez koşar; başarısız olan temiz durumda 2 kez
# daha tekrar → 3/3 fail = kesin, karışık = flaky-şüphesi.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/env.sh"
. "$HERE/log.sh"
[ -n "$MAESTRO" ] || { echo "HATA: maestro yok (doctor.sh)"; exit 2; }

APP_DIR="${1:?kullanım: run-suite.sh <app_dir> [id_glob]}"
GLOB="${2:-*}"
cd "$APP_DIR"

RUN="$(bash "$HERE/new-run.sh" .qa/results)"
SHOTS="$RUN/screenshots"; LOGS="$RUN/logcat"
RESULTS="$RUN/results.ndjson"; : > "$RESULTS"
qa_log "run: $RUN (glob=$GLOB)"

prelaunch() { # pkg -> clearState+launch adb ile (Maestro launchApp'i büyük APK'larda dadb timeout'una düşer)
  [ "${TESTFUL_PRELAUNCH:-0}" = "1" ] || return 0
  [ -n "$1" ] || return 0
  "$ADB" shell am force-stop "$1" >/dev/null 2>&1
  "$ADB" shell pm clear "$1" >/dev/null 2>&1
  "$ADB" shell monkey -p "$1" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  "$ADB" shell 'sleep 8'
}

run_once() { # flow_path log_path -> exit code
  ( cd "$SHOTS" && "$MAESTRO" test "$1" ) > "$2" 2>&1
}

for flow in $(find .qa/scenarios -name '*.flow.yaml' ! -name '_*' | sort); do
  id="$(basename "$flow" .flow.yaml)"
  case "$id" in $GLOB) ;; *) continue ;; esac
  pkg="$(awk '/^appId:/{print $2; exit}' "$flow")"

  "$ADB" reverse tcp:8080 tcp:8080 >/dev/null 2>&1 || true
  prelaunch "$pkg"
  run_once "$APP_DIR/$flow" "$LOGS/$id-1.txt"; c1=$?
  if [ $c1 -eq 0 ]; then
    printf '{"id":"%s","result":"pass","confidence":"kesin","retries":0}\n' "$id" >> "$RESULTS"
    qa_log "[PASS] $id"; continue
  fi
  # başarısız → temiz durumda 2 tekrar
  passes=0
  for n in 2 3; do
    [ -n "$pkg" ] && "$ADB" shell am force-stop "$pkg" >/dev/null 2>&1
    "$ADB" reverse tcp:8080 tcp:8080 >/dev/null 2>&1 || true
    prelaunch "$pkg"
    run_once "$APP_DIR/$flow" "$LOGS/$id-$n.txt"; [ $? -eq 0 ] && passes=$((passes+1))
  done
  if [ $passes -eq 0 ]; then
    printf '{"id":"%s","result":"fail","confidence":"kesin","retries":2}\n' "$id" >> "$RESULTS"
    qa_log "[FAIL] $id (3/3)"
  else
    printf '{"id":"%s","result":"flaky","confidence":"flaky-suphesi","retries":2}\n' "$id" >> "$RESULTS"
    qa_log "[FLAKY] $id (1.koşu fail, tekrarda $passes/2 geçti)"
  fi
done

# Kalıcı bulgu tohumu varsa (kaos/testability/performans) rapora ekle
[ -f "$APP_DIR/.qa/findings.seed.json" ] && cp "$APP_DIR/.qa/findings.seed.json" "$RUN/findings.extra.json"

node "$HERE/report.mjs" "$RUN" "$APP_DIR"
qa_log "rapor: $RUN/report.md"

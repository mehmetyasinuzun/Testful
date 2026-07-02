#!/usr/bin/env bash
# Testful deterministik koşucu (Faz 2 motorunun bash çekirdeği).
# Kullanım: run-suite.sh <app_dir> [scenario_id_glob]
#   <app_dir>: .qa/scenarios/<ID>.flow.yaml içeren uygulama kökü
# Güven kuralı: geçen senaryo 1 kez koşar; başarısız olan temiz durumda 2 kez
# daha tekrar → 3/3 fail = kesin, karışık = flaky-şüphesi.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/env.sh"
[ -n "$MAESTRO" ] || { echo "HATA: maestro yok (doctor.sh)"; exit 2; }

APP_DIR="${1:?kullanım: run-suite.sh <app_dir> [id_glob]}"
GLOB="${2:-*}"
cd "$APP_DIR"

RUN="$(bash "$HERE/new-run.sh" .qa/results)"
SHOTS="$RUN/screenshots"; LOGS="$RUN/logcat"
RESULTS="$RUN/results.ndjson"; : > "$RESULTS"
echo "run: $RUN"

run_once() { # flow_path log_path -> exit code
  ( cd "$SHOTS" && "$MAESTRO" test "$1" ) > "$2" 2>&1
}

for flow in $(find .qa/scenarios -name '*.flow.yaml' ! -name '_*' | sort); do
  id="$(basename "$flow" .flow.yaml)"
  case "$id" in $GLOB) ;; *) continue ;; esac
  pkg="$(awk '/^appId:/{print $2; exit}' "$flow")"

  "$ADB" reverse tcp:8080 tcp:8080 >/dev/null 2>&1 || true
  run_once "$APP_DIR/$flow" "$LOGS/$id-1.txt"; c1=$?
  if [ $c1 -eq 0 ]; then
    printf '{"id":"%s","result":"pass","confidence":"kesin","retries":0}\n' "$id" >> "$RESULTS"
    echo "[PASS] $id"; continue
  fi
  # başarısız → temiz durumda 2 tekrar
  passes=0
  for n in 2 3; do
    [ -n "$pkg" ] && "$ADB" shell am force-stop "$pkg" >/dev/null 2>&1
    "$ADB" reverse tcp:8080 tcp:8080 >/dev/null 2>&1 || true
    run_once "$APP_DIR/$flow" "$LOGS/$id-$n.txt"; [ $? -eq 0 ] && passes=$((passes+1))
  done
  if [ $passes -eq 0 ]; then
    printf '{"id":"%s","result":"fail","confidence":"kesin","retries":2}\n' "$id" >> "$RESULTS"
    echo "[FAIL] $id (3/3)"
  else
    printf '{"id":"%s","result":"flaky","confidence":"flaky-suphesi","retries":2}\n' "$id" >> "$RESULTS"
    echo "[FLAKY] $id (1.koşu fail, tekrarda $passes/2 geçti)"
  fi
done

node "$HERE/report.mjs" "$RUN" "$APP_DIR"
echo "rapor: $RUN/report.md"

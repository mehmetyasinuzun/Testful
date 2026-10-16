#!/usr/bin/env bash
# Testful CI: Firebase Test Lab Robo testi (gerçek/sanal Google cihazları).
# Çıktılar: $OUT/outcomes.json (cihaz başına sonuç), $OUT/gcloud.log, $OUT/results/ (video,
# ekran görüntüleri, logcat — GCS'ten). Karar firebase-summary.mjs'te.
#
# NOT: Firebase Test Lab 30 Eylül 2027'de kapanıyor (halefi: Google Cloud Developer
# Device Platform). Bu betik o tarihe kadar çalışır; geçiş tek dosyalık iştir.
#
# env: APK OUT DEVICES (satır başına bir --device değeri) TIMEOUT ROBO_DIRECTIVES PROJECT
set -uo pipefail
mkdir -p "$OUT"

args=(firebase test android run --type robo --app "$APK" --timeout "${TIMEOUT:-5m}"
      --client-details "matrixLabel=testful-${GITHUB_RUN_ID:-local}" --format=json --quiet)
while IFS= read -r d; do
  d="$(echo "$d" | xargs)"
  [ -n "$d" ] && args+=(--device "$d")
done <<< "${DEVICES:-model=MediumPhone.arm,version=33}"
[ -n "${ROBO_DIRECTIVES:-}" ] && args+=(--robo-directives "$ROBO_DIRECTIVES")
[ -n "${PROJECT:-}" ] && args+=(--project "$PROJECT")

echo "::group::gcloud firebase test android run"
gcloud "${args[@]}" > "$OUT/outcomes.json" 2> >(tee "$OUT/gcloud.log" >&2)
code=$?
echo "::endgroup::"
echo "$code" > "$OUT/exit-code"

# Ham sonuçlar (video, ekran görüntüleri, logcat) varsayılan GCS kovasında.
gcs="$(grep -o 'storage/browser/[^]]*' "$OUT/gcloud.log" | head -1 | sed 's#storage/browser/##; s#/*$##')"
if [ -n "$gcs" ]; then
  echo "gs://$gcs" > "$OUT/gcs-path"
  mkdir -p "$OUT/results"
  # Yalnız işe yarayanlar: video, ekran görüntüleri, logcat, robo özeti
  gcloud storage cp -r "gs://$gcs/*" "$OUT/results/" >/dev/null 2>&1 || echo "::warning::Test Lab ham sonuçları indirilemedi ($gcs)"
  find "$OUT/results" -type f ! \( -name '*.mp4' -o -name '*.png' -o -name 'logcat' -o -name '*.json' -o -name '*.txt' \) -delete 2>/dev/null
fi
exit 0

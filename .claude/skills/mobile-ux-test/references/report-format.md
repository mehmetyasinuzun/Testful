# Rapor Formatı ve Artefaktlar

## Koşu klasörü
`testful run` / `testful smoke` üretir: `.qa/results/<run-id>/` (run-id: `YYYYMMDD-HHMMSS`)

```
.qa/results/20261016-142233/
├── report.md            insan için (Türkçe) — karar, sıradaki adımlar, bulgular, fark
├── report.json          makine için (schema: testful/report@1)
├── run.json             ham ölçüm girdisi (testful report bunu yeniden işler)
├── findings.extra.json  (opsiyonel) AI/vision bulguları — sen yazarsın
├── logs/<ID>-<n>.txt    Maestro çıktısı (deneme başına)
├── logcat/<ID>-<n>.txt  yalnız başarısız/şüpheli denemelerin logcat'i
├── debug/<ID>-<n>/      Maestro debug çıktısı (hata anı ekran görüntüleri)
└── screenshots/<durum>/ flow'ların takeScreenshot çıktıları (normal, dark, ...)
```
smoke ek olarak: `launch.png/.xml`, `launch-logcat.txt`, `monkey.txt`, `monkey-logcat.txt`.

## Karar (status) ve çıkış kodu
| status | ship_ready | exit | anlamı |
|---|---|---|---|
| `ready` | true | 0 | engelleyici bulgu yok |
| `not-ready` | false | 1 | kritik bulgu ya da kesin+yüksek bulgu var |
| `inconclusive` | false | 3 | ortam hatası (cihaz koptu, disk dolu, Maestro sürücüsü) — UYGULAMA HATASI DEĞİL |

Engelleyici = `kritik` (flaky değilse) ya da `yüksek` + `kesin`. Flaky asla engellemez.

## report.json (özet)
```json
{
  "schema": "testful/report@1", "run_id": "...", "kind": "run|smoke",
  "status": "not-ready", "ship_ready": false,
  "app": {"package": "com.x", "framework": "flutter"},
  "device": {"serial": "emulator-5554", "model": "...", "android": "15"},
  "totals": {"scenarios": 7, "passed": 5, "failed": 1, "flaky": 1, "env_error": 0, "findings": 3},
  "blocking": ["F-01"],
  "scenarios": [{"id": "NAV-ab12@dark", "flow": "NAV-ab12.flow.yaml", "state": "dark",
                 "result": "fail", "confidence": "kesin", "attempts": 3, "passes": 0,
                 "reason": "Assert that \"Kaydet\" is visible... FAILED",
                 "crash": {"type": "crash", "stack": ["..."]}, "logs": ["logs/..."], "screenshots": []}],
  "findings": [{"id": "F-01", "type": "crash|anr|scenario-fail|a11y|performance|vision|...",
                "severity": "kritik", "confidence": "kesin", "title": "...", "detail": "...",
                "source": "scenario:NAV-ab12", "evidence": ["logcat/..."], "key": "kararlı-anahtar"}],
  "diff": {"previous_run": "...", "new": [], "resolved": [], "persisting": []},
  "next_actions": ["Düzelt: ..."]
}
```
`--json` bayrağı stdout'a bunun kompakt hâlini basar (loglar stderr'e gider).

## AI/vision bulgularını eklemek
Koşu klasörüne `findings.extra.json` yaz, sonra `testful report <run_dir>`:
```json
{"findings": [{"type": "vision", "severity": "orta", "confidence": "muhtemel",
  "title": "Kaydet butonu klavyenin altında kalıyor", "detail": "...",
  "evidence": ["screenshots/normal/NAV-ab12-1.png"], "status": "open"}]}
```
`status`: `open | fixed | fix-regressed | blocked` (`fixed` engellemez).

## Önem tanımları
- **kritik** — çökme/ANR ya da ana akışı bitiren engel
- **yüksek** — ana akışta yanlış davranış
- **orta** — UX bozukluğu (taşma, boş durum eksikliği, yanıltıcı durum)
- **düşük** — kozmetik

## Güven tanımları
- **kesin** — 3/3 fail YA DA aynı logcat stack'i ≥2 kez (deterministik kanıt)
- **muhtemel** — kanıt güçlü ama tek koşu ya da yalnız vision yorumu
- **flaky-şüphesi** — karışık sonuç; karantinaya alınır, fix loop'a girmez

## Fark (run-diff)
Her koşu aynı `.qa/results/` altındaki bir önceki aynı türden koşuyla bulgu
anahtarları (`key`) üzerinden karşılaştırılır: yeni / çözülen / devam eden.

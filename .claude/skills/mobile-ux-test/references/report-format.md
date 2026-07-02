# Rapor Formatı ve Artefaktlar

## Koşu klasörü
`scripts/new-run.sh` üretir: `.qa/results/<run-id>/` (run-id: `YYYYMMDD-HHMMSS`)

```
.qa/results/20260615-142233/
├── report.md        insan için (Türkçe)
├── report.json      makine için (run-diff bunun üstünden çalışır)
├── screenshots/     <senaryoID>-<adımNo>-<slug>.png
├── logcat/          monkey.txt, <senaryoID>.txt
└── flows/           koşulan flow kopyaları (yeniden üretilebilirlik)
```

`.qa/results/` ve `.qa/config.local.yaml` gitignore'a girer;
`.qa/scenarios/` commit'lenir.

## report.json şeması
```json
{
  "run_id": "20260615-142233",
  "app": {"package": "com.example.app", "framework": "flutter", "version": "1.2.0"},
  "tier": "core",
  "device": {"id": "emulator-5554", "android": "14", "kind": "emulator"},
  "driver": "patrol",
  "totals": {"passed": 9, "failed": 2, "flaky": 1, "blocked": 0},
  "scenarios": [
    {
      "id": "MAP-01",
      "title": "Yer ara ve rota çiz",
      "result": "fail",
      "retries": 2,
      "confidence": "kesin",
      "steps": [
        {"n": 1, "do": "launch", "expect": "...", "ok": true,
         "shot": "screenshots/MAP-01-1-launch.png"}
      ],
      "finding": {
        "severity": "yüksek",
        "title": "Rota çizgisi hiç görünmüyor",
        "repro": ["uygulamayı aç", "Kadıköy ara", "Yol tarifi'ne bas"],
        "evidence": ["screenshots/MAP-01-5-rota.png", "logcat/MAP-01.txt"],
        "suspected_cause": {"file": "lib/map/route_layer.dart", "line": 120,
                            "note": "polyline listesi boş dönüyor"},
        "suggested_fix": "route response parse'ında ... ",
        "status": "open"
      }
    }
  ]
}
```

`finding.status`: `open | fixed | fix-regressed | blocked`.
`finding.severity` tipleri arasında `testability` bulguları da olabilir
(eksik Key/Semantics — düzeltmesi testability patch'tir).

## Önem tanımları
- **kritik** — çökme/ANR ya da ana akışı bitiren engel
- **yüksek** — ana akışta yanlış davranış
- **orta** — UX bozukluğu (taşma, boş durum eksikliği, yanıltıcı durum)
- **düşük** — kozmetik

## Güven tanımları
- **kesin** — 3/3 fail YA DA aynı logcat stack'i ≥2 kez (deterministik kanıt)
- **muhtemel** — kanıt güçlü ama tek koşu ya da yalnız vision yorumu
- **flaky-şüphesi** — karışık sonuç; karantinaya alınır, fix loop'a girmez

## report.md yapısı (Türkçe)
1. **Özet** — aktif tier, geçen/kalan, net karar: "piyasaya hazır mı?"
   (hazır / şu engellerle hazır değil)
2. **Bulgular** — önem sırasıyla: ID · başlık · önem · güven · repro ·
   ekran görüntüsü · şüpheli kök-neden (dosya:satır) · önerilen düzeltme
3. **Flaky karantinası** — ayrı başlık, fix önerisi YOK
4. **Önceki koşuya fark** — yeni / çözülen / devam eden (report.json diff)
5. **Kapsam dışı** — bütçe nedeniyle kesilen senaryolar

# Testful — Yol Haritası

Vizyon: kaynak-koda duyarlı, iki-hızlı (AI üretir/yargılar — deterministik
katman koşar), güven-öncelikli mobil QA ajanı. Para birimimiz: bulgulara
duyulan güven (düşük yanlış-alarm + tekrarlanabilirlik).

## Mimari: Ölçüm Çekirdeği + İnce AI Kabuğu (tek boru hattı)
- **Çekirdek (AI'sız, CI'da koşar):** crawler (`explore.mjs`) · koşucu
  (`run-suite.sh`: izolasyon + 3× retry + flaky-karantina) · kaos
  (`monkey.sh` sabit seed) · logcat imzaları · rapor üreteci (`report.mjs`)
  · günlük log (`log.sh` → `.qa/logs/`).
- **AI kabuğu (seçici, pakete bakar):** senaryo yazarı · vision hakemi (yeni
  ekran başına 1 kez, stateless) · kök-neden · git-safe fix loop · blocker →
  kullanıcıya sor → devam.
- **Sözleşmeler (sabit):** senaryo çifti `<ID>.yaml` (oracle) + `<ID>.flow.yaml`
  (motor-native) · tek temas noktası `report.json` + `graph.json`.
- İki yüz: **Verifier** (kaynak var → niyet senaryoları + fix) · **Explorer**
  (APK-only → keşif + harita + görsel tarama). Kaynak = harita, uygulama = arazi.

## Faz 0 — Ortam ✅ (2026-06-15)
- [x] Skill v2/v3: güven kuralları, maliyet piramidi, oracle format, git-safe loop
- [x] references/ (senaryo paketleri, rapor şeması, motor rehberi + saha dersleri)
- [x] scripts/ deterministik çekirdek (12 script)
- [x] Maestro cli-2.6.1 (Windows native) + patrol_cli 4.4.0
- [x] AVD "testful" (Pixel 7, Android 15) + "temiz" snapshot + doctor 6/6
- [x] git repo + .gitignore

## Faz 1 — İlk kanıt ✅ (2026-07-02, hedef: compass_app)
- [x] Kaynak analizi + 6 oracle'lı senaryo çifti (düşman-doğrulamalı üretim)
- [x] KAOS: seed'li monkey ×3 → ANR doğru şekilde flaky-karantinaya alındı
- [x] Suite koşucu: retry politikası + results.ndjson + report.md/json
- [x] 43 bulguluk vision paneli (ekran başına stateless sub-agent hakemler)
- [x] Fix-loop uçtan uca: 5 bulgu senior best-practice ile düzeltildi
      (placeholder/scrim/label/seçim-vurgusu/banner), bulgu-başına commit,
      dart analyze 0 hata, CORE+AUTH smoke yeşil, görsel doğrulama yapıldı
- [x] 3 testability patch (Semantics) — araç uygulamayı iyileştirdi
- [x] Explorer v0 (AI'sız crawler → graph.json) + günlük log sistemi
- [x] GitHub yayını (README/LICENSE/examples)
- Açık: ENV-02 (adb reverse köprü gecikmesi BOOK akışlarında timeout —
  kalıcı çözüm Faz 2 adb-direct sürüş)

## Faz 2 — Motor: `testful` CLI (TypeScript) ⬜ SIRADAKİ
- [ ] `testful run|doctor|report` tek komut; bash çekirdeğini absorbe eder
- [ ] Maestro'suz sürüş opsiyonu (adb-direct; ENV-02'yi kökten çözer)
- [ ] Durum matrisi otomasyonu: karanlık mod · font 1.3× · döndürme · offline
- [ ] Uygulama haritası v1: graph.json → report.md'de mermaid (kapsama boyalı)
- [ ] Motorun kendi test paketi + 10× koşu flakiness ölçümü

## Faz 3 — Ürünleşme ⬜
- [ ] **Çoklu AI sağlayıcı:** `testful judge --provider deepseek|openai|anthropic`
      (BYOK; sözleşme = ölçüm paketi → JSON hüküm; vision destekli her model)
- [ ] MCP server: motoru saran ince adaptör (Cursor ve diğer istemciler)
- [ ] Görsel regresyon: baseline screenshot + algısal diff (deterministik)
- [ ] Run-diff raporu: yeni / çözülen / devam eden
- [ ] İnteraktif HTML harita (screenshot-düğümlü, tıklanabilir, ısı haritası)
- [ ] Linux CI: KVM'li Docker emülatör konteyneri
- [ ] RESILIENCE / PERFORMANCE / STORE tier'larının tam otomasyonu

## Faz 4 — Yayılım ⬜
- [ ] 2-3 farklı uygulama × 10 koşu stabilite kanıtı (Kotlin native dahil)
- [ ] EN dokümantasyon + npm paketi
- [ ] iOS (macOS/CI) ve bulut cihaz çiftliği opsiyonu

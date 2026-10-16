# Testful — Yol Haritası

Vizyon: kaynak-koda duyarlı, iki-hızlı (AI üretir/yargılar — deterministik
katman koşar), güven-öncelikli mobil QA ajanı. Para birimimiz: bulgulara
duyulan güven (düşük yanlış-alarm + tekrarlanabilirlik).

## Mimari: Ölçüm Çekirdeği + İnce AI Kabuğu (tek boru hattı)
- **Çekirdek (AI'sız, CI'da koşar):** `testful` CLI — `smoke` (senaryosuz
  karar) · `map` (crawler) · `author --from-map` · `run` (izolasyon + 3× retry +
  flaky-karantina + logcat çökme atfı) · `report` (karar + run-diff) · günlük
  log (`.qa/logs/`).
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

## Faz 2 — Motor: `testful` CLI 🔄 (olgunluk-kapılı, modül modül)
Tasarım yasası (SpeakSmith saha dersi): **seçiciler kaynaktan tahmin edilmez —
observe-first**: her ekranın GERÇEK a11y ağacından çıkarılır; kaynak akışı
öngörür, ağaç seçiciyi verir. Kapı geçilmeden sonraki modüle GEÇİLMEZ.
- [x] v0.1 `observe` (2026-07-03): ekran paketi — ağaç+png+selectors.json;
      sekme/birleşik düğüm → otomatik `[\s\S]*`, etiketsiz alan → koordinat +
      a11y-eksik bayrağı. SpeakSmith'te canlı doğrulandı (dashboard + form).
- [x] v0.1 façade: `testful run|doctor` kanıtlı bash çekirdeğine delege;
      `TESTFUL_PRELAUNCH=1` (adb-launch — büyük APK dadb timeout çözümü)
- [x] **KAPI-1** ✅ (2026-07-03): observe compass_app'te doğrulandı (login ekranı:
      2 alan + Login butonu, seçiciler ground-truth)
- [x] v0.2 `map` ✅: otonom keşif → graph.json + **kapsama metriği** + engelde
      alan-doldurma sezgisi + geçici-hata dayanıklılığı. SpeakSmith: 3 ekran,
      4 geçiş, ~%45 kapsama (onboarding isim-kapısında durdu — doğru davranış).
- [x] v0.2 `setup` ✅: yerel AVD'yi imajdan kurar (indirmesiz); `package.json`
      bin=testful (npm link → global `testful`); tek-komut `doctor`
- [x] **v0.3** ✅ (2026-10-16): mimari sağlamlaştırma + ürünleşme
      - `smoke`: senaryosuz karar (kur → soğuk açılış → çökme/ANR → a11y → seed'li kaos)
      - `author --from-map`: haritadan her ekrana regresyon flow'u (AI'sız, ezmez, sır-güvenli)
      - `run` Node'a taşındı: env-fail ≠ senaryo-fail (exit 3), logcat çökme atfı,
        Maestro hata nedeni, zaman aşımı, izolasyon, durum matrisi geri yükleme, run-diff
      - tek rapor şeması (`testful/report@1`), `--json` kompakt karar, `next_actions`
      - status bar demo modu, adb geçici kopma dayanıklılığı, disk ön-kontrolü
      - crawler: etiketli-önce, frontier dönüşü, dolu alan koruması, takılma nedeni, mermaid
      - `init` (iskelet + skill), platform-bağımsız doctor/setup, 24 birim/entegrasyon testi
- [x] **v0.3 CI** ✅ (2026-10-16): GitHub Actions bulut emülatörü (reusable workflow,
      aşama başına video, PR yorumu, APK artifact); keşif: kaydırma, giriş/OTP formu,
      BFS gezinme + yeniden giriş, süre sınırı; `judge` (Claude, JSON şemalı); Supabase
      test kullanıcısı; Firebase Test Lab (30.09.2027'ye dek); birim testler 3 OS'ta
- [ ] **KAPI-2:** 2 uygulama × 10 koşu flakiness ölçümü — altyapı hazır:
      `field-trials.yml` (F-Droid: Fossify Notes, Catima, OpenTracks × N, haftalık)
- [ ] Patrol koşucusu (`engine: patrol` senaryoları için)
- [ ] Görsel regresyon akışı: `assertScreenshot` baseline üretimi (`testful baseline`)

## Faz 3 — Ürünleşme ⬜
- [~] `testful judge`: Claude ✅ · diğer sağlayıcılar (`--provider deepseek|openai`) ⬜
      (BYOK; sözleşme = ölçüm paketi → JSON hüküm; vision destekli her model)
- [ ] MCP server: motoru saran ince adaptör (Cursor ve diğer istemciler)
- [ ] İnteraktif HTML harita (screenshot-düğümlü, tıklanabilir, ısı haritası)
- [x] Linux CI: GitHub Actions KVM'li emülatör (Docker'a gerek kalmadı) — docs/CI.md
- [ ] RESILIENCE / PERFORMANCE / STORE tier'larının tam otomasyonu

## Faz 4 — Yayılım ⬜
- [ ] 2-3 farklı uygulama × 10 koşu stabilite kanıtı (Kotlin native dahil)
- [ ] EN dokümantasyon + npm paketi
- [ ] iOS (macOS/CI) ve bulut cihaz çiftliği opsiyonu

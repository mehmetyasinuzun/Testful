# Testful — Yol Haritası

Vizyon: kaynak-koda duyarlı, iki-hızlı (AI üretir/yargılar — deterministik
katman koşar), güven-öncelikli mobil QA ajanı. Para birimimiz: bulgulara
duyulan güven (düşük yanlış-alarm + tekrarlanabilirlik).

## Mimari: üç katman, tek motor
- **Motor (çekirdek ürün):** `testful` CLI (TypeScript/Node) — run · doctor ·
  report. Retry, izolasyon, durum matrisi, artefakt toplama kodda; LLM'siz ve
  CI'da koşar.
- **Skill (AI beyni):** senaryo üretimi, vision hakemliği, kök-neden, git-safe
  fix loop. Motoru tek komutla çağırır, yalnız report.json + kanıtları okur.
- **MCP (kapı, Faz 3):** aynı motoru Cursor ve diğer istemcilere açan ince
  adaptör. Cihaz-tool'ları değil, motor sarmalayıcısı.

Katman sözleşmeleri (sabit):
1. Senaryo çifti: `<ID>.yaml` (oracle/metadata) + motor-native ikiz
   (`<ID>.flow.yaml` Maestro / `<id>_test.dart` Patrol). Motor çeviri yapmaz.
2. Motor çıktısı: `.qa/results/<run-id>/report.json` — AI'ın tek okuduğu şey.

İnşa sırası: ① Skill (hazır) → ② Motor (ilk gerçek koşudan ÖĞRENDİKTEN sonra,
gerçek uygulamaya karşı doğrulanarak) → ③ MCP adaptörü.

## Faz 0 — Ortam
- [x] Skill v2: güven kuralları, maliyet piramidi, oracle format, git-safe loop
- [x] references/ (senaryo paketleri, rapor şeması, motorlar)
- [x] scripts/ (doctor, reset, animations, screenshot, logcat-scan, monkey, new-run)
- [x] Maestro cli-2.6.1 (C:\dev\maestro, Windows native doğrulandı) + patrol_cli 4.4.0
- [x] Cihaz: AVD "testful" (Pixel 7 · Android 15 · google_apis) + "temiz" snapshot
      (animasyonlar kapalı gömülü — her koşu öncesi anında geri yüklenebilir)
- [x] Doctor 6/6 yeşil (2026-06-15)
- [x] git init (main) + .gitignore

## Faz 1 — İlk gerçek koşu (Flutter, Skill+Bash ile)
- [ ] Hedef Flutter projesinde Patrol kurulumu
- [ ] STATİK + KAOS + CORE senaryolar (senaryo çifti formatında) → ilk rapor
- [ ] Fix loop'un ilk gerçek bulguda uçtan uca denenmesi
- [ ] Durum matrisi (karanlık, font 1.3×, döndürme, offline)
- [ ] graph.json temeli: koşu sırasında ekran düğümleri + geçiş kenarlarını
      biriktir (uygulama haritasının verisi 1. günden toplanır)
- [ ] Motor gereksinim notları: Maestro/Patrol exit code'ları, zamanlamalar,
      logcat tuhaflıkları (Faz 2'nin girdisi)

## Faz 2 — Motor: testful CLI (TypeScript)
- [ ] `testful run [--tier] [--scenario]`: izolasyon + retry politikası +
      durum matrisi + artefakt toplama → report.json
- [ ] `testful doctor` (bash doctor'ı absorbe eder) · `testful report --diff`
- [ ] Uygulama haritası v1: graph.json → report.md içinde mermaid diyagram
      (kapsama boyalı: yeşil/kırmızı/gri kenarlar, kapsama %'si, yetim ekranlar)
- [ ] Skill'i motora bağla: yüzlerce Bash adımı → tek komut
- [ ] Motorun kendi test paketi (kendi ilacımızı içiyoruz)

## Faz 3 — MCP adaptörü + ürünleşme
- [ ] MCP server: motoru saran tool'lar (run_suite, get_report, run_scenario)
- [ ] Uygulama haritası v2 (yıldız özellik): interaktif HTML — screenshot-düğümlü,
      tıklanabilir (düğüm → o ekranın bulguları), ısı haritası + koşular arası
      harita diff'i (yeni/kaybolan kenar = özellik/regresyon sinyali)
- [ ] Görsel regresyon: baseline screenshot + algısal diff (deterministik)
- [ ] Run-diff raporu: yeni / çözülen / devam eden
- [ ] RESILIENCE / PERFORMANCE / STORE tier'larının tam otomasyonu

## Faz 4 — Yayılım
- [ ] Kotlin native projede uçtan uca koşu
- [ ] Açık kaynak paketleme: npm (motor) + skill + örnek repo + README
- [ ] iOS (Mac/CI) ve bulut cihaz çiftliği opsiyonu

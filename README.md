# Testful 🧭

**AI ile kod yazanların test yükünü alan Android test çekirdeği.**
Kodu Claude Code / Cursor ile değiştir → `testful smoke` + `testful run` → net bir
karar (`hazır / hazır değil / belirsiz`), kanıtlı bulgular ve "sıradaki adımlar".
Çekirdek sıfır bağımlılık (saf Node.js), kodun makinenden çıkmaz. İstersen
**bilgisayarsız**: GitHub Actions'ta bulut emülatöründe her push/PR'da koşar.

```
APK ──► smoke ──► map ──► author --from-map ──► run [--matrix] ──► report.json + report.md
        (senaryosuz      (otonom      (her ekrana giden       (izolasyon · 3× retry ·
         karar)           keşif)       regresyon flow'u)        flaky karantina · diff)
```

## Neden güvenilir?

Bir test aracının para birimi **bulgulara duyulan güvendir**. Testful yanlış alarmı
sistematik olarak eler:

| Sorun | Testful'ın yaptığı |
|---|---|
| Ortam arızası uygulama hatası gibi görünür | Cihaz kopması, dolu disk, Maestro sürücü hatası → `inconclusive` (exit 3), asla "kaldı" değil |
| Başka sürecin çökmesi (ör. emülatör servisi) | Çökmeler paket adına göre atfedilir; yalnız senin uygulaman bulgu üretir |
| Tek seferlik kırmızı | 1. fail → 2 tekrar; hepsi fail = **kesin**, karışık = **flaky** (karantina, engellemez) |
| Animasyon / saat / pil değişkenliği | Koşu boyunca animasyon kapalı + status bar demo modu; ayarlar sonra geri yüklenir |
| Kirli durum | Her deneme `pm clear` ile başlar |
| Tahmini seçiciler | Seçiciler gerçek a11y ağacından; regex-güvenli kaçış; benzersiz `resource-id` önceliği |
| Sır sızıntısı | Kimlik bilgileri `.qa/env.local`'da; flow'lara değer değil `${MAESTRO_EMAIL}` yazılır |

## Hızlı başlangıç

```bash
git clone https://github.com/mehmetyasinuzun/Testful.git
cd Testful && npm link          # artık her yerde: testful
testful doctor                  # neyin eksik olduğunu söyler (exit 0 = hazır)
testful setup                   # eksik AVD'yi yerel imajdan + Maestro'yu kurar
```

Kendi projende:

```bash
cd benim-uygulamam
testful init                    # .qa/testful.json (paket + APK otomatik bulunur), .gitignore, Claude skill'i
testful smoke --apk build/app/outputs/flutter-apk/app-debug.apk
testful map                     # otonom keşif → .qa/map/map.md (mermaid harita)
testful author --from-map       # her ekran için LAUNCH-00 / NAV-<imza> flow'ları (AI'sız)
testful run                     # tüm .qa/scenarios → rapor
testful run "NAV-*" --matrix dark,large-font,landscape,offline
```

Her koşu: `.qa/results/<run-id>/report.md` (insan) + `report.json` (makine) + kanıtlar.

### Bilgisayarsız: GitHub Actions (bulut emülatörü)

Uygulama reposuna tek dosya (`testful ci-init` üretir). Her push/PR'da GitHub'ın KVM'li
Linux makinesinde gerçek emülatör açılır, APK derlenir (Flutter / React Native / Expo /
native otomatik), `map` + `run` + `smoke` koşar; sonuç iş özetine ve PR yorumuna düşer,
aşama başına **ekran videosu** artifact olarak gelir. Telefondan takip edilebilir.

```yaml
jobs:
  testful:
    uses: mehmetyasinuzun/Testful/.github/workflows/testful.yml@main
    secrets: inherit
```

İsteğe bağlı: test hesabı (`MAESTRO_EMAIL`/`_PASSWORD` secrets), Supabase test kullanıcısı,
Claude ile görsel hakem (`ANTHROPIC_API_KEY`), Firebase Test Lab. Ayrıntı: [docs/CI.md](docs/CI.md).

## AI ajanlarıyla kullanım

Claude Code, `testful init`'in kopyaladığı skill'i (`.claude/skills/mobile-ux-test`)
otomatik tanır — *"uygulamayı test et"* ya da *"bir şey bozuldu mu bak"* demen yeter.
Başka bir ajan (Cursor, Codex, Gemini CLI…) için kural basit:

```bash
testful smoke --json   # stdout: kompakt JSON karar; loglar stderr'de
testful run --json
```

| Exit | Durum | Ajan ne yapmalı |
|---|---|---|
| 0 | `ready` | devam |
| 1 | `not-ready` | `findings[].detail` (stack/neden) + `evidence` + `next_actions` ile düzelt |
| 2 | kullanım hatası | komutu düzelt |
| 3 | `inconclusive` | `testful doctor` → ortamı düzelt; uygulama hatası **değil** |

AI'ın gördüğü ama CLI'nin göremediği şeyler (görsel bozukluk, yanlış metin) için:
koşu klasörüne `findings.extra.json` yaz → `testful report <run_dir>` → karar ve fark
yeniden hesaplanır. Şema: [report-format.md](.claude/skills/mobile-ux-test/references/report-format.md).

## Komutlar

| Komut | Ne yapar |
|---|---|
| `init [dir]` | `.qa/` iskeleti, paket/APK tespiti (Gradle, Expo, Manifest), `.gitignore`, skill kopyası |
| `doctor` | node, adb, cihaz, Maestro, Java 17+, **tüm ilgili disklerin** boş alanı, AVD; Flutter/Patrol opsiyonel |
| `setup` | AVD'yi yerel sistem imajından oluşturur; Windows'ta Maestro'yu `~/.maestro`'ya kurar (PATH'e dokunmaz) |
| `smoke` | kur → soğuk açılış süresi → açılış çökmesi → ilk ekran a11y (etiketsiz öğe, < 48dp hedef) → seed'li monkey → logcat imzaları |
| `observe` | o anki ekran: ağaç + PNG + Maestro seçicileri + a11y sorunları |
| `map` | otonom keşif: etiketliler önce, riskli butonlar (sil/çıkış/öde…) asla, dolu alanlar ezilmez; **kaydırır**, **giriş/OTP formunu** `MAESTRO_*` sırlarıyla doldurur, işi kalan ekrana bilinen yoldan (BFS) döner, oturum düşerse yeniden girer; `--max-minutes` süre sınırı; takılınca nedenini yazar |
| `judge` | haritadaki her benzersiz ekranı Claude ile görsel olarak değerlendirir → `judge.json` (`ANTHROPIC_API_KEY`; öneri niteliğinde) |
| `ci-init [repo]` | repoya GitHub Actions workflow'u ekler (bulut emülatörü, video, PR yorumu) |
| `author --from-map` | haritadaki her ekrana en kısa yoldan giden flow + oracle çifti; mevcut dosyaları ezmez |
| `run` | flow'ları koşar; Maestro çıktısından başarısız adımı, logcat'ten çökmeyi çıkarır; `--matrix` ile karanlık/font/yatay/çevrimdışı |
| `report` | AI bulgularıyla raporu yeniden üretir |
| `logcat-scan`, `screenshot`, `reset`, `animations` | küçük araçlar |

Ortam değişkenleri: `ANDROID_SERIAL` (çoklu cihazda seçim), `ANDROID_HOME`, `ADB`,
`MAESTRO`, `TESTFUL_LOG_DIR`, `TESTFUL_PRELAUNCH=1` (ağır APK'larda launch'ı adb'ye ver),
`TESTFUL_DEBUG=1` (stack trace).

## Gereksinimler

Node 18.15+ · Android SDK platform-tools · bir emülatör ya da USB cihaz · Maestro CLI
(`run` için) + JDK 17+. Flutter/Patrol yalnız Flutter derin modu için. API anahtarı ve
Docker **gerekmez**. Windows 10/11'de yerelde uçtan uca doğrulandı; Linux'ta emülatörlü
uçtan uca her PR'da CI'da koşar; birim testler Linux/macOS/Windows'ta CI'da yeşil. Ayrıntı: [REQUIREMENTS.md](REQUIREMENTS.md).

## Geliştirme

```bash
npm test        # node:test — cihaz gerektirmeyen tüm katmanlar (ayrıştırma, seçiciler,
                # logcat imzaları, rapor/diff, author, config, CLI çıkış kodları) +
                # keşif motoru sahte uygulama simülatöründe uçtan uca (giriş, kaydırma, gezinme)
```

Mimari: `cli/lib/` altında tek sorumluluklu modüller — `device` (adb, geçici bağlantı
kopmalarına dayanıklı), `tree` (ağaç → seçici), `logcat` (imzalar), `maestro` (koşucu +
çıktı sınıflama), `run` / `smoke` / `map` / `author` (komutlar), `report` (karar + fark).

## Saha dersleri

Gerçek koşulardan çıkıp koda/dokümana işlenenler: Flutter'ın birleşik semantics
düğümleri (`[\s\S]*`) · Maestro'nun Windows dadb hıçkırıkları (`stopApp: false`) ·
`adb reverse`'in sessiz ölümü (her denemeden önce yeniden uygulanır) · büyük APK
kurulumu sonrası adb'nin "offline" anı (otomatik `wait-for-device`) · monkey'in açık
bıraktığı bildirim paneli (otomatik kapatılır) · alan içeriğinin ekran imzasını
bozması · dolu C: sürücüsünün Maestro JVM'ini sessizce öldürmesi.
Ayrıntı: [engines.md](.claude/skills/mobile-ux-test/references/engines.md).

## Lisans

[MIT](LICENSE) — © 2026 Mehmet Yasin UZUN

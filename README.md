# Testful 🧭

**Kaynak-koda duyarlı, güven-öncelikli, AI-destekli mobil UX/UI test ajanı.**
APK'nı ver → uygulamayı otonom gezsin, ekran haritasını çıkarsın, her ekranı
görsel olarak yargılasın, bulguları tanımlı ve kanıtlı raporlasın — istersen
kaynak kodda düzeltip yeşile kadar tekrar koşsun.

TestSprite benzeri bulut servislerine **bedava ve self-hosted** alternatif:
kodun makinenden çıkmaz, koşucu katman tamamen deterministiktir.

> Durum: **Alpha (Faz 1 kanıtlandı).** Boru hattı gerçek bir emülatörde, gerçek
> bir Flutter uygulamasında (Flutter ekibinin resmî `compass_app` örneği) uçtan
> uca doğrulandı: 6 senaryo, seed'li kaos taraması, 43 bulguluk vision paneli ve
> 5 bulgunun kaynak kodda düzeltilip yeniden yeşil koşması dahil. Henüz "canlı"
> ürün değil — dürüst durum tablosu aşağıda.

---

## Mimari: Ölçüm Çekirdeği + İnce AI Kabuğu

```
APK (± kaynak kod)
      │
┌─────▼──────────────────────────────────────────┐
│ ÖLÇÜM ÇEKİRDEĞİ — deterministik, AI'SIZ, CI'da │
│  crawler (explore.mjs) · koşucu (run-suite.sh) │
│  monkey + logcat imzaları · ekran ağacı + SS   │
│  → graph.json + ölçüm paketi + report.json     │
└─────┬──────────────────────────────────────────┘
      │  yalnız KOMPAKT paket AI'ya gider
┌─────▼──────────────────────────────────────────┐
│ İNCE AI KABUĞU — seçici, pakete bakar          │
│  senaryo yazarı · vision hakemi (ekran başına  │
│  1 kez, stateless) · kök-neden · git-safe fix  │
└─────┬──────────────────────────────────────────┘
      ▼
 Uygulama haritası + tanımlı bulgular + rapor
```

- **AI asla tık-başına döngüde değildir** — token maliyeti ekran sayısıyla
  ölçeklenir, context şişmez.
- **İki yüz, tek boru hattı:** kaynak varsa *Verifier* (niyet-güdümlü isabetli
  senaryolar + otomatik düzeltme); yalnız APK varsa *Explorer* (otonom keşif +
  harita + görsel tarama). Kaynak her zaman "harita", çalışan uygulama "arazi".
- **Güven kuralları:** animasyonlar kapalı · her senaryo `pm clear` izolasyonlu
  · belirsiz fail 3× tekrar (3/3 = kesin, karışık = flaky-karantina, fix loop'a
  giremez) · sabit seed'li monkey · kanıt hiyerarşisi: logcat > assert > vision.

## Gereksinimler

| Gereksinim | Detay |
|---|---|
| İşletim sistemi | **Windows 10+ doğrulandı.** macOS/Linux teoride çalışır (bash + node + adb taşınabilir) ama henüz test edilmedi. iOS testi kapsam dışı (macOS ister). |
| RAM | **16 GB önerilir** (emülatör ~2-4 GB + Gradle derlemesi ağır). |
| Disk | **≥ 10 GB boş** (doctor 8 GB altında uyarır). Sistem imajı ~1,5 GB + AVD ~4 GB + Gradle cache. |
| Java | 17+ (Maestro için) |
| Android SDK | platform-tools (adb) + emulator + bir AVD (script'ler adb'yi `%LOCALAPPDATA%\Android\Sdk`'dan otomatik bulur) |
| Node.js | 18+ (crawler + rapor üreteci) |
| Maestro | CLI ([kurulum](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli); Windows'ta native çalışıyor — GitHub release zip + PATH) |
| Flutter + Patrol | Yalnız Flutter hedefleri ve derin mod için |
| **API anahtarı** | **HAYIR — bugün gerekmiyor.** AI kabuğu Claude Code oturumudur (aboneliğin). Çekirdek zaten AI'sızdır. |
| **Docker** | **HAYIR.** İzolasyon AVD snapshot ile ("temiz" snapshot = Android'in Docker'ı). Linux CI için Docker Faz 3'te. |

## Hızlı Başlangıç

### A) Claude Code ile (önerilen — tam deneyim)
```bash
git clone https://github.com/mehmetyasinuzun/Testful.git
cd Testful
claude   # Claude Code bu klasörde skill'i otomatik tanır
```
Sonra Claude'a de ki: *"şu uygulamayı test et: C:\yol\benim_flutter_app"* —
doctor'dan rapora kadar akışı skill yönetir.

Kendi projende kalıcı kullanmak için skill'i taşı:
```bash
# proje-bazlı:
cp -r .claude/skills/mobile-ux-test  <senin-projen>/.claude/skills/
# ya da tüm projelerde geçerli olsun: ~/.claude/skills/ altına kopyala
```

### B) Tek başına, AI'sız (çekirdek)
Senaryolar bir kez yazıldıktan sonra (elle ya da bir AI oturumunda ürettirip
commit'leyerek) her şey terminalden, sıfır token'la koşar:
```bash
S=.claude/skills/mobile-ux-test/scripts
bash $S/doctor.sh                              # ortam sağlık kontrolü
bash $S/run-suite.sh <app_dir> "CORE-*"        # senaryo paketi + retry + rapor
node $S/explore.mjs <package> <run_dir> 80     # otonom keşif → graph.json
bash $S/monkey.sh <package> 3000 42 out.txt    # seed'li kaos + logcat yakala
bash $S/logcat-scan.sh out.txt                 # çökme/ANR/overflow imzaları
```
Çıktılar: `<app_dir>/.qa/results/<run-id>/` → `report.md` (insan) +
`report.json` (makine) + ekran görüntüleri + logcat.

## Loglama

Araç çalıştığı yerde günlük log tutar: `<app_dir>/.qa/logs/YYYY-MM-DD.log`
(zaman damgalı; doctor, koşucu ve crawler aynı dosyaya yazar). Konumu
`TESTFUL_LOG_DIR` ortam değişkeniyle değiştirebilirsin. `.qa/results/` ve
loglar gitignore'lanır; `.qa/scenarios/` commit'lenir.

## Sık Sorulanlar

**Claude'a mecbur muyum? DeepSeek/OpenAI ile kullanabilir miyim?**
Çekirdek için hiçbir AI gerekmez. AI kabuğu (senaryo üretimi, vision hakemliği,
otomatik düzeltme) bugün Claude Code üzerinden çalışır çünkü agentic bir harness
ister (dosya okuma/yazma, çok adımlı döngü). **Ancak mimari bilinçli olarak
provider-bağımsız tasarlandı:** AI'ın sözleşmesi "ölçüm paketi (JSON + ekran
görüntüsü) al → yapılandırılmış hüküm döndür"dür. Yol haritasındaki `testful
judge --provider deepseek|openai|anthropic` komutu bu sözleşmeyi vision destekli
herhangi bir modele (GPT-4o, DeepSeek-VL, Claude API) kendi anahtarınla (BYOK)
açacak — bkz. Faz 3.

**Tek başına kullanabilir miyim?** Evet — yukarıdaki B modu. AI'sız modda
kaybettiğin şey: otomatik senaryo üretimi, görsel hakemlik ve otomatik düzeltme.
Kazandığın: CI'da sıfır maliyetli, deterministik regresyon koşuları.

**Uygulamam login istiyor / OTP var — takılır mı?**
Test hesabını gitignore'lu `.qa/config.local.yaml`'a koyarsın; ajan girer.
Aşamayacağı duvar (OTP/captcha/ödeme) = **blocker protokolü**: durur, ekranı
gösterir, sana sorar, cevabınla devam eder. Duvar "başarısızlık" değil
"devam noktası"dır.

**Hangi çerçeveler?** Flutter (Patrol derin mod + vision), Kotlin/Java native
ve React Native/Expo (Maestro). Vision katmanı çerçeve-bağımsızdır; en zor hedef
olan Flutter için tasarlandı — diğerleri daha da rahat.

**Bulgular neye benziyor?** Her bulgu: tür (çökme/a11y/görsel/performans/akış)
· önem (kritik→düşük) · **güven etiketi (kesin/muhtemel/flaky-şüphesi)** · ekran
· tekrar adımları · ekran görüntüsü kanıtı · (kaynak varsa) dosya:satır +
önerilen düzeltme. Örnek çıktı: [examples/sample-report.md](examples/sample-report.md).

## Depo Yapısı

```
.claude/skills/mobile-ux-test/
├── SKILL.md               AI kabuğunun beyni (metodoloji + protokoller)
├── references/            senaryo paketleri · rapor şeması · motor rehberi
│                          (Maestro/Patrol/adb + saha dersleri)
└── scripts/               deterministik çekirdek:
    doctor.sh · run-suite.sh · explore.mjs · report.mjs · monkey.sh
    logcat-scan.sh · reset-app.sh · animations.sh · screenshot.sh
    new-run.sh · env.sh · log.sh
examples/                  örnek senaryo çifti + örnek rapor
ROADMAP.md                 faz planı ve güncel durum
```

**Senaryo çifti sözleşmesi:** her senaryo = `<ID>.yaml` (Türkçe oracle:
adım + beklenen gözlemlenebilir sonuç) + `<ID>.flow.yaml` (motor-native Maestro
akışı). Motor çeviri yapmaz; istersen `maestro test` ile elle de koşarsın —
kilitlenme yok. Örnek: [examples/scenario-pair/](examples/scenario-pair/).

## Yol Haritası ve Durum

| Faz | İçerik | Durum |
|---|---|---|
| 0 — Ortam | skill + script'ler + Maestro/Patrol + AVD "temiz" snapshot + doctor | ✅ |
| 1 — İlk kanıt | gerçek uygulamada uçtan uca: senaryolar, kaos, 43 bulguluk vision paneli, fix-loop (5 bulgu düzeltildi, smoke yeşil) | ✅ |
| 1.5 — Explorer | AI'sız keşif crawler'ı + graph.json + günlük log sistemi | ✅ v0 |
| 2 — Motor | `testful` CLI (TypeScript): run/doctor/report/judge tek komutta; Maestro'suz sürüş (adb-direct); durum matrisi (karanlık/font 1.3×/döndürme/offline); harita render (mermaid) | ⬜ sıradaki |
| 3 — Ürünleşme | **çoklu AI sağlayıcı (BYOK: DeepSeek/OpenAI/Claude API ile `judge`)** · MCP server (Cursor vb. istemciler) · görsel regresyon (baseline diff) · run-diff (yeni/çözülen/devam eden) · interaktif HTML harita · Linux CI (Docker) | ⬜ |
| 4 — Yayılım | çoklu-uygulama stabilite kanıtı (2-3 uygulama × 10 koşu, flakiness ölçümü) · EN dokümantasyon · npm paketi · iOS (macOS) | ⬜ |

## Saha Dersleri (kanla yazıldı 🩸)

Gerçek koşularda öğrenilip `references/engines.md`'de kodlanan dersler:
Flutter'ın birleşik semantics tuzağı (`[\s\S]*` seçicileri) · Maestro'nun
Windows dadb hıçkırıkları (`stopApp: false`) · `adb reverse`'in sessiz ölümü
(host-loopback `10.0.2.2` tercihi) · exit code'a değil artefakta güven ·
flaky-karantinanın önlediği yanlış alarm · statik ekran görüntüsünün scroll'u
görememesi (vision yanlış-pozitif dersi).

## Lisans

[MIT](LICENSE) — © 2026 Mehmet Yasin UZUN

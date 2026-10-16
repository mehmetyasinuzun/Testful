# Testful CI — bilgisayarsız, bulut emülatöründe otomatik test

Testful'u GitHub Actions'a bağlarsın; her push/PR'da GitHub'ın Linux
makinesinde (KVM hızlandırmalı) **gerçek bir Android emülatörü** açılır,
uygulaman derlenir, kurulur ve test edilir. Sonucu telefondan GitHub
uygulamasında / PR yorumunda görürsün. Bilgisayar gerekmez.

## Bir repoya bağlamak (tek dosya)

Hedef repoda `.github/workflows/testful.yml`:

```yaml
name: Testful
on:
  push:
    branches: [main, master]
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
  pull-requests: write
jobs:
  testful:
    uses: mehmetyasinuzun/Testful/.github/workflows/testful.yml@main
    secrets: inherit
```

Bu dosyanın yorumlu tam hali: [`templates/testful-ci.yml`](../templates/testful-ci.yml).
Elle kopyalamak yerine: `node cli/testful.mjs ci-init <repo_klasörü>`.
Claude Code oturumunda "şu repoya Testful CI ekle" demen de yeter.

Testful tarafında yapılan her iyileştirme, bağlı tüm repolara otomatik
yansır (hepsi `@main`'i çağırır) — repo başına bakım yok.

## Her koşuda ne olur

| Adım | Ne yapar |
|---|---|
| Algılama | Flutter (`pubspec.yaml`) · Expo · React Native · native Gradle (`gradlew`) · `android/gradlew` |
| Derleme | Flutter/native → debug APK · RN/Expo → release APK (JS gömülü, Metro gerekmez) |
| Test kullanıcısı | Supabase anahtarları varsa onaylı test hesabı hazırlanır (aşağıda) |
| Kurulum | API 34 x86_64 emülatör (Pixel 6, 3 çekirdek), animasyonlar kapalı |
| Otonom keşif | `testful map`: dokunur, **kaydırır**, **giriş/OTP formunu doldurur**, işi kalan ekrana bilinen yoldan gider; riskli butonlara (sil/çıkış/ödeme) dokunmaz |
| Senaryolar | `.qa/scenarios/*.flow.yaml` varsa Maestro ile (3× tekrar + flaky karantina) |
| Kaos | Sabit seed'li monkey (varsayılan 1000 olay) |
| Görsel hakem | `ANTHROPIC_API_KEY` varsa her benzersiz ekran Claude ile değerlendirilir (aşağıda) |
| Analiz | Yalnız uygulamana ait çökme/ANR/native crash/flutter hatası · etiketsiz öğeler · küçük dokunma hedefleri |
| Video | Her aşama ayrı mp4: `1-kesif`, `2-senaryolar`, `3-kaos` |
| Rapor | İş özeti + PR'da tek güncellenen yorum + artifact'lar |

Artifact'lar:

| Ad | İçerik |
|---|---|
| `testful-report` | `map/graph.json`, `map/screens/*.png`, `run/report.md`, `run/screenshots/`, kesintisiz `logcat.txt`, `judge.json`, `summary.md` |
| `testful-report-video` | aşama başına mp4 (telefonda oynatılır) |
| `testful-report-apk` | derlenen APK (telefona indirip kurabilirsin) |

## Ne zaman kırmızı olur (`fail-on`)

- `scenario` (varsayılan): APK kurulamazsa, uygulama açılmazsa ya da bir senaryo 3/3 kalırsa.
- `crash`: yukarıdakiler + uygulamana ait çökme/ANR imzası.
- `never`: yalnız rapor; hiç kırmızı olmaz.

Flaky senaryolar (ilk koşu kaldı, tekrarda geçti) kırmızı yapmaz, raporda 🟡 görünür.
Görsel hakem bulguları **hiçbir zaman** kırmızı yapmaz (en düşük kanıt seviyesi).

## Gizli bilgiler (Secrets) — hepsi isteğe bağlı

Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Çağıran dosyadaki `secrets: inherit` hepsini aktarır; olmayan özellik sessizce atlanır.

| Secret | Ne için |
|---|---|
| `TESTFUL_LOGIN_USER` | Test hesabı e-posta/kullanıcı adı |
| `TESTFUL_LOGIN_PASSWORD` | Test hesabı şifresi — log ve artifact'larda `***` olarak maskelenir |
| `TESTFUL_LOGIN_OTP` | Sabit test OTP kodu |
| `TESTFUL_LOGIN_PHONE` | Telefonla giriş için test numarası |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Test kullanıcısını koşudan önce oluştur/eşitle |
| `ANTHROPIC_API_KEY` | Görsel hakem |
| `GCP_CREDENTIALS_JSON` | Firebase Test Lab (servis hesabı anahtarı) |

## Giriş duvarı (login / OTP)

Keşif, ekranda şifre alanı görünce formu doldurup gönderir (e-posta/kullanıcı
adı/telefon/şifre/OTP alanlarını Türkçe ve İngilizce etiketlerden ve
resource-id'lerden tanır). Test hesabı verilmezse biçimi geçerli sahte değerlerle
dener; böylece en azından hata/doğrulama ekranları da keşfedilir.

Senaryolarda (Maestro) aynı bilgiler ortam değişkeni olarak gelir — şifreyi
dosyaya yazma:

```yaml
# .qa/scenarios/_login.flow.yaml  (_ ile başlayan dosya tek başına koşmaz)
appId: com.sirket.uygulama
---
- tapOn: "E-posta"
- inputText: ${TESTFUL_LOGIN_USER}
- tapOn: "Şifre"
- inputText: ${TESTFUL_LOGIN_PASSWORD}
- tapOn: "Giriş"
```

Diğer senaryolarda: `- runFlow: _login.flow.yaml`. Örnek: [`examples/demo-app/.qa/scenarios`](../examples/demo-app/.qa/scenarios).

### Supabase kullanan uygulamalar

1. **Ayrı bir staging Supabase projesi** kullan (önerilen); testler üretim verisine dokunmasın.
2. Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TESTFUL_LOGIN_USER`
   (örn. `qa+testful@alanadin.com`), `TESTFUL_LOGIN_PASSWORD`.
3. Her koşudan önce Testful bu kullanıcıyı Supabase Admin API ile **onaylı** olarak
   oluşturur ya da şifresini eşitler. Güvenlik kuralı: yalnız kendi oluşturduğu
   (işaretlediği) kullanıcıya dokunur; aynı e-postayla gerçek bir kullanıcı varsa
   şifresini **değiştirmez**, hata verir.
4. Telefon + OTP ile giriş: Supabase panelinde **Authentication → Providers →
   Phone → Test phone numbers and OTPs** altında sabit bir numara/kod tanımla;
   `TESTFUL_LOGIN_PHONE` ve `TESTFUL_LOGIN_OTP` secrets'ına aynı değerleri yaz.
5. `service_role` anahtarı yalnız CI'da kullanılır; uygulamanın içine asla girmez.

E-posta "magic link" ile giriş otomatikleştirilemez; test için şifreli giriş ya da test telefon numarası kullan.

## Görsel hakem (Claude)

`ANTHROPIC_API_KEY` secret'ı varsa (`visual-judge: auto`), keşfin bulduğu her
benzersiz ekran **bir kez** Claude'a gösterilir: taşma, kesilme, üst üste binme,
kontrast, hizalama, boş/hata durumları, karışık dilli metin, erişilebilirlik.
Yapılandırılmış (JSON şemalı) çıktı alınır; sonuç iş özetinde ve `judge.json`'da.

- Model: `claude-opus-5-5` (değiştirmek için `judge-model`). Ret durumunda sunucu
  tarafı yedek model devreye girer (`fallbacks: "default"`).
- Maliyet sınırı: `judge-max-screens` (varsayılan 12). Ekran başına ~1.5–2K girdi
  token'ı; tüketim özetin sonunda yazar.
- Dokunma hedefi kontrolü (< 48 dp) AI'sız ve kesindir; anahtar olmadan da çalışır
  (`testful judge` yerelde).
- Bulgular öneri niteliğindedir; CI'ı kırmızı yapmaz.

## Firebase Test Lab (isteğe bağlı)

> ⚠️ Google, Firebase Test Lab'ı **30 Eylül 2027'de kapatıyor** (halefi: Google Cloud
> Developer Device Platform, faturalandırma zorunlu). O tarihe kadar ücretsiz kota:
> günde **10 sanal + 5 fiziksel cihaz testi**. Testful'un emülatör testleri bundan etkilenmez.

Uygulamanın Firebase kullanması **gerekmez** (Supabase kullanan uygulamalar da olur);
Test Lab yalnız APK'yı Google'ın cihazlarında Robo testiyle koşar.

Kurulum (bir kez):
1. [console.firebase.google.com](https://console.firebase.google.com) → proje oluştur (Spark planı yeter).
2. Google Cloud Console → aynı proje → **IAM → Service Accounts** → hesap oluştur;
   rol: **Firebase Test Lab Admin** (`roles/cloudtestservice.testAdmin`) +
   **Viewer**. Çalışmazsa Google'ın CI rehberindeki gibi **Editor** ver, sonra daralt.
3. **Cloud Testing API** ve **Cloud Tool Results API**'yi etkinleştir.
4. Hesap → Keys → JSON anahtar → içeriği `GCP_CREDENTIALS_JSON` secret'ına yapıştır.
5. Çağıran dosyada:

```yaml
jobs:
  testful:
    uses: mehmetyasinuzun/Testful/.github/workflows/testful.yml@main
    secrets: inherit
    with:
      firebase-test-lab: true
      firebase-devices: |
        model=MediumPhone.arm,version=33
```

Anahtarsız (önerilen) kimlik: Workload Identity Federation — `workload-identity-provider`
ve `service-account` girdilerini ver, çağıran dosyanın `permissions`'ına `id-token: write` ekle.

Sonuç ayrı bir iş olarak görünür: cihaz başına sonuç tablosu, Firebase konsol linki,
`testful-firebase` artifact'ında video ve ekran görüntüleri. Test Lab'ın kendi
altyapı hataları (kod 15/20) kırmızı yapmaz, uyarı olarak görünür.

## Girdiler

| Girdi | Varsayılan | Açıklama |
|---|---|---|
| `working-directory` | `.` | Uygulama alt klasördeyse (monorepo) |
| `apk-path` | — | Hazır APK; verilirse derleme atlanır |
| `build-command` | — | Özel derleme komutu; en yeni `*.apk` alınır |
| `package` | APK'dan | Paket adı |
| `api-level` / `target` | `34` / `google_apis` | Emülatör imajı |
| `max-actions` / `max-minutes` | `60` / `8` | Keşif sınırları |
| `monkey-events` | `1000` | Kaos olayı (`0` = kapalı) |
| `scenarios` | `*` | Senaryo ID kalıbı, örn. `CORE-*` |
| `matrix` | — | `dark,large-font,landscape,offline` |
| `fail-on` | `scenario` | Yukarıya bak |
| `pr-comment` | `true` | PR'a özet yorumu |
| `record-video` | `true` | Emülatör ekran videosu (ayrı artifact) |
| `visual-judge` | `auto` | `auto` / `true` / `false` |
| `judge-model` / `judge-max-screens` | `claude-opus-5-5` / `12` | Görsel hakem |
| `firebase-test-lab` | `false` | Firebase Robo testi |
| `firebase-devices` | `model=MediumPhone.arm,version=33` | Satır başına bir cihaz |
| `timeout-minutes` | `60` | İş zaman aşımı |

Workflow yerine adım olarak da kullanılabilir (kendi job'ın içinde):
`- uses: mehmetyasinuzun/Testful@main` (önce `actions/checkout`); Firebase için
`- uses: mehmetyasinuzun/Testful/firebase@main`.

## Telefondan kullanım

1. Claude Code (claude.ai/code ya da mobil uygulama) ile kodu değiştir → push.
2. GitHub mobil uygulaması → repo → **Actions** → "Testful" koşusu → iş özeti.
3. PR açtıysan sonuç PR'da yorum olarak görünür; her push'ta aynı yorum güncellenir.
4. Koşu sayfası → **Artifacts**: `testful-report` (ekran görüntüleri, log),
   `testful-report-video` (zip'i aç → mp4), `testful-report-apk` (telefona kur).
5. Elle yeniden koşmak: Actions → Testful → **Run workflow**.

## Testful'un kendi kanıtı

- **Self-test** (her push): birim + keşif motoru testleri Linux/macOS/Windows'ta;
  demo uygulamada gerçek emülatörde giriş duvarı, kaydırma, video, şifre sızıntısı kontrolü.
- **Saha denemeleri** (haftalık, `field-trials.yml`): F-Droid'den 3 gerçek uygulama
  (Fossify Notes, Catima, OpenTracks) × 3 tekrar → uygulama başına ekran sayısı
  ortalama ± sapma, kapsama, tekrarlar arası ekran kümesi örtüşmesi, çökme sayısı.

## Maliyet ve sınırlar

- Public repolarda Actions dakikası sınırsız; private repolarda ücretsiz
  kota ayda 2000 dakika. Bir koşu tipik olarak 8-15 dakika.
- Yalnız Android. iOS macOS runner ister (yol haritasında).
- Keşif WebView içindeki formları ve CAPTCHA'yı aşamaz; bunlar için senaryo yaz.

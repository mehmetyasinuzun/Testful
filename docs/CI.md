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
| Kurulum | API 34 x86_64 emülatör (Pixel 6), animasyonlar kapalı |
| Otonom keşif | `testful map` → ekran haritası + kapsama · riskli butonlara (sil/çıkış) dokunmaz |
| Senaryolar | `.qa/scenarios/*.flow.yaml` varsa Maestro ile koşar (3× tekrar + flaky karantina) |
| Kaos | Sabit seed'li monkey (varsayılan 1000 olay) |
| Analiz | Yalnız uygulamana ait çökme/ANR/native crash/flutter hatası · etiketsiz (a11y) öğeler |
| Rapor | İş özeti + PR'da tek güncellenen yorum + `testful-report` artifact'ı |

Artifact içeriği: `map/graph.json`, `map/screens/*.png`, `run/report.md`,
`run/screenshots/`, `logcat.txt`, `monkey-logcat.txt`, `final.png`, `summary.md`.

## Ne zaman kırmızı olur (`fail-on`)

- `scenario` (varsayılan): APK kurulamazsa, uygulama açılmazsa ya da bir senaryo 3/3 kalırsa.
- `crash`: yukarıdakiler + uygulamana ait çökme/ANR imzası.
- `never`: yalnız rapor; hiç kırmızı olmaz.

Flaky senaryolar (ilk koşu kaldı, tekrarda geçti) kırmızı yapmaz, raporda 🟡 görünür.

## Girdiler

| Girdi | Varsayılan | Açıklama |
|---|---|---|
| `working-directory` | `.` | Uygulama alt klasördeyse (monorepo) |
| `apk-path` | — | Hazır APK; verilirse derleme atlanır |
| `build-command` | — | Özel derleme komutu; en yeni `*.apk` alınır |
| `package` | APK'dan | Paket adı |
| `api-level` / `target` | `34` / `google_apis` | Emülatör imajı |
| `max-actions` | `60` | Keşifte en çok dokunuş |
| `monkey-events` | `1000` | Kaos olayı (`0` = kapalı) |
| `scenarios` | `*` | Senaryo ID kalıbı, örn. `CORE-*` |
| `matrix` | — | `dark,large-font,landscape,offline` |
| `fail-on` | `scenario` | Yukarıya bak |
| `pr-comment` | `true` | PR'a özet yorumu |
| `timeout-minutes` | `60` | İş zaman aşımı |

Örnek:

```yaml
jobs:
  testful:
    uses: mehmetyasinuzun/Testful/.github/workflows/testful.yml@main
    with:
      working-directory: mobile
      fail-on: crash
      matrix: dark,large-font
```

Workflow yerine adım olarak da kullanılabilir (kendi job'ın içinde):
`- uses: mehmetyasinuzun/Testful@main` (önce `actions/checkout`).

## Telefondan kullanım

1. Claude Code (claude.ai/code ya da mobil uygulama) ile kodu değiştir → push.
2. GitHub mobil uygulaması → repo → **Actions** → "Testful" koşusu → iş özeti.
3. PR açtıysan sonuç PR'da yorum olarak görünür; her push'ta aynı yorum güncellenir.
4. Ekran görüntüleri: koşu sayfası → **Artifacts** → `testful-report`.
5. Elle yeniden koşmak: Actions → Testful → **Run workflow**.

## Maliyet ve sınırlar

- Public repolarda Actions dakikası sınırsız; private repolarda ücretsiz
  kota ayda 2000 dakika. Bir koşu tipik olarak 8-15 dakika.
- Yalnız Android. iOS macOS runner ister (yol haritasında).
- Login/OTP duvarı olan uygulamalarda keşif duvarda durur; test hesabını
  senaryolarla (`.qa/scenarios`) ver. Gizli bilgileri repo **Secrets**'a koy.

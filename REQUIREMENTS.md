# Testful — Sistem Gereksinimleri

Sık sorulanların net cevabı. (Windows 10'da fiilen doğrulanmıştır.)

## İşletim sistemi — hangisi lazım?

| OS | Android testi | iOS testi | Not |
|---|---|---|---|
| **Windows 10/11** | ✅ (doğrulandı) | ❌ | Günlük geliştirme için yeterli |
| **macOS** | ✅ | ✅ | iOS için **zorunlu**; Apple Silicon'da arm64 emülatör native |
| **Linux** | ✅ | ❌ | **CI/headless için en iyi** (KVM hızlandırma, Docker) |

Özet: **Android için üçü de olur.** Mac'e yalnız iOS testi gerekince ihtiyacın
olur. Sunucuda otomatik koşu düşünüyorsan Linux en rahatı.

## Donanım

| Kaynak | Minimum | Önerilen |
|---|---|---|
| **CPU** | Donanım sanallaştırma açık x86_64 (Intel VT-x / AMD-V; Apple Silicon arm64) | 4+ çekirdek |
| **RAM** | 8 GB | **16 GB** (emülatör ~2-4 GB + derleme araç zinciri) |
| **Disk** | ~15 GB (SDK + sistem imajı + derleme) | 30 GB+ |
| **GPU** | — | Donanım GL'li GPU emülatörü belirgin hızlandırır |

## Yazılım (kur / doğrula: `doctor.sh`)

- **JDK 17+** (Maestro şartı; testte JDK 21 kullanıldı)
- **Flutter SDK** (+ Dart) — Flutter hedefleri için
- **Android SDK**: `platform-tools` (adb), `emulator`, bir **sistem imajı**
  (x86_64 host'ta x86_64 imaj; Apple Silicon'da arm64)
- **Maestro CLI** — evrensel kara-kutu sürücü
- **Patrol CLI** — Flutter derin mod (`dart pub global activate patrol_cli`)
- **Node 18+** — rapor üreteci (`report.mjs`)
- **git** — self-repair'in git-güvenli dalları için

## API anahtarı gerekiyor mu? — **Hayır**

- **Beyin = Claude Code** (senin aboneliğin). Senaryo üretimi, görsel hakemlik,
  onarım oradan yürür → **ek API anahtarı yok, ek maliyet yok.**
- **Motor = deterministik**, tasarımı gereği AI'sız → sunucuda/CI'da bedava koşar.
- **BYOK Anthropic anahtarı yalnız opsiyonel Faz 3'te** gerekir: Claude Code
  *olmadan*, sunucuda otonom görsel hakemlik istersen (gece koşusu vb.).

## Docker gerekiyor mu? — **Hayır (ve Windows/Mac'te önerilmez)**

- Android emülatörü donanım sanallaştırması ister; Windows/Mac'te Docker zaten
  bir VM içinde çalıştığından **iç içe sanallaştırma** olur → ya açılmaz ya
  sürünür.
- "Tek komutla ayağa kalkan, kirlenmeyen ortam" ihtiyacının Android'deki doğru
  karşılığı **AVD snapshot**'tır: `snapshot save temiz` / `snapshot load temiz`
  ile saniyeler içinde bakir cihaz. Testful bunu kullanır.
- Docker yalnız **Linux CI** (KVM'li) sunucuda anlamlıdır — Faz 3 opsiyonu.

## Ağ / test verisi

- Uygulama bir backend'e bağlıysa (örn. compass_app localhost:8080 sunucusu),
  emülatör için `adb reverse tcp:PORT tcp:PORT` köprüsü gerekir (runner otomatik
  uygular).
- Login akışları için **test hesabı** kimlik bilgilerini `.qa/config.local.yaml`
  (gitignore'lu) dosyasına koy — koda gömülmez.

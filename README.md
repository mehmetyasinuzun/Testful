# Testful

**Kaynak-koda duyarlı, otonom mobil UX/UI test ajanı.** Uygulamanın kaynağını
okur, ne tür bir uygulama olduğunu anlar, gerçekçi kullanıcı senaryoları üretir,
bunları gerçek bir cihaz/emülatörde koşar, ekranı görsel olarak yargılar,
sorunları **güven etiketiyle** raporlar ve isterseniz düzeltip yeniden dener.

TestSprite gibi bulut servislerine **bedava, self-hosted ve Claude-native** bir
alternatif. Kodunuz makinenizden çıkmaz; beyin olarak Claude Code (Sonnet)
kullanılır, koşucu katman tamamen deterministiktir.

> **Durum: Alpha / kanıt aşaması.** Boru hattı gerçek bir Flutter uygulamasında
> (Flutter'ın resmî `compass_app` örneği) uçtan uca doğrulanmıştır. Ayrıntı:
> [ROADMAP.md](ROADMAP.md).

---

## Ne yapar (tek bakışta)

1. **Statik analiz** — çerçeveyi (Flutter/Kotlin/RN), paketi, izinleri, arketipi
   ve eksik `Key`/`Semantics`'i kaynaktan çıkarır.
2. **Kaos taraması** — sabit seed'li monkey + logcat imza taraması (çökme, ANR,
   RenderFlex taşması) — sıfır token.
3. **Senaryo akışları** — arketipe uygun oracle'lı senaryolar üretir, Maestro
   (evrensel) veya Patrol (Flutter derin) ile koşar.
4. **Görsel hakemlik** — kritik/başarısız ekran görüntülerini niyete karşı
   yargılar (donma, taşma, boş durum).
5. **Rapor** — `.qa/results/<run-id>/` altında makine (`report.json`) + insan
   (`report.md`, Türkçe) çıktısı; her bulgu **kesin / muhtemel / flaky-şüphesi**
   etiketli.
6. **Self-repair (opsiyonel)** — git-güvenli dalda minimal yama → yalnız etkilenen
   senaryoyu tekrar koş → doğrula.

## Mimari: üç katman, tek motor

| Katman | Ne | Nasıl |
|---|---|---|
| **Beyin** | senaryo üretimi · görsel hakemlik · onarım | Claude Code Skill (`mobile-ux-test`) |
| **Motor** | koşu · izolasyon · retry · rapor | deterministik script'ler (Faz 2'de `testful` CLI) — **AI'sız, CI'da koşar** |
| **Kapı** | diğer istemciler (Cursor vb.) | MCP adaptörü (Faz 3) |

Sözleşmeler sabittir: senaryo çifti (`<ID>.yaml` oracle + `<ID>.flow.yaml`
motor-native) ve `report.json`. Bu ikisi durdukça hiçbir katman diğerini kıramaz.

## Hızlı başlangıç

```bash
# 0) Ortamı doğrula (6/6 yeşil bekleriz)
bash .claude/skills/mobile-ux-test/scripts/doctor.sh

# 1) Claude Code içinde skill'i tetikle:
#    "uygulamamı test et: <flutter-proje-yolu>"
#    (Claude analiz eder, senaryoları .qa/scenarios/ altına yazar)

# 2) Paketi deterministik koş (AI'sız):
bash .claude/skills/mobile-ux-test/scripts/run-suite.sh <flutter-proje-yolu>

# 3) Raporu aç:
#    <flutter-proje-yolu>/.qa/results/<run-id>/report.md
```

Kurulum gereksinimleri, RAM, API/Docker gereği: [REQUIREMENTS.md](REQUIREMENTS.md).

## Kapsam

- **Bugün:** Android · Flutter (Patrol+Maestro), Kotlin/Java & RN/Expo (Maestro).
- **iOS:** macOS gerektirir (yol haritasında).
- **Gerçek cihaz + emülatör** ikisi de desteklenir.

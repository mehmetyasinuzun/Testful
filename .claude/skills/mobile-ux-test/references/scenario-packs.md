# Senaryo Paketleri ve Oracle Formatı

## Format (oracle'lı adım — zorunlu)
Senaryolar `.qa/scenarios/<ID>-<slug>.yaml` olarak kalıcıdır ve commit'lenir.
Her adım bir eylem + gözlemlenebilir beklenen sonuç (`expect`) taşır.
`expect` yazılamıyorsa o adım senaryoya giremez.

```yaml
id: MAP-01
title: Yer ara ve rota çiz
archetype: map
tier: core
engine: maestro          # maestro | patrol | fallback
package: com.example.app
preconditions:
  - reset-app
  - grant: [ACCESS_FINE_LOCATION]   # izin diyaloğu test edilmiyorsa ön-ver
steps:
  - do: launch
    expect: "ana ekran haritayla açılır, çökme yok"
    shot: true
  - do: tap "Ara"
    expect: "arama kutusu odaklanır, klavye açılır"
  - do: type "Kadıköy"
    expect: "öneri listesi görünür"
    shot: true
  - do: tap first_result
    expect: "harita seçilen konuma gider, pin görünür"
    shot: true
  - do: tap "Yol tarifi"
    expect: "rota çizgisi ve süre/mesafe bilgisi görünür"
    shot: true
```

`shot: true` adımları ekran görüntüsü alır. Vision yalnız fail eden ya da
`shot: true` işaretli kritik adımlara, `expect` cümlesi üzerinden **evet/hayır**
sorusuyla çağrılır.

## Evrensel paket (her uygulama, CORE)
- Soğuk açılış: çökme yok, ilk ekran ≤ makul sürede çizilir
- Gezinme: her ana ekrana ulaşılabilir, geri tuşu mantıklı davranır
- Boş / yükleniyor / hata durumları görünür ve anlamlı
- Taşma/kırpılma: logcat RenderFlex taraması + kritik ekranlarda vision
- Dokunma hedefleri ≥ 48dp (STORE tier'da zorunlu kontrol)

## Arketip paketleri
- **auth** — kayıt ol → giriş → çıkış · yanlış şifre hatası · boş alan
  doğrulaması · oturum kalıcılığı (uygulama yeniden açılınca)
- **map** — konum izni → yer ara → seç → rota/yön tarifi → ilerleme takibi
- **audio/music** — çal → duraklat → ileri sar → sonraki → arka planda çalma
  → ses seviyesi
- **voice-recorder** — mikrofon izni → kaydet → durdur → dinle → kaydet/sil
- **game** — başlat → temel kontrol/girdi → duraklat → skor güncellenir →
  yeniden başlat (yalnız menü/UI güvenilir; oyun-içi mantık sınırlı)
- **ecommerce** — listele → ürün aç → sepete ekle → ödeme başlangıcına kadar
  (gerçek ödeme ASLA)

## Sınıflama sinyalleri
Bağımlılıklar (Maps SDK, ExoPlayer/Media3, MediaRecorder, auth SDK'ları),
AndroidManifest izinleri (konum, mikrofon), ekran/route adları, importlar.
Birden çok arketip etiketi normaldir.

## Bütçe
CORE ≤ 12 · RESILIENCE ≤ 10 · PERF ≤ 6 · STORE ≤ 8. Bütçe aşılırsa ana
kullanıcı yolculukları kenar durumlara önceliklidir; kesilenler rapora
"kapsam dışı bırakıldı" olarak yazılır (sessiz kırpma yok).

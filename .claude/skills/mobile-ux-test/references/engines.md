# Motorlar: Seçim, Kurulum, Fallback, adb Düğmeleri

## Çerçeve → motor
| Kaynak sinyali | Çerçeve | Birincil motor | Not |
|---|---|---|---|
| `pubspec.yaml` | Flutter | **Patrol** | Widget ağacı Key ile; native izin diyalogları |
| `build.gradle(.kts)`, RN yok | Native Kotlin/Java | **Maestro** | Derinlik gerekirse Espresso/UIAutomator |
| `package.json` + react-native/expo | RN/Expo | **Maestro** | `testID` kullanımı önerilir |
| Unity/Unreal, canvas-only | Oyun | **fallback (vision)** | Menü/UI kapsanır; oyun-içi mantık sınırlı |

Kurulum adımları sürümle değişir — ilk kurulumdan önce güncel dokümanı
context7 ile doğrula (Patrol: leancode.co docs, Maestro: maestro.dev).

## Patrol (Flutter derin mod)
- Hedef projede bir kez: `dev_dependencies`e `patrol`, makineye `patrol_cli`,
  `integration_test/` iskeleti.
- Koşu: `patrol test -t integration_test/<dosya>.dart`
- Ne zaman Patrol: izin diyaloğu, biyometri, bildirim, WebView, sistem ayarı
  gereken senaryolar; Semantics'i zayıf ekranlar; hassas widget assert'leri.

## Maestro (evrensel kara-kutu)
- Windows desteğini doctor aşamasında fiilen doğrula (tarihsel olarak WSL
  istiyordu). Çalışmıyorsa: WSL ya da fallback sürücü.
- Flow şablonu:
  ```yaml
  appId: com.example.app
  ---
  - launchApp
  - tapOn: "Ara"
  - inputText: "Kadıköy"
  - takeScreenshot: MAP-01-3-oneriler
  ```
- Flutter'da element görünürlüğü Semantics ağacından gelir. Element
  bulunamıyorsa kalıcı çözüm kaynağa `Semantics`/`Key` ekletmektir
  (testability patch) — koordinat hack'i son çare.
- **NavigationBar sekme tuzağı (saha dersi):** Flutter alt-sekme düğümüne konum
  ekler: `"Kelimeler\nSekme 2 / 5"` — sekme dokunuşları HER ZAMAN
  `tapOn: 'Etiket[\s\S]*'`. Büyük APK dersi: Maestro `launchApp` (clearState)
  ağır debug uygulamalarda dadb timeout'una düşer — `TESTFUL_PRELAUNCH=1` ile
  launch'ı adb'ye ver (run-suite.sh), flow'lar launchApp'sız "bağlan ve sür" olur.
- **Birleşik semantics tuzağı (saha dersi):** Flutter, kart benzeri widget'larda
  başlık+alt metni TEK düğümde birleştirir (`"Alaska, North America\n20 Jul - 15 Aug"`).
  Maestro tam-eşleşme yaptığından alt-metin seçicisi tutmaz — `[\s\S]*` sonekiyle yaz:
  `tapOn: 'Alaska, North America[\s\S]*'` (YAML'da TEK tırnak — çift tırnakta `\s`
  geçersiz escape'tir). Doğrulama aracı: `adb exec-out uiautomator dump /dev/tty`.
- **Windows saha dersleri:** (1) `launchApp`'e `stopApp: false` ekle — Maestro'nun
  dadb force-stop'u arada "device offline" verir; akışta zaten `clearState` varsa
  force-stop gereksizdir. (2) `adb reverse` kuralları Maestro'nun adb server
  resetlerinde SİLİNİR — her akıştan hemen önce idempotent yeniden uygula.
  (3) İlk `maestro test` çağrısı transport ısınması nedeniyle patlayabilir — bir
  kez tekrarla. (4) Emülatör/sunucu gibi uzun ömürlü süreçler oturumla birlikte
  ölebilir — koşu başında cihaz + backend sağlığını doğrula, gerekirse snapshot'tan
  geri getir (snapshot uygulama KURULUMUNDAN öncesiyse APK'yı yeniden kur).
- **Backend köprüsü — `10.0.2.2` > `adb reverse` (saha dersi):** Uygulama yerel
  bir backend'e bağlanıyorsa, `adb reverse` uzun akışlarda Maestro'nun adb
  reset'leriyle DÜŞER → geç adımdaki network çağrıları (örn. sonuç ekranı)
  sessizce boş döner, erken çağrılar (login/liste) geçtiği için hata yanıltıcı
  olur. Kalıcı çözüm: uygulamayı emülatörün **host-loopback alias'ı `10.0.2.2`**'ye
  yönlendir (reverse'e hiç gerek kalmaz). En temizi uygulamada host'u yapılandırılabilir
  yapmak: `const String.fromEnvironment('API_HOST')` + `flutter build ... --dart-define=API_HOST=10.0.2.2`.
  Bu hem testi sağlamlaştırır hem gerçek bir esneklik (ENV bulgusu).

## Fallback sürücü (Maestro yok ya da ağaç boş)
1. `adb exec-out uiautomator dump /dev/tty` → XML ağacı al, `bounds` parse
   et, merkeze `adb shell input tap <x> <y>`.
2. Ağaç boşsa (Flutter canvas): screenshot → vision'dan hedefin koordinatını
   iste → `input tap`. Bu modda koşulan senaryolar raporda `fallback-driver`
   etiketi taşır ve güveni en fazla **muhtemel** olabilir.

## adb düğmeleri (emülatörde güvenli)
| İş | Komut |
|---|---|
| Animasyon kapat/aç | `scripts/animations.sh off\|on` |
| Uygulama sıfırla | `scripts/reset-app.sh <pkg>` (`pm clear` veri + runtime izinleri birlikte sıfırlar) |
| İzin ön-verme | `adb shell pm grant <pkg> android.permission.X` |
| Karanlık mod | `adb shell cmd uimode night yes\|no` |
| Font ölçeği | `adb shell settings put system font_scale 1.3` (test sonrası `1.0`) |
| Döndürme | `adb shell settings put system accelerometer_rotation 0` + `adb shell settings put system user_rotation 1` (sonra `0`) |
| Ağ kes/aç | `adb shell svc wifi disable\|enable` + `adb shell svc data disable\|enable` |
| Arka plan→ön plan | `adb shell input keyevent KEYCODE_HOME` + `adb shell monkey -p <pkg> 1` |
| Soğuk açılış süresi | `adb shell am start -W <pkg>/<activity>` → `TotalTime` |
| Jank/FPS | `adb shell dumpsys gfxinfo <pkg>` + Flutter integration_test frame metrikleri |
| Ekran görüntüsü | `scripts/screenshot.sh <dosya.png>` (asla PowerShell yönlendirmesi) |

## Windows kuralları
- Tüm adb/maestro/patrol komutları **Bash tool** üzerinden koşar.
- `adb exec-out screencap -p > x.png` PowerShell'de PNG'yi bozar (CRLF);
  Bash'te güvenlidir — script zaten bunu yapar.
- adb PATH'te olmayabilir; script'ler `%LOCALAPPDATA%\Android\Sdk\platform-tools`
  konumundan otomatik çözer (`scripts/env.sh`).

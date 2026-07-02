# Testful Raporu — 20260702-223652

**Özet:** 2 geçti · 0 kaldı · 0 flaky-şüphesi

**Piyasaya hazır mı?** ✅ Evet — kritik/kesin engel yok

## Senaryolar

| ID | Başlık | Tier | Sonuç | Güven |
|---|---|---|---|---|
| CORE-01 | Soğuk açılış — login ekranı çökmesiz açılır | core | ✅ geçti | kesin |
| CORE-02 | Gezinme sağlaması — login sonrası ana ekranlar ve geri tuşu davranışı | core | ✅ geçti | kesin |

## Ek bulgular (kaos / testability / performans)

### [yüksek · kesin] Misafir sayacı +/- butonları erişilebilirlik ağacında yok
search_form_guests.dart'taki artı/eksi InkWell'leri Semantics'siz olduğundan hem ekran okuyuculara görünmüyor hem de black-box seçilemiyordu (rightOf hack'i yanlış hedefe gidip geri-gezinme tetikliyordu). YAMA: Semantics(button:true, label:'Add guest'/'Remove guest').
- Durum: **fixed**
- Kanıt: qa-fix/testability-semantics · lib/ui/search_form/widgets/search_form_guests.dart

### [yüksek · kesin] Aktivite onay kutusu erişilebilirlik ağacında yok
custom_checkbox.dart InkResponse etiketsizdi. YAMA: semanticLabel parametresi + Semantics(checked:value); activity_entry 'Select <aktivite>' besliyor.
- Durum: **fixed**
- Kanıt: lib/ui/core/ui/custom_checkbox.dart · lib/ui/activities/widgets/activity_entry.dart

### [yüksek · kesin] Sonuç kartları (destinasyonlar) erişilebilirlik ağacında yok
result_card.dart'ta ad yalnız görsel Text, tıklama hedefi etiketsiz. Vision görüyor, tree göremiyordu. YAMA: tıklama katmanına Semantics(button:true, label:<KART ADI>).
- Durum: **fixed**
- Kanıt: lib/ui/results/widgets/result_card.dart

### [orta · kesin] API host'u sabit 'localhost' — emülatörde kırılgan adb reverse'e mahkûm
ApiClient host'u sabit 'localhost'du; emülatörde host'a adb reverse ile ulaşılıyor ama reverse uzun akışlarda (Maestro'nun adb reset'leriyle) düşünce geç network adımları (results) boşa çıkıyordu. İKİ KATMANLI ÇÖZÜM: (1) uygulama tarafı — const String.fromEnvironment('API_HOST') ile host yapılandırılabilir yapıldı (10.0.2.2 host-loopback'e --dart-define ile bağlanılabilir); (2) runner tarafı — Windows'ta 10.0.2.2 host firewall'ına takıldığından, run-suite akış boyunca köprüyü sürekli yeniden kuran bir reverse-watchdog kullanır. İkisi birlikte results adımını stabilize eder.
- Durum: **fixed**
- Kanıt: lib/data/services/api/api_client.dart · scripts/run-suite.sh (reverse_keeper)

### [orta · flaky-suphesi] Kurulum sonrası ilk açılışta ANR (yalnız 1/3 koşuda)
Seed 42 monkey (3000 olay) ilk koşuda kurulum-sonrası ilk açılışta ANR tetikledi; aynı seed ile iki temiz tekrar temiz geçti. Muhtemel neden: debug-build JIT ısınması sırasında olay bombardımanı. Release'de doğrulanmadı; fix loop'a alınmadı.
- Durum: **karantina**
- Kanıt: logcat/monkey.txt vs monkey-retry1/2.txt

## Uygulama haritası

> Kapsama boyalı ekran-geçiş grafiği Faz 2'de bu bölümde render edilecek (graph.json).

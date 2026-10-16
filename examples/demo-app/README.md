# Testful demo uygulaması

Testful'un CI boru hattını (`.github/workflows/self-test.yml`) gerçek bir
emülatörde uçtan uca doğrulamak için kasıtlı olarak küçük tutulmuş, bağımlılıksız
bir Android uygulaması (saf Java, AndroidX yok).

Ekranlar: Ana ekran → Profil (form) · Ayarlar → Hakkında. Kasıtlı iki tuzak içerir:

- Ana ekranda **etiketsiz ikon buton** → Testful "a11y-eksik" bulgusu üretmeli.
- Ayarlar'da **"Hesabı sil"** → keşif bunu riskli sayıp dokunmamalı.

Senaryolar `.qa/scenarios/` altında (DEMO-01, DEMO-02).

# Testful demo uygulaması

Testful'un CI boru hattını (`.github/workflows/self-test.yml`) gerçek bir
emülatörde uçtan uca doğrulamak için kasıtlı olarak küçük tutulmuş, bağımlılıksız
bir Android uygulaması (saf Java, AndroidX yok).

Ekranlar: Giriş → Ana ekran → Profil (form) · Ayarlar → Hakkında · Ürünler (25 öğe,
kaydırma gerekir) → Son ürün detayı. Keşif motorunun her yeteneğini sınar:

- **Giriş duvarı** — herkese açık demo hesabı `demo@testful.dev` / `Demo&1234`
  (gizli değildir; `&` kabuk kaçırmayı da sınar). Keşif formu doldurup içeri girmeli.
- **Kaydırma** — "Ürün 25" ancak listeyi kaydırınca görünür ve detay ekranını açar.
- **Etiketsiz ikon buton** (ana ekran) → "a11y-eksik" bulgusu.
- **"Hesabı sil"** (Ayarlar) → riskli sayılıp dokunulmamalı.

Senaryolar `.qa/scenarios/` altında (DEMO-01, DEMO-02); giriş `_login.flow.yaml`
alt akışında, kimlik bilgisi ortam değişkeninden gelir.

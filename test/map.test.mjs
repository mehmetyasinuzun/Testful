import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeDevice } from './helpers/fake-device.mjs';

process.env.TESTFUL_LOG_DIR = mkdtempSync(join(tmpdir(), 'testful-log-'));
const { map } = await import('../cli/lib/map.mjs');

const PKG = 'dev.fake.app';
const out = () => mkdtempSync(join(tmpdir(), 'testful-map-'));
const titles = (g) => Object.values(g.nodes).map((n) => n.interactives.map((e) => e.label)).flat();
const withEnv = async (vars, fn) => {
  const old = {};
  for (const k of Object.keys(vars)) { old[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); } finally {
    for (const k of Object.keys(vars)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
  }
};

/** Ağaç yapılı basit uygulama: Ana → Profil/Ayarlar → Hakkında; riskli + dış link. */
const treeApp = {
  pkg: PKG,
  start: 'home',
  screens: {
    home: { title: 'Ana Sayfa', items: [{ text: 'Profil', to: 'profile' }, { text: 'Ayarlar', to: 'settings' }, { text: 'Web sitemiz', exit: true }] },
    profile: { title: 'Profil Ekranı', items: [{ text: 'Düzenle', to: 'edit' }] },
    edit: { title: 'Düzenleme', items: [{ text: 'Adın', field: true, id: 'name' }, { text: 'Kaydet' }] },
    settings: { title: 'Ayarlar Ekranı', items: [{ text: 'Hakkında', to: 'about' }, { text: 'Hesabı sil', onTap: (s) => { s.deleted = true; } }] },
    about: { title: 'Sürüm 1.0', items: [] },
  },
};

test('ağaç uygulamada tüm ekranları bulur, riskli butona dokunmaz, kör döngüye girmeden durur', async () => {
  const dev = fakeDevice(treeApp);
  const g = await map({ pkg: PKG, out: out(), maxActions: 200, device: dev });
  const screenTitles = new Set(titles(g));
  for (const t of ['Profil', 'Ayarlar', 'Düzenle', 'Hakkında']) assert.ok(screenTitles.has(t), `eksik: ${t}`);
  assert.equal(g.stats.screens >= 5, true, `ekran sayısı: ${g.stats.screens}`);
  assert.equal(dev.state.deleted, undefined, '"Hesabı sil" tıklandı');
  assert.ok(g.stats.risky_skipped >= 1);
  // Eski motor bu uygulamada maxActions'a kadar geri/yeniden başlat döngüsüne giriyordu
  assert.ok(g.stats.actions < 30, `dokunuş: ${g.stats.actions}`);
  assert.ok(g.stats.relaunches < 10, `yeniden başlatma: ${g.stats.relaunches}`);
  assert.equal(g.stats.coverage_pct, 100);
});

/** Kaydırmalı liste: hedef öğe ilk görünümde yok. */
const listApp = {
  pkg: PKG,
  start: 'list',
  screens: {
    list: {
      title: 'Ürünler', viewport: 4,
      items: Array.from({ length: 12 }, (_, i) => ({ text: `Ürün ${i + 1}`, to: i === 11 ? 'detail' : undefined })),
    },
    detail: { title: 'Son ürünün detayı', items: [{ text: 'Sepete ekle' }] },
  },
};

test('kaydırarak görünmeyen öğeleri bulur; kaydırılmış görünüm yeni ekran sayılmaz', async () => {
  const dev = fakeDevice(listApp);
  const g = await map({ pkg: PKG, out: out(), maxActions: 100, device: dev });
  assert.ok(titles(g).includes('Ürün 12'), 'listenin sonundaki öğe bulunmadı');
  assert.ok(titles(g).includes('Sepete ekle'), 'kaydırma sonrası açılan ekran bulunmadı');
  assert.equal(g.stats.screens, 2, `beklenen 2 ekran (liste + detay), bulunan ${g.stats.screens}`);
  assert.ok(g.stats.scrolls >= 2);
});

/** Giriş duvarı: doğru bilgiyle içeri, yanlışla hata ekranı. */
const loginApp = {
  pkg: PKG,
  start: (s) => (s.loggedIn ? 'home' : 'login'),
  screens: {
    login: {
      title: 'Hoş geldin',
      items: [
        { text: 'E-posta', field: true, id: 'email' },
        { text: 'Şifre', field: true, id: 'password', password: true },
        { text: 'Giriş', to: (s, val) => {
          if (val('login', 'email') === 'qa@ornek.com' && val('login', 'password') === 'G1zli&şifre') { s.loggedIn = true; return 'home'; }
          return 'loginError';
        } },
        { text: 'Şifremi unuttum', to: 'forgot' },
      ],
    },
    loginError: { title: 'Hatalı e-posta ya da şifre', items: [{ text: 'Tekrar dene' }] },
    forgot: { title: 'Şifre sıfırlama', items: [] },
    home: { title: 'Panel', items: [{ text: 'Raporlar', to: 'reports' }] },
    reports: { title: 'Rapor listesi', items: [] },
  },
};

test('giriş bilgisi verilirse login duvarını geçip içeriyi keşfeder', async () => {
  await withEnv({ TESTFUL_LOGIN_USER: 'qa@ornek.com', TESTFUL_LOGIN_PASSWORD: 'G1zli&şifre' }, async () => {
    const dev = fakeDevice(loginApp);
    const g = await map({ pkg: PKG, out: out(), maxActions: 100, device: dev });
    assert.ok(dev.state.loggedIn, 'giriş yapılamadı');
    assert.ok(titles(g).includes('Raporlar'), 'giriş sonrası ekran keşfedilmedi');
    assert.equal(g.stats.forms_submitted >= 1, true);
  });
});

test('giriş bilgisi yoksa formu sahte değerle dener, hata ekranını raporlar ve durur', async () => {
  await withEnv({ TESTFUL_LOGIN_USER: '', TESTFUL_LOGIN_PASSWORD: '' }, async () => {
    const dev = fakeDevice(loginApp);
    const g = await map({ pkg: PKG, out: out(), maxActions: 100, device: dev });
    assert.equal(dev.state.loggedIn, false);
    assert.ok(titles(g).includes('Tekrar dene'), 'hata ekranı keşfedilmedi');
    assert.ok(g.stats.actions < 40, `dokunuş: ${g.stats.actions}`);
  });
});

test('maxActions sınırına uyar', async () => {
  const dev = fakeDevice(treeApp);
  const g = await map({ pkg: PKG, out: out(), maxActions: 3, device: dev });
  assert.ok(g.stats.actions <= 3);
});

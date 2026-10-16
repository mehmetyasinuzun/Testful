// Keşif kararları (explore), alan planı (fieldPlan) ve sır maskeleme birim testleri.
// Ağaç/logcat/araç işlevlerinin testleri core.test.mjs'tedir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyField, formKind, orderCandidates, shortestPath, isRisky, isSubmit, SECRET_FOR, FALLBACK, fold } from '../cli/lib/explore.mjs';
import { fieldPlan } from '../cli/lib/map.mjs';
import { secretValues, redact } from '../cli/lib/maestro.mjs';
import { elementKey } from '../cli/lib/tree.mjs';

const btn = (label) => ({ kind: 'button', label, full_text: label, class: 'Button', center: { x: 1, y: 1 } });
const field = (label, extra = {}) => ({ kind: 'field', label, full_text: label, class: 'EditText', center: { x: 1, y: 2 }, ...extra });

test('explore: alan sınıflandırma (TR/EN, resource-id, password bayrağı, büyük harf)', () => {
  assert.equal(classifyField(field('E-posta adresi')), 'email');
  assert.equal(classifyField(field('Username')), 'email');
  assert.equal(classifyField(field('KULLANICI ADI')), 'email');
  assert.equal(classifyField(field(null, { resource_id: 'com.app:id/et_password' })), 'password');
  assert.equal(classifyField(field('xyz', { password: true })), 'password');
  assert.equal(classifyField(field('ŞİFRE')), 'password');
  assert.equal(classifyField(field('Doğrulama kodu')), 'otp');
  assert.equal(classifyField(field('Cep telefonu')), 'phone');
  assert.equal(classifyField(field('Adın')), 'text');
});

test('fieldPlan: tür → MAESTRO_* sırrı; sır yoksa dolu alan korunur, boşsa sahte değer', () => {
  const s = { MAESTRO_EMAIL: 'qa@x.com', MAESTRO_PASSWORD: 'pw', MAESTRO_OTP: '424242', MAESTRO_PHONE: '5550000000' };
  assert.deepEqual(fieldPlan(field('E-posta'), s), { type: 'qa@x.com', record: { secretVar: 'MAESTRO_EMAIL' } });
  assert.deepEqual(fieldPlan(field('Doğrulama kodu'), s), { type: '424242', record: { secretVar: 'MAESTRO_OTP' } });
  assert.deepEqual(fieldPlan(field('Telefon'), s), { type: '5550000000', record: { secretVar: 'MAESTRO_PHONE' } });
  // Android boş alanın ipucunu metin olarak döker; sır varsa yine de üzerine yazılır
  assert.equal(fieldPlan(field('Şifre', { value: 'Şifre' }), s).type, 'pw');
  assert.deepEqual(fieldPlan(field('E-posta', { value: 'eski@x.com' })), { type: null, record: { kept: true } });
  assert.equal(fieldPlan(field('Doğrulama kodu')).type, FALLBACK.otp);
  assert.equal(SECRET_FOR.text, undefined);
});

test('explore: form türü', () => {
  assert.equal(formKind([field('E-posta'), field('Şifre', { password: true }), btn('Giriş')]), 'login');
  assert.equal(formKind([field('Doğrulama kodu')]), 'otp');
  assert.equal(formKind([field(null), field(null), field(null), field(null)]), 'otp');
  assert.equal(formKind([field('Adın')]), null);
  assert.equal(formKind([btn('Tamam')]), null);
});

test('explore: riskli öğeler (silme, çıkış, ödeme, abonelik) — yanlış pozitif yok', () => {
  for (const t of ['Hesabı sil', 'Sil', 'Çıkış yap', 'Log out', 'Satın al', 'Buy now', 'Abone ol', 'Delete account', 'Deactivate']) {
    assert.ok(isRisky(btn(t)), t);
  }
  for (const t of ['Profil', 'Silgi', 'Ayarlar', 'PayPal ile bağlan', 'Ödemeler geçmişi']) assert.ok(!isRisky(btn(t)), t);
});

test('explore: Türkçe büyük harf (cihaz diline göre GİRİŞ/GIRIŞ) doğru eşleşir', () => {
  for (const t of ['GİRİŞ', 'GIRIŞ', 'Giriş', 'DEVAM ET', 'LOGIN']) assert.ok(isSubmit(btn(t)), t);
  for (const t of ['HESABI SİL', 'HESABI SIL', 'ÇIKIŞ YAP', 'SATIN AL']) assert.ok(isRisky(btn(t)), t);
  assert.ok(!isRisky(btn('PROFİL')));
  assert.equal(fold('GİRİŞ'), fold('giriş'));
});

test('explore: aday sırası — alan ve riskli atlanır, etiketliler önce, gönder sona', () => {
  const unl = { kind: 'button', label: null, class: 'ImageButton', center: { x: 9, y: 9 } };
  const els = [btn('Giriş'), field('E-posta'), btn('Hesabı sil'), unl, btn('Şifremi unuttum')];
  assert.deepEqual(orderCandidates(els, new Set()).map((e) => e.label), ['Şifremi unuttum', null, 'Giriş']);
  const tried = new Set([elementKey(btn('Şifremi unuttum')), elementKey(unl), elementKey(btn('Giriş'))]);
  assert.deepEqual(orderCandidates(els, tried), []);
});

test('explore: en kısa yol (BFS) ve ulaşılamazlık', () => {
  const edges = [
    { from: 'A', to: 'B', key: 'b' }, { from: 'B', to: 'C', key: 'c' },
    { from: 'A', to: 'D', key: 'd' }, { from: 'D', to: 'C', key: 'c2' }, { from: 'C', to: 'C', key: 'self' },
  ];
  assert.deepEqual(shortestPath(edges, 'A', (s) => s === 'C').map((e) => e.key), ['b', 'c']);
  assert.deepEqual(shortestPath(edges, 'A', (s) => s === 'A'), []);
  assert.equal(shortestPath(edges, 'C', (s) => s === 'A'), null);
});

test('maestro: log ve debug çıktısında şifre/OTP maskelenir, e-posta kalır', () => {
  const env = { MAESTRO_EMAIL: 'qa@x.com', MAESTRO_PASSWORD: 'G1zli&şifre', MAESTRO_OTP: '424242', HOME: '/root', MAESTRO_CLI_NO_ANALYTICS: 'true' };
  const s = secretValues(env);
  assert.deepEqual(s, ['G1zli&şifre', '424242']);
  assert.equal(redact('Input text G1zli&şifre ... code 424242 for qa@x.com', s), 'Input text *** ... code *** for qa@x.com');
});

test('run: Maestro debug çıktısındaki takeScreenshot PNG\'leri durum klasörüne toplanır', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { collectScreenshots } = await import('../cli/lib/run.mjs');
  const root = mkdtempSync(join(tmpdir(), 'testful-shots-'));
  const debug = join(root, 'debug', 'DEMO-01-1');
  mkdirSync(join(debug, 'DEMO-01.flow', 'takeScreenshot'), { recursive: true });
  writeFileSync(join(debug, 'DEMO-01.flow', 'takeScreenshot', 'DEMO-01-1.png'), 'png');
  writeFileSync(join(debug, 'screenshot-❌-hata.png'), 'png'); // hata görüntüsü kanıttır, senaryo görüntüsü değil
  const shots = join(root, 'screenshots', 'normal');
  mkdirSync(shots, { recursive: true });
  assert.equal(collectScreenshots(debug, shots), 1);
  assert.deepEqual(readdirSync(shots), ['DEMO-01-1.png']);
  assert.equal(collectScreenshots(join(root, 'yok'), shots), 0);
});

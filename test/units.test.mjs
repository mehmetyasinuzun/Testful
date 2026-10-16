import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseNodes, interactives, screenSignature } from '../cli/lib/tree.mjs';
import { classifyField, valueFor, formKind, pickCandidate, shortestPath, isRisky, isSubmit, elKey } from '../cli/lib/explore.mjs';
import { crashHits, HARD_KINDS } from '../cli/lib/crash.mjs';
import { flowEnvArgs, redact } from '../cli/lib/run.mjs';
import { sdkRoots, findOnPath, spawnArgs, freeDiskGb } from '../cli/lib/platform.mjs';
import { escapeInputText } from '../cli/lib/device.mjs';
import { parseJavaVersion } from '../cli/lib/setup.mjs';

const node = (attrs) => `<node ${Object.entries({ text: '', 'resource-id': '', class: 'android.widget.TextView', package: 'p', 'content-desc': '', clickable: 'false', password: 'false', scrollable: 'false', bounds: '[0,0][100,100]', ...attrs }).map(([k, v]) => `${k}="${v}"`).join(' ')} />`;
const tree = (...nodes) => `<?xml version='1.0'?><hierarchy>${nodes.join('')}</hierarchy>`;

// --- tree ------------------------------------------------------------------

test('tree: metin alanı içeriği ekran imzasını değiştirmez', () => {
  const a = parseNodes(tree(node({ text: 'Profil' }), node({ class: 'android.widget.EditText', text: '', clickable: 'true' })));
  const b = parseNodes(tree(node({ text: 'Profil' }), node({ class: 'android.widget.EditText', text: 'TestTestTest', clickable: 'true' })));
  assert.equal(screenSignature(a, 'p'), screenSignature(b, 'p'));
});

test('tree: rakamlar normalleşir (saat/fiyat yeni ekran değildir), farklı metin farklı ekrandır', () => {
  const s = (t) => screenSignature(parseNodes(tree(node({ text: t }))), 'p');
  assert.equal(s('Saat 10:41'), s('Saat 11:02'));
  assert.notEqual(s('Profil'), s('Ayarlar'));
});

test('tree: resource-id kısa adı ve seçici önerisi', () => {
  const nodes = parseNodes(tree(
    node({ text: 'Giriş', 'resource-id': 'com.app:id/login_btn', clickable: 'true', class: 'android.widget.Button' }),
    node({ 'content-desc': 'Ana sayfa&#10;Sekme 1 / 4', clickable: 'true' }),
  ));
  const els = interactives(nodes, 'p');
  assert.equal(els[0].id, 'login_btn');
  assert.equal(els[0].selector, '"Giriş"');
  assert.equal(els[1].kind, 'tab');
  assert.equal(els[1].match, 'regex');
});

// --- explore -----------------------------------------------------------------

test('explore: alan sınıflandırma (TR/EN, resource-id, password bayrağı)', () => {
  assert.equal(classifyField({ label: 'E-posta adresi' }), 'email');
  assert.equal(classifyField({ label: 'Username' }), 'email');
  assert.equal(classifyField({ label: null, id: 'et_password' }), 'password');
  assert.equal(classifyField({ label: 'xyz', password: true }), 'password');
  assert.equal(classifyField({ label: 'Doğrulama kodu' }), 'otp');
  assert.equal(classifyField({ label: 'Cep telefonu' }), 'phone');
  assert.equal(classifyField({ label: 'Adın' }), 'text');
});

test('explore: değerler ortamdan gelir, yoksa biçimi geçerli sahte değer', () => {
  assert.equal(valueFor('email', {}), 'test@example.com');
  assert.equal(valueFor('email', { TESTFUL_LOGIN_USER: 'qa@x.com' }), 'qa@x.com');
  assert.equal(valueFor('password', { TESTFUL_LOGIN_PASSWORD: 's3cret' }), 's3cret');
  assert.equal(valueFor('otp', {}), '123456');
});

test('explore: form türü', () => {
  const f = (label, extra = {}) => ({ kind: 'field', label, ...extra });
  assert.equal(formKind([f('E-posta'), f('Şifre', { password: true }), { kind: 'button', label: 'Giriş' }]), 'login');
  assert.equal(formKind([f('Doğrulama kodu')]), 'otp');
  assert.equal(formKind([f(null), f(null), f(null), f(null)]), 'otp');
  assert.equal(formKind([f('Adın')]), null);
  assert.equal(formKind([{ kind: 'button', label: 'Tamam' }]), null);
});

test('explore: riskli öğeler (silme, çıkış, ödeme) — yanlış pozitif yok', () => {
  for (const t of ['Hesabı sil', 'Sil', 'Çıkış yap', 'Log out', 'Satın al', 'Buy now', 'Abone ol', 'Delete account']) {
    assert.ok(isRisky({ label: t }), t);
  }
  for (const t of ['Profil', 'Silgi', 'Ayarlar', 'PayPal ile bağlan', 'Ödemeler geçmişi']) {
    assert.ok(!isRisky({ label: t }), t);
  }
});

test('explore: Türkçe büyük harf (cihaz diline göre GİRİŞ/GIRIŞ) doğru eşleşir', () => {
  const b = (label) => ({ kind: 'button', label });
  for (const t of ['GİRİŞ', 'GIRIŞ', 'Giriş', 'DEVAM ET', 'LOGIN']) assert.ok(isSubmit(b(t)), t);
  for (const t of ['HESABI SİL', 'HESABI SIL', 'ÇIKIŞ YAP', 'SATIN AL']) assert.ok(isRisky(b(t)), t);
  assert.ok(!isRisky(b('PROFİL')));
  assert.equal(classifyField({ label: 'ŞİFRE' }), 'password');
  assert.equal(classifyField({ label: 'KULLANICI ADI' }), 'email');
});

test('explore: aday seçimi — alan ve riskli atlanır, gönder butonu sona kalır', () => {
  const els = [
    { kind: 'button', label: 'Giriş', center: { x: 1, y: 1 } },
    { kind: 'field', label: 'E-posta', center: { x: 1, y: 2 } },
    { kind: 'button', label: 'Hesabı sil', center: { x: 1, y: 3 } },
    { kind: 'button', label: 'Şifremi unuttum', center: { x: 1, y: 4 } },
  ];
  assert.equal(pickCandidate(els, new Set()).label, 'Şifremi unuttum');
  assert.equal(pickCandidate(els, new Set(['Şifremi unuttum'])).label, 'Giriş');
  assert.equal(pickCandidate(els, new Set(['Şifremi unuttum', 'Giriş'])), null);
  assert.ok(isSubmit({ kind: 'button', label: 'Devam et' }));
  assert.equal(elKey({ label: null, id: 'fab', class: 'ImageButton', center: { x: 5, y: 6 } }), '#fab');
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

// --- crash -------------------------------------------------------------------

test('crash: yalnız hedef paketin çökmesi sayılır', () => {
  const log = [
    'E AndroidRuntime: FATAL EXCEPTION: main',
    'E AndroidRuntime: Process: com.other.app, PID: 9',
    'E AndroidRuntime: java.lang.IllegalStateException',
    'E AndroidRuntime: FATAL EXCEPTION: main',
    'E AndroidRuntime: Process: dev.app, PID: 12',
    'E AndroidRuntime: java.lang.NullPointerException',
    'E AndroidRuntime: \tat dev.app.Main.onCreate(Main.java:10)',
    'I ActivityManager: unrelated line',
    'E ActivityManager: ANR in com.android.systemui',
    'E ActivityManager: ANR in dev.app (dev.app/.Main)',
    'F DEBUG   : pid: 12, tid: 12, name: main  >>> dev.app <<<',
    'E flutter : [ERROR:flutter/runtime] Unhandled Exception',
  ].join('\n');
  const hits = crashHits(log, 'dev.app', 'test');
  assert.deepEqual(hits.map((h) => h.kind), ['çökme', 'ANR', 'native çökme', 'flutter hatası']);
  assert.ok(hits[0].text.includes('NullPointerException'));
  assert.ok(!hits[0].text.includes('unrelated'), 'yığın bağlamı AndroidRuntime satırlarıyla sınırlı olmalı');
  assert.equal(hits.filter((h) => HARD_KINDS.has(h.kind)).length, 3);
});

// --- run: gizli bilgi yönetimi -----------------------------------------------------

test('run: akışa yalnız TESTFUL_LOGIN_/MAESTRO_ değişkenleri geçer', () => {
  const args = flowEnvArgs({ TESTFUL_LOGIN_USER: 'u', MAESTRO_X: '1', HOME: '/root', TESTFUL_LOGIN_OTP: '' });
  assert.deepEqual(args, ['-e', 'MAESTRO_X=1', '-e', 'TESTFUL_LOGIN_USER=u']);
});

test('run: log ve artifact metninde şifre/OTP maskelenir, kullanıcı adı kalır', () => {
  const env = { TESTFUL_LOGIN_USER: 'qa@x.com', TESTFUL_LOGIN_PASSWORD: 'G1zli&şifre', TESTFUL_LOGIN_OTP: '424242' };
  const out = redact('Input text G1zli&şifre ... code 424242 for qa@x.com', env);
  assert.equal(out, 'Input text *** ... code *** for qa@x.com');
});

// --- device ----------------------------------------------------------------------

test('device: input text kabuk metakarakterlerini kaçırır', () => {
  assert.equal(escapeInputText('a b'), 'a%sb');
  assert.equal(escapeInputText('P@ss&w;$x'), 'P@ss\\&w\\;\\$x');
  assert.equal(escapeInputText(`it's`), `it\\'s`);
});

// --- platform ----------------------------------------------------------------------

test('platform: SDK kökleri her işletim sisteminde doğru sırada', () => {
  assert.deepEqual(sdkRoots({ ANDROID_HOME: '/sdk' }, 'linux', '/home/u'), ['/sdk', join('/home/u', 'Android', 'Sdk')]);
  assert.deepEqual(sdkRoots({}, 'darwin', '/Users/u'), [join('/Users/u', 'Library', 'Android', 'sdk')]);
  assert.equal(sdkRoots({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\U').at(-1), join('C:\\L', 'Android', 'Sdk'));
});

test('platform: PATH araması alt süreç açmadan bulur', () => {
  const dir = mkdtempSync(join(tmpdir(), 'testful-path-'));
  const exe = join(dir, 'fakebin');
  writeFileSync(exe, '#!/bin/sh\n');
  chmodSync(exe, 0o755);
  assert.equal(findOnPath('fakebin', { PATH: dir }, 'linux'), exe);
  assert.equal(findOnPath('yok-boyle-bir-sey', { PATH: dir }, 'linux'), null);
});

test('platform: .bat yalnız Windows\'ta shell ile ve tırnaklı argümanla çalışır', () => {
  assert.deepEqual(spawnArgs('/usr/bin/maestro', ['test', 'a b'], 'linux'), { cmd: '/usr/bin/maestro', args: ['test', 'a b'], shell: false });
  const w = spawnArgs('C:\\dev\\maestro\\bin\\maestro.bat', ['test', '-e', 'P=a&b', 'x y.yaml'], 'win32');
  assert.equal(w.shell, true);
  assert.deepEqual(w.args, ['test', '-e', '"P=a&b"', '"x y.yaml"']);
  assert.equal(typeof freeDiskGb(), 'number');
});

test('setup: java sürümü ayrıştırma', () => {
  assert.equal(parseJavaVersion('java version "1.8.0_392"'), 8);
  assert.equal(parseJavaVersion('openjdk version "17.0.20" 2026-07-15'), 17);
  assert.equal(parseJavaVersion('openjdk version "21" 2023-09-19'), 21);
  assert.equal(parseJavaVersion(''), null);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseNodes, interactives, screenSignature, a11yIssues, reEscape } from '../cli/lib/tree.mjs';
import { scanLogcat, hitsToFindings } from '../cli/lib/logcat.mjs';
import { parseDotenv, globToRegex, parseArgs, newRunId } from '../cli/lib/util.mjs';
import { detectPackage, loadSecrets, loadConfig } from '../cli/lib/config.mjs';
import { classifyOutput } from '../cli/lib/maestro.mjs';

const fixture = readFileSync(new URL('./fixtures/compass-login.xml', import.meta.url), 'utf8');
const made = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'testful-test-')); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const node = (attrs) => `<node ${Object.entries({ text: '', 'resource-id': '', class: 'android.widget.Button', package: 'com.x', 'content-desc': '', clickable: 'true', enabled: 'true', bounds: '[0,0][200,200]', ...attrs }).map(([k, v]) => `${k}="${v}"`).join(' ')} />`;
const xmlOf = (...nodes) => `<?xml version='1.0' ?><hierarchy rotation="0">${nodes.join('')}</hierarchy>`;

test('gerçek Flutter ağacı ayrıştırılır, giriş alanları ve buton bulunur', () => {
  const nodes = parseNodes(fixture);
  assert.ok(nodes.length > 5);
  const els = interactives(nodes, 'com.example.compass_app');
  assert.ok(els.some((e) => e.kind === 'field'));
  assert.ok(els.some((e) => e.kind === 'button' && e.label === 'Login'));
});

test('ekran imzası deterministik ve rakam değişimine dayanıklı', () => {
  const a = parseNodes(xmlOf(node({ text: 'Sepet (3)' })));
  const b = parseNodes(xmlOf(node({ text: 'Sepet (5)' })));
  const c = parseNodes(xmlOf(node({ text: 'Profil' })));
  assert.equal(screenSignature(a, 'com.x'), screenSignature(b, 'com.x'));
  assert.notEqual(screenSignature(a, 'com.x'), screenSignature(c, 'com.x'));
});

test('seçiciler regex-güvenli: özel karakterler kaçışlanır, tek tırnak YAML\'da ikilenir', () => {
  const els = interactives(parseNodes(xmlOf(node({ text: "Fiyat (USD) + 1's" }))), 'com.x');
  assert.equal(els[0].selector, "'Fiyat \\(USD\\) \\+ 1''s'");
  assert.equal(els[0].match, 'exact');
});

test('çok satırlı birleşik düğüm [\\s\\S]* regex alır; sekme türü tanınır', () => {
  const els = interactives(parseNodes(xmlOf(node({ 'content-desc': 'Kelimeler&#10;Sekme 2 / 5' }))), 'com.x');
  assert.equal(els[0].kind, 'tab');
  assert.equal(els[0].selector, "'Kelimeler[\\s\\S]*'");
});

test('benzersiz resource-id varsa id seçicisi tercih edilir; tekrarlı etiket belirsiz işaretlenir', () => {
  const els = interactives(parseNodes(xmlOf(
    node({ text: 'Kaydet', 'resource-id': 'com.x:id/save', bounds: '[0,0][200,200]' }),
    node({ text: 'Sil', bounds: '[0,300][200,500]' }),
    node({ text: 'Sil', bounds: '[0,600][200,800]' }),
  )), 'com.x');
  assert.equal(els[0].match, 'id');
  assert.equal(els[0].selector, "id: 'save'");
  assert.equal(els[1].ambiguous, true);
});

test('pasif (enabled=false) öğeler etkileşim listesine girmez', () => {
  const els = interactives(parseNodes(xmlOf(node({ text: 'Gönder', enabled: 'false' }))), 'com.x');
  assert.equal(els.length, 0);
});

test('a11y: etiketsiz buton ve küçük dokunma hedefi raporlanır', () => {
  const els = interactives(parseNodes(xmlOf(node({ bounds: '[0,0][60,60]' }))), 'com.x');
  const issues = a11yIssues(els, { density: 2.625 });
  assert.ok(issues.some((i) => i.kind === 'label-missing'));
  assert.ok(issues.some((i) => i.kind === 'small-target'));
});

test('HTML varlıkları çözülür', () => {
  const [n] = parseNodes(xmlOf(node({ text: 'A &amp; B &lt;3 &quot;x&quot;' })));
  assert.equal(n.text, 'A & B <3 "x"');
  assert.equal(reEscape('a.b'), 'a\\.b');
});

const CRASH = `10-16 12:00:00.000  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main
10-16 12:00:00.000  1234  1234 E AndroidRuntime: Process: com.x, PID: 1234
10-16 12:00:00.000  1234  1234 E AndroidRuntime: java.lang.NullPointerException: boom
10-16 12:00:00.000  1234  1234 E AndroidRuntime: 	at com.x.Main.onCreate(Main.java:42)`;

test('logcat: hedef paketin çökmesi kritik/kesin bulgu olur', () => {
  const r = scanLogcat(CRASH, { pkg: 'com.x' });
  assert.equal(r.clean, false);
  assert.equal(r.hits[0].type, 'crash');
  const [f] = hitsToFindings(r.hits, { source: 't', evidence: [] });
  assert.equal(f.severity, 'kritik');
  assert.equal(f.confidence, 'kesin');
});

test('logcat: başka paketin çökmesi ve "crashlytics" gürültüsü yanlış alarm üretmez', () => {
  assert.equal(scanLogcat(CRASH.replace(/com\.x/g, 'com.other'), { pkg: 'com.x' }).clean, true);
  assert.equal(scanLogcat('I FirebaseCrashlytics: Crashlytics initialized\nD CRASH_REPORTER: ok', { pkg: 'com.x' }).clean, true);
});

test('logcat: aynı imza tekrarları birleştirilir; ANR ve Flutter taşması tanınır', () => {
  const r = scanLogcat(`${CRASH}\n${CRASH}\nE ActivityManager: ANR in com.x (com.x/.Main)\nI flutter : A RenderFlex overflowed by 42 pixels on the right.`, { pkg: 'com.x' });
  const crash = r.hits.find((h) => h.type === 'crash');
  assert.equal(crash.count, 2);
  assert.ok(r.hits.some((h) => h.type === 'anr'));
  assert.ok(r.hits.some((h) => h.type === 'overflow'));
});

test('maestro çıktısı: ortam hatası ve başarısız adım nedeni ayrıştırılır', () => {
  assert.equal(classifyOutput('io.grpc.StatusRuntimeException: UNAVAILABLE: io exception').envError, true);
  const c = classifyOutput('Launch app "com.x"... COMPLETED\nAssert that "Login" is visible... FAILED\n');
  assert.equal(c.envError, false);
  assert.match(c.reason, /Login.*FAILED/);
});

test('util: dotenv, glob, argüman ayrıştırma, run-id', () => {
  assert.deepEqual(parseDotenv('# c\nEMAIL=a@b.c\nexport PASS="x y" \nBAD LINE\nK=v # yorum'), { EMAIL: 'a@b.c', PASS: 'x y', K: 'v' });
  const re = globToRegex('CORE-*,NAV-a.b');
  assert.ok(re.test('CORE-01') && re.test('NAV-a.b') && !re.test('NAV-aXb'));
  assert.deepEqual(parseArgs(['--json', 'app', 'CORE-*', '--matrix=dark,offline', '--pkg', 'com.x'], new Set(['json'])),
    { pos: ['app', 'CORE-*'], flags: { json: true, matrix: 'dark,offline', pkg: 'com.x' } });
  assert.match(newRunId(new Date(2026, 9, 16, 9, 5, 3)), /^20261016-090503$/);
});

test('config: gradle\'dan paket bulunur, sırlar MAESTRO_ önekiyle yüklenir, port listesi temizlenir', () => {
  const d = tmp();
  mkdirSync(join(d, 'android', 'app'), { recursive: true });
  writeFileSync(join(d, 'android', 'app', 'build.gradle.kts'), 'android { defaultConfig { applicationId = "com.ornek.app" } }');
  assert.equal(detectPackage(d), 'com.ornek.app');
  mkdirSync(join(d, '.qa'));
  writeFileSync(join(d, '.qa', 'env.local'), 'EMAIL=a@b.c\nMAESTRO_X=1\n');
  assert.deepEqual(loadSecrets(d), { MAESTRO_EMAIL: 'a@b.c', MAESTRO_X: '1' });
  writeFileSync(join(d, '.qa', 'testful.json'), JSON.stringify({ reverse: [8080, 'x', 70000] }));
  assert.deepEqual(loadConfig(d).reverse, [8080]);
});

test('monkey: yalnız hedef paketin çökmesi sayılır (emülatör servis çökmesi yanlış alarm değildir)', async () => {
  const { monkeyCrashedPkg } = await import('../cli/lib/smoke.mjs');
  const out = '// CRASH: com.google.android.bluetooth (pid 1178)\n// Short Msg: Native crash';
  assert.equal(monkeyCrashedPkg(out, 'com.x'), false);
  assert.equal(monkeyCrashedPkg(`${out}\n// NOT RESPONDING: com.x (pid 99)`, 'com.x'), true);
});

test('ekran imzası giriş alanlarının içeriğini yok sayar (yazmak yeni ekran yaratmaz)', () => {
  const field = (text) => node({ class: 'android.widget.EditText', text, 'resource-id': 'com.x:id/email', bounds: '[0,0][500,100]' });
  const a = parseNodes(xmlOf(field('email@example.com'), node({ text: 'Login', bounds: '[0,200][200,300]' })));
  const b = parseNodes(xmlOf(field('email@example.comtest'), node({ text: 'Login', bounds: '[0,200][200,300]' })));
  assert.equal(screenSignature(a, 'com.x'), screenSignature(b, 'com.x'));
});

test('maestro çıktısı: dolu disk / JVM başlatma hatası uygulama hatası değil ortam hatasıdır', () => {
  assert.equal(classifyOutput('java.lang.UnsatisfiedLinkError: Failed to create temporary file for jnidispatch.dll library: Diskte yeterli yer yok').envError, true);
  assert.equal(classifyOutput('java.io.IOException: No space left on device').envError, true);
});

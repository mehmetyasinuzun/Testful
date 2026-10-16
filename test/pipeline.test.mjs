import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { finalizeReport, refinalize } from '../cli/lib/report.mjs';
import { authorFromMap, shortestPaths } from '../cli/lib/author.mjs';
import { listFlows } from '../cli/lib/run.mjs';

const made = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'testful-test-')); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const CLI = new URL('../cli/testful.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const cli = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, TESTFUL_LOG_DIR: tmp() }, ...opts });

const scen = (id, result, extra = {}) => ({ id, title: id, result, confidence: result === 'flaky' ? 'flaky-şüphesi' : 'kesin', attempts: 1, passes: result === 'pass' ? 1 : 0, logs: [], screenshots: [], ...extra });

test('rapor: başarısız senaryo engelleyicidir, flaky değildir; durum ve md üretilir', () => {
  const root = tmp();
  const run = join(root, '20260101-000000');
  mkdirSync(run);
  const r = finalizeReport(run, { kind: 'run', scenarios: [scen('A', 'pass'), scen('B', 'fail', { reason: 'Login görünmedi' }), scen('C', 'flaky')] });
  assert.equal(r.status, 'not-ready');
  assert.equal(r.totals.failed, 1);
  assert.equal(r.totals.flaky, 1);
  assert.equal(r.blocking.length, 1);
  assert.match(readFileSync(join(run, 'report.md'), 'utf8'), /HAZIR DEĞİL/);
});

test('rapor: yalnız flaky ve düşük bulgular → hazır; ortam hatası → belirsiz', () => {
  const root = tmp();
  const a = join(root, '20260101-000000');
  mkdirSync(a);
  assert.equal(finalizeReport(a, { kind: 'run', scenarios: [scen('A', 'flaky')], findings: [{ type: 'a11y', severity: 'düşük', confidence: 'kesin', title: 'x', key: 'k' }] }).status, 'ready');
  const b = join(root, '20260101-000001');
  mkdirSync(b);
  assert.equal(finalizeReport(b, { kind: 'run', scenarios: [scen('A', 'env-error')] }).status, 'inconclusive');
});

test('rapor: önceki koşuyla fark (yeni/çözülen/devam eden) ve AI ek bulgularıyla yeniden üretim', () => {
  const root = tmp();
  const a = join(root, '20260101-000000');
  const b = join(root, '20260102-000000');
  mkdirSync(a); mkdirSync(b);
  finalizeReport(a, { kind: 'run', scenarios: [scen('A', 'fail'), scen('B', 'fail')] });
  const r = finalizeReport(b, { kind: 'run', scenarios: [scen('A', 'fail'), scen('B', 'pass'), scen('C', 'fail')] });
  assert.equal(r.diff.previous_run, '20260101-000000');
  assert.equal(r.diff.new.length, 1);
  assert.equal(r.diff.resolved.length, 1);
  assert.equal(r.diff.persisting.length, 1);

  writeFileSync(join(b, 'findings.extra.json'), JSON.stringify({ findings: [{ title: 'Buton metni taşıyor', severity: 'kritik', confidence: 'muhtemel' }] }));
  const r2 = refinalize(b);
  assert.ok(r2.findings.some((f) => f.title === 'Buton metni taşıyor'));
  assert.equal(r2.findings[0].severity, 'kritik');
});

const GRAPH = {
  package: 'com.x',
  start: 'aaa',
  screen: { w: 1000, h: 2000 },
  nodes: {
    aaa: { sig: 'aaa', anchor: { selector: "'Giriş'", match: 'exact' }, interactives: [{ label: 'Giriş', kind: 'button' }] },
    bbb: { sig: 'bbb', anchor: { selector: "id: 'home'", match: 'id' }, interactives: [{ label: 'Ana sayfa', kind: 'button' }] },
    ccc: { sig: 'ccc', anchor: null, interactives: [] },
    zzz: { sig: 'zzz', anchor: null, interactives: [] },
  },
  edges: [
    { from: 'aaa', to: 'bbb', via: 'Giriş', tap: { selector: "'Giriş'", match: 'exact', center: { x: 500, y: 1000 } },
      inputs: [{ x: 500, y: 400, text: 'test@example.com', selector: null, match: null }] },
    { from: 'bbb', to: 'ccc', via: 'View@100,100', tap: { selector: null, match: null, center: { x: 100, y: 100 } }, inputs: [] },
  ],
};

test('author: en kısa yollar; girişler, yüzde koordinatlar ve id seçicileriyle flow üretilir; mevcut dosya ezilmez', () => {
  const paths = shortestPaths(GRAPH);
  assert.equal(paths.ccc.length, 2);
  assert.ok(!('zzz' in paths));
  const d = tmp();
  const mapDir = join(d, 'map');
  mkdirSync(mapDir);
  writeFileSync(join(mapDir, 'graph.json'), JSON.stringify(GRAPH));
  const out = join(d, 'scenarios');
  const r = authorFromMap({ mapDir, out });
  assert.equal(r.written, 3);
  assert.deepEqual(r.unreachable, ['zzz']);
  const flow = readFileSync(join(out, 'NAV-ccc.flow.yaml'), 'utf8');
  assert.match(flow, /^appId: com\.x/);
  assert.match(flow, /point: "50%,20%"/);
  assert.match(flow, /inputText: 'test@example\.com'/);
  assert.match(flow, /tapOn: 'Giriş'/);
  assert.match(flow, /point: "10%,5%"/);
  assert.match(readFileSync(join(out, 'NAV-bbb.flow.yaml'), 'utf8'), /visible:\n\s+id: 'home'/);
  assert.ok(existsSync(join(out, 'LAUNCH-00.yaml')));
  writeFileSync(join(out, 'NAV-bbb.flow.yaml'), 'EL İLE DÜZENLENDİ');
  assert.equal(authorFromMap({ mapDir, out }).written, 0);
  assert.equal(readFileSync(join(out, 'NAV-bbb.flow.yaml'), 'utf8'), 'EL İLE DÜZENLENDİ');
  assert.deepEqual(listFlows(out, 'NAV-*'), ['NAV-bbb', 'NAV-ccc']);
});

test('CLI: yardım 0, bilinmeyen komut 2, kritik logcat 1, temiz logcat 0', () => {
  assert.equal(cli(['--help']).status, 0);
  assert.equal(cli(['nope']).status, 2);
  const d = tmp();
  const bad = join(d, 'bad.txt');
  writeFileSync(bad, 'E AndroidRuntime: FATAL EXCEPTION: main\nE AndroidRuntime: Process: com.x, PID: 1');
  assert.equal(cli(['logcat-scan', bad, '--pkg', 'com.x']).status, 1);
  const good = join(d, 'good.txt');
  writeFileSync(good, 'I ok: fine');
  assert.equal(cli(['logcat-scan', good]).status, 0);
});

test('CLI: init iskeleti kurar, .gitignore\'u tekrarlamadan günceller; report --json kompakt karar verir', () => {
  const d = tmp();
  mkdirSync(join(d, 'android', 'app'), { recursive: true });
  writeFileSync(join(d, 'android', 'app', 'build.gradle'), "android { defaultConfig { applicationId 'com.ornek' } }");
  assert.equal(cli(['init', d, '--no-skill']).status, 0);
  assert.equal(cli(['init', d, '--no-skill']).status, 0);
  const cfg = JSON.parse(readFileSync(join(d, '.qa', 'testful.json'), 'utf8'));
  assert.equal(cfg.package, 'com.ornek');
  const gi = readFileSync(join(d, '.gitignore'), 'utf8');
  assert.equal(gi.split('.qa/env.local').length, 2);

  const run = join(d, '.qa', 'results', '20260101-000000');
  mkdirSync(run, { recursive: true });
  finalizeReport(run, { kind: 'run', scenarios: [scen('A', 'fail', { reason: 'x' })] });
  const res = cli(['report', run, '--json']);
  assert.equal(res.status, 1);
  const j = JSON.parse(res.stdout);
  assert.equal(j.status, 'not-ready');
  assert.equal(j.failed_scenarios[0].id, 'A');
  assert.ok(j.next_actions.length > 0);
});

test('crawler alan planı: dolu alan ezilmez, sır varsa kullanılır; flow\'a değer değil ${MAESTRO_*} referansı yazılır', async () => {
  const { fieldPlan } = await import('../cli/lib/map.mjs');
  const { flowFromPath } = await import('../cli/lib/author.mjs');
  assert.deepEqual(fieldPlan({ value: 'email@example.com', full_text: 'email@example.com' }), { type: null, record: { kept: true } });
  assert.deepEqual(fieldPlan({ password: true, value: '••••' }, { MAESTRO_PASSWORD: 's3cr3t' }), { type: 's3cr3t', record: { secretVar: 'MAESTRO_PASSWORD' } });
  assert.equal(fieldPlan({ full_text: 'Ad' }).type, 'Test');
  const g = { ...GRAPH, edges: [{ ...GRAPH.edges[0], inputs: [{ x: 1, y: 1, secretVar: 'MAESTRO_PASSWORD' }] }] };
  const { flow } = flowFromPath({ id: 'X', pkg: 'com.x', graph: g, path: g.edges, target: g.nodes.bbb });
  assert.match(flow, /inputText: \$\{MAESTRO_PASSWORD\}/);
  assert.doesNotMatch(flow, /s3cr3t/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TESTFUL_LOG_DIR = mkdtempSync(join(tmpdir(), 'testful-log-'));
const { judge } = await import('../cli/lib/judge.mjs');

function mapFixture(nodes) {
  const dir = mkdtempSync(join(tmpdir(), 'testful-judge-'));
  mkdirSync(join(dir, 'screens'));
  const graph = { package: 'p', nodes: {}, edges: [] };
  nodes.forEach((n, i) => {
    graph.nodes[n.sig] = { order: i + 1, screenshot: `screens/${n.sig}.png`, ...n };
    writeFileSync(join(dir, 'screens', `${n.sig}.png`), Buffer.from(`png-${n.sig}`));
  });
  writeFileSync(join(dir, 'graph.json'), JSON.stringify(graph));
  return dir;
}

/** Messages API taklidi: istekleri kaydeder, sırayla yanıt döndürür. */
function fakeClient(responses) {
  const requests = [];
  return {
    requests,
    beta: { messages: { create: async (req) => {
      requests.push(req);
      const r = responses.shift();
      if (r instanceof Error) throw r;
      return r;
    } } },
  };
}
const ok = (obj) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 1500, output_tokens: 200 } });
const btn = (label, w, h) => ({ kind: 'button', label, class: 'Button', center: { x: 100, y: 100 }, bounds: { x1: 0, y1: 0, x2: w, y2: h } });

test('judge: her ekran bir kez, yapılandırılmış çıktı + varsayılan model ve fallback ile istenir', async () => {
  const dir = mapFixture([{ sig: 'a', interactives: [btn('Profil', 600, 150)] }, { sig: 'b', interactives: [] }]);
  const client = fakeClient([
    ok({ screen_summary: 'Ana ekran', findings: [{ category: 'kesilme', severity: 'orta', confidence: 'muhtemel', title: 'Başlık kesik', detail: '…', location: 'üst' }] }),
    ok({ screen_summary: 'Boş ekran', findings: [] }),
  ]);
  const out = join(dir, 'judge.json');
  const r = await judge({ mapDir: dir, out, client });
  assert.equal(client.requests.length, 2);
  const req = client.requests[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.messages[0].content[0].type, 'image');
  assert.equal(r.screens[0].findings[0].source, 'vision');
  assert.deepEqual(r.usage, { input_tokens: 3000, output_tokens: 400 });
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).judged, 2);
});

test('judge: maliyet sınırı — maxScreens aşılırsa kalanlar atlanır', async () => {
  const dir = mapFixture([{ sig: 'a', interactives: [] }, { sig: 'b', interactives: [] }, { sig: 'c', interactives: [] }]);
  const client = fakeClient([ok({ screen_summary: '', findings: [] })]);
  const r = await judge({ mapDir: dir, client, maxScreens: 1 });
  assert.equal(client.requests.length, 1);
  assert.equal(r.skipped, 2);
});

test('judge: ret ve geçici hata yalnız o ekranı etkiler; kimlik hatası koşuyu durdurur', async () => {
  const dir = mapFixture([{ sig: 'a', interactives: [] }, { sig: 'b', interactives: [] }, { sig: 'c', interactives: [] }]);
  const overloaded = Object.assign(new Error('overloaded'), { status: 529 });
  const client = fakeClient([
    { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [], usage: { input_tokens: 10, output_tokens: 0 } },
    overloaded,
    ok({ screen_summary: 'x', findings: [] }),
  ]);
  const r = await judge({ mapDir: dir, client });
  assert.match(r.screens[0].error, /reddetti/);
  assert.match(r.screens[1].error, /529/);
  assert.equal(r.screens[2].error, null);

  const auth = fakeClient([Object.assign(new Error('invalid x-api-key'), { status: 401 })]);
  await assert.rejects(judge({ mapDir: dir, client: auth }), /kimlik doğrulaması/);
});

test('judge: anahtar yoksa açık hata verir', async () => {
  const dir = mapFixture([{ sig: 'a', interactives: [] }]);
  const old = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try { await assert.rejects(judge({ mapDir: dir }), /ANTHROPIC_API_KEY/); }
  finally { if (old !== undefined) process.env.ANTHROPIC_API_KEY = old; }
});

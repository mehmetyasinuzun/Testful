// Testful rapor üreteci: results.ndjson + senaryo oracle'ları + opsiyonel
// .qa/findings.extra.json → report.json (makine) + report.md (insan, Türkçe).
// Bağımlılık yok (saf Node ESM).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const [runDir, appDir] = process.argv.slice(2);
if (!runDir) { console.error('kullanım: report.mjs <run_dir> [app_dir]'); process.exit(2); }

const runId = basename(runDir);
const ndjson = existsSync(join(runDir, 'results.ndjson'))
  ? readFileSync(join(runDir, 'results.ndjson'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  : [];

// oracle başlık/tier'ı çek
const scenDir = appDir ? join(appDir, '.qa', 'scenarios') : null;
function oracle(id) {
  if (!scenDir) return {};
  const p = join(scenDir, `${id}.yaml`);
  if (!existsSync(p)) return {};
  const t = readFileSync(p, 'utf8');
  const title = (t.match(/^title:\s*(.+)$/m) || [])[1]?.replace(/^["']|["']$/g, '') || id;
  const tier = (t.match(/^tier:\s*(.+)$/m) || [])[1]?.trim() || '';
  return { title, tier };
}
function shots(id) {
  const d = join(runDir, 'screenshots');
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.startsWith(id + '-') && f.endsWith('.png'))
    .map((f) => `screenshots/${f}`);
}

const scenarios = ndjson.map((r) => ({ ...r, ...oracle(r.id), screenshots: shots(r.id) }));
const extra = existsSync(join(runDir, 'findings.extra.json'))
  ? JSON.parse(readFileSync(join(runDir, 'findings.extra.json'), 'utf8'))
  : { findings: [] };

const totals = {
  passed: scenarios.filter((s) => s.result === 'pass').length,
  failed: scenarios.filter((s) => s.result === 'fail').length,
  flaky: scenarios.filter((s) => s.result === 'flaky').length,
};
const shipReady = totals.failed === 0 && (extra.findings || []).every((f) => f.severity !== 'kritik');

const report = { run_id: runId, generated_from: 'testful/run-suite', totals, scenarios, extra_findings: extra.findings || [], ship_ready: shipReady };
writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2));

// --- report.md ---
const L = [];
L.push(`# Testful Raporu — ${runId}`, '');
L.push(`**Özet:** ${totals.passed} geçti · ${totals.failed} kaldı · ${totals.flaky} flaky-şüphesi`);
L.push('');
L.push(`**Piyasaya hazır mı?** ${shipReady ? '✅ Evet — kritik/kesin engel yok' : '❌ Hayır — aşağıdaki engeller var'}`);
L.push('');
L.push('## Senaryolar', '');
L.push('| ID | Başlık | Tier | Sonuç | Güven |');
L.push('|---|---|---|---|---|');
for (const s of scenarios) {
  const mark = s.result === 'pass' ? '✅ geçti' : s.result === 'flaky' ? '🟡 flaky' : '❌ kaldı';
  L.push(`| ${s.id} | ${s.title || ''} | ${s.tier || ''} | ${mark} | ${s.confidence || ''} |`);
}
L.push('');
const fails = scenarios.filter((s) => s.result === 'fail');
if (fails.length) {
  L.push('## Kesin bulgular', '');
  for (const s of fails) {
    L.push(`### ${s.id} — ${s.title || ''}`);
    if (s.screenshots.length) L.push(`- Ekran görüntüleri: ${s.screenshots.join(', ')}`);
    L.push(`- Log: logcat/${s.id}-1.txt`, '');
  }
}
if ((extra.findings || []).length) {
  L.push('## Ek bulgular (kaos / testability / performans)', '');
  for (const f of extra.findings) {
    L.push(`### [${f.severity || 'orta'} · ${f.confidence || ''}] ${f.title}`);
    if (f.detail) L.push(f.detail);
    if (f.status) L.push(`- Durum: **${f.status}**`);
    if (f.evidence) L.push(`- Kanıt: ${f.evidence}`);
    L.push('');
  }
}
const flakies = scenarios.filter((s) => s.result === 'flaky');
if (flakies.length) {
  L.push('## Flaky karantinası (fix loop\'a girmez)', '');
  for (const s of flakies) L.push(`- ${s.id} — ${s.title || ''} (1. koşu başarısız, tekrarda geçti)`);
  L.push('');
}
L.push('## Uygulama haritası', '');
L.push('> Kapsama boyalı ekran-geçiş grafiği Faz 2\'de bu bölümde render edilecek (graph.json).');
L.push('');
writeFileSync(join(runDir, 'report.md'), L.join('\n'));
console.log(`rapor yazıldı: ${join(runDir, 'report.md')}`);

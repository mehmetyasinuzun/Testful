#!/usr/bin/env node
// Testful CI: emülatör çıktısını ($OUT) okur → summary.md + GITHUB_STEP_SUMMARY +
// verdict çıktısı. fail-on politikasına göre çıkış kodu verir.
//
// env: OUT PKG FAIL_ON(scenario|crash|never) MONKEY_EVENTS ARTIFACT_NAME
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.OUT || 'testful-out';
const PKG = process.env.PKG || '';
const FAIL_ON = process.env.FAIL_ON || 'scenario';
const ARTIFACT = process.env.ARTIFACT_NAME || 'testful-report';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

const steps = Object.fromEntries(
  readText(join(OUT, 'steps.env')).split('\n').filter(Boolean).map((l) => l.split('=')),
);
const graph = readJson(join(OUT, 'map', 'graph.json'));
const report = readJson(join(OUT, 'run', 'report.json'));

// --- Çökme imzaları: yalnız hedef pakete ait olanlar (sistem gürültüsü sayılmaz) ---
export function crashHits(text, pkg, source) {
  const lines = text.split('\n');
  const hits = [];
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anr = new RegExp(`ANR in ${esc}\\b`);
  const native = new RegExp(`>>> ${esc} <<<`);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let kind = null;
    if (/FATAL EXCEPTION/.test(l) && lines.slice(i + 1, i + 3).some((n) => n.includes(`Process: ${pkg},`))) kind = 'çökme';
    else if (anr.test(l)) kind = 'ANR';
    else if (native.test(l)) kind = 'native çökme';
    else if (/E\/flutter|E flutter/.test(l)) kind = 'flutter hatası';
    else if (/RenderFlex overflowed/.test(l)) kind = 'taşma (overflow)';
    if (kind) {
      // çökme: aynı AndroidRuntime bloğunun ilk satırları (yığın izinin başı)
      let end = i + 1;
      if (kind === 'çökme') while (end < lines.length && end < i + 8 && /AndroidRuntime/.test(lines[end])) end++;
      const ctx = lines.slice(i, end).map((s) => s.trim()).join('\n');
      hits.push({ kind, source, line: i + 1, text: ctx });
    }
  }
  return hits;
}

const crashes = PKG
  ? [
      ...crashHits(readText(join(OUT, 'logcat.txt')), PKG, 'keşif+senaryo'),
      ...crashHits(readText(join(OUT, 'monkey-logcat.txt')), PKG, 'monkey'),
    ]
  : [];
const hardCrashes = crashes.filter((c) => c.kind === 'çökme' || c.kind === 'ANR' || c.kind === 'native çökme');

// --- a11y: haritadaki etiketsiz etkileşimli öğeler ---
const a11y = [];
if (graph) {
  for (const n of Object.values(graph.nodes)) {
    for (const e of n.interactives || []) {
      if (e.a11y_missing) a11y.push({ screen: n.sig, order: n.order, cls: e.class, at: `${e.center.x},${e.center.y}` });
    }
  }
}

// --- Karar ---
const reasons = [];
if (steps.install !== 'ok') reasons.push('APK emülatöre kurulamadı');
if (steps.install === 'ok' && steps.map !== 'ok') reasons.push('uygulama açılmadı / keşif başarısız');
if (report && report.totals.failed > 0) reasons.push(`${report.totals.failed} senaryo kesin kaldı (3/3)`);
if (steps.run === 'fail' && !report) reasons.push('senaryo koşucusu hata verdi');
const crashReasons = hardCrashes.length ? [`${hardCrashes.length} çökme/ANR imzası`] : [];

const blocking = FAIL_ON === 'never' ? [] : FAIL_ON === 'crash' ? [...reasons, ...crashReasons] : reasons;
const verdict = blocking.length ? 'fail' : 'pass';

// --- Markdown ---
const ok = (b) => (b ? '✅' : '❌');
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : '';
const L = [];
L.push('<!-- testful-report -->');
L.push(`## 🧭 Testful — \`${PKG || 'bilinmeyen paket'}\``, '');
L.push(verdict === 'pass'
  ? `**Sonuç: ✅ Geçti**${crashReasons.length && FAIL_ON !== 'crash' ? ` (uyarı: ${crashReasons[0]})` : ''}`
  : `**Sonuç: ❌ Kaldı** — ${blocking.join(' · ')}`);
L.push('', '| Adım | Durum |', '|---|---|');
L.push(`| Kurulum | ${ok(steps.install === 'ok')} |`);
if (graph) {
  const s = graph.stats;
  L.push(`| Otonom keşif | ✅ ${s.screens} ekran · ${s.edges} geçiş · ${s.actions} dokunuş · kapsama ~%${s.coverage_pct} |`);
} else if (steps.install === 'ok') {
  L.push('| Otonom keşif | ❌ harita çıkmadı |');
}
if (report) {
  const t = report.totals;
  L.push(`| Senaryolar | ${t.failed ? '❌' : t.flaky ? '🟡' : '✅'} ${t.passed} geçti · ${t.failed} kaldı · ${t.flaky} flaky |`);
} else {
  L.push(`| Senaryolar | ${steps.run === 'skipped' ? '⏭️ `.qa/scenarios/` yok' : '❌ rapor üretilmedi'} |`);
}
if (steps.monkey && steps.monkey !== 'skipped') {
  const m = crashes.filter((c) => c.source === 'monkey');
  L.push(`| Kaos (monkey ${process.env.MONKEY_EVENTS || ''} olay) | ${m.length ? `⚠️ ${m.length} imza` : '✅ temiz'} |`);
}
L.push(`| Çökme / ANR | ${hardCrashes.length ? `⚠️ ${hardCrashes.length}` : '✅ yok'} |`);
L.push(`| Erişilebilirlik | ${a11y.length ? `⚠️ ${a11y.length} etiketsiz öğe` : '✅ etiketsiz öğe yok'} |`);
const videoDir = join(OUT, 'video');
const videos = existsSync(videoDir) ? readdirSync(videoDir).filter((f) => f.endsWith('.mp4')).sort() : [];
if (videos.length) {
  const mb = (f) => (statSync(join(videoDir, f)).size / 1048576).toFixed(1);
  L.push(`| Ekran videosu | 🎬 ${videos.map((f) => `${f} (${mb(f)} MB)`).join(' · ')} |`);
}
L.push('');

if (report?.scenarios?.length) {
  L.push('### Senaryolar', '', '| ID | Başlık | Sonuç |', '|---|---|---|');
  for (const s of report.scenarios) {
    const mark = s.result === 'pass' ? '✅' : s.result === 'flaky' ? '🟡 flaky' : '❌';
    L.push(`| ${s.id} | ${s.title || ''} | ${mark} |`);
  }
  L.push('');
}

if (graph && Object.keys(graph.nodes).length) {
  const name = (n) => {
    const lbl = (n.interactives || []).find((e) => e.label)?.label || n.sig;
    return `${n.order}. ${lbl}`.replace(/["[\]{}()<>]/g, '');
  };
  L.push('<details><summary>Ekran haritası</summary>', '', '```mermaid', 'graph LR');
  for (const n of Object.values(graph.nodes)) L.push(`  s${n.sig}["${name(n)}"]`);
  for (const e of graph.edges) L.push(`  s${e.from} -->|"${String(e.via).replace(/["[\]{}()<>|]/g, '').slice(0, 30)}"| s${e.to}`);
  L.push('```', '', '</details>', '');
}

if (crashes.length) {
  L.push('<details><summary>Çökme imzaları (ilk 10)</summary>', '');
  for (const c of crashes.slice(0, 10)) L.push(`**${c.kind}** · ${c.source} · satır ${c.line}`, '```', c.text.slice(0, 800), '```');
  L.push('</details>', '');
}

if (a11y.length) {
  L.push('<details><summary>Etiketsiz öğeler (ekran okuyucu bunları okuyamaz)</summary>', '');
  for (const a of a11y.slice(0, 20)) L.push(`- ekran ${a.order} (\`${a.screen}\`): ${a.cls} @ ${a.at}`);
  L.push('', '</details>', '');
}

L.push(`📦 Ekran görüntüleri, logcat, \`graph.json\` ve \`report.md\`: **${ARTIFACT}** artifact'ında${runUrl ? ` ([koşu sayfası](${runUrl}) → Artifacts)` : ''}.`);
if (videos.length) L.push('', `🎬 Videolar ayrı artifact'ta: **${ARTIFACT}-video** (zip'i aç → mp4'leri telefonda oynat).`);

const md = L.join('\n') + '\n';
writeFileSync(join(OUT, 'summary.md'), md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${verdict}\n`);
console.log(md);
if (verdict === 'fail') {
  console.log(`::error::Testful: ${blocking.join(' · ')}`);
  process.exit(1);
}

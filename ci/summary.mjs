#!/usr/bin/env node
// Testful CI: emülatör çıktısını ($OUT) okur → summary.md + GITHUB_STEP_SUMMARY +
// verdict çıktısı. fail-on politikasına göre çıkış kodu verir.
//
// env: OUT PKG FAIL_ON(scenario|crash|never) MONKEY_EVENTS ARTIFACT_NAME
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { crashHits, HARD_KINDS } from '../cli/lib/crash.mjs';

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
const judged = readJson(join(OUT, 'judge.json'));

// logcat.txt koşunun tamamını (monkey dahil) kesintisiz kapsar → sayım buradan;
// monkey-logcat.txt yalnız kaos satırındaki atıf için.
const crashes = PKG ? crashHits(readText(join(OUT, 'logcat.txt')), PKG, 'koşu') : [];
const monkeyCrashes = PKG ? crashHits(readText(join(OUT, 'monkey-logcat.txt')), PKG, 'monkey') : [];
const hardCrashes = crashes.filter((c) => HARD_KINDS.has(c.kind));

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
  const extra = [s.scrolls ? `${s.scrolls} kaydırma` : '', s.forms_submitted ? `${s.forms_submitted} form` : '', s.risky_skipped ? `${s.risky_skipped} riskli öğe atlandı` : ''].filter(Boolean);
  L.push(`| Otonom keşif | ✅ ${s.screens} ekran · ${s.edges} geçiş · ${s.actions} dokunuş · kapsama ~%${s.coverage_pct}${extra.length ? ` · ${extra.join(' · ')}` : ''} |`);
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
  const m = monkeyCrashes;
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

if (judged) {
  const all = judged.screens.flatMap((sc) => sc.findings.map((f) => ({ ...f, order: sc.order, sig: sc.sig })));
  const rank = { kritik: 0, yüksek: 1, orta: 2, düşük: 3 };
  all.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
  const errors = judged.screens.filter((sc) => sc.error).length;
  L.push(`<details><summary>Görsel değerlendirme — ${all.length} bulgu · ${judged.judged} ekran${judged.skipped ? ` (+${judged.skipped} atlandı)` : ''}${errors ? ` · ${errors} hata` : ''} · ${judged.model}</summary>`, '');
  L.push('> Görsel bulgular en düşük kanıt seviyesidir (logcat > assert > görsel): öneri niteliğindedir, CI\'ı kırmızı yapmaz. Dokunma hedefi bulguları deterministiktir.', '');
  if (all.length) {
    L.push('| Önem | Güven | Ekran | Bulgu | Nerede |', '|---|---|---|---|---|');
    for (const f of all.slice(0, 30)) {
      const cell = (t) => String(t || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      L.push(`| ${f.severity} | ${f.confidence} | ${f.order} | **${cell(f.title)}** — ${cell(f.detail)} | ${cell(f.location)} |`);
    }
  }
  L.push('', `Token: ${judged.usage.input_tokens} girdi + ${judged.usage.output_tokens} çıktı.`, '', '</details>', '');
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

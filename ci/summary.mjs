#!/usr/bin/env node
// Testful CI: emülatör çıktısını ($OUT) okur → summary.md + GITHUB_STEP_SUMMARY +
// verdict çıktısı. fail-on politikasına göre çıkış kodu verir.
//
// Girdiler (emulator-job.sh üretir): steps.env, map/graph.json, run/report.json
// (testful/report@1), smoke/report.json, kesintisiz logcat.txt, judge.json, video/.
// Ortam hatası (çıkış kodu 3) uygulama hatası DEĞİLDİR → "belirsiz", kırmızı yapmaz.
//
// env: OUT PKG FAIL_ON(scenario|crash|never) MONKEY_EVENTS ARTIFACT_NAME
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanLogcat } from '../cli/lib/logcat.mjs';

const OUT = process.env.OUT || 'testful-out';
const PKG = process.env.PKG || '';
const FAIL_ON = process.env.FAIL_ON || 'scenario';
const ARTIFACT = process.env.ARTIFACT_NAME || 'testful-report';
const HARD = new Set(['crash', 'anr', 'oom']);

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

const steps = Object.fromEntries(
  readText(join(OUT, 'steps.env')).split('\n').filter(Boolean).map((l) => l.split('=')),
);
const graph = readJson(join(OUT, 'map', 'graph.json'));
const run = readJson(join(OUT, 'run', 'report.json'));
const smoke = readJson(join(OUT, 'smoke', 'report.json'));
const judged = readJson(join(OUT, 'judge.json'));

// logcat.txt koşunun tamamını kesintisiz kapsar (cihaz tamponu temizlense de) → çökme sayımı buradan
const crashes = PKG ? scanLogcat(readText(join(OUT, 'logcat.txt')), { pkg: PKG }).hits : [];
const hardCrashes = crashes.filter((c) => HARD.has(c.type));

// --- a11y: haritadaki etiketsiz etkileşimli öğeler ---
const a11y = [];
if (graph) {
  for (const n of Object.values(graph.nodes)) {
    for (const e of n.interactives || []) {
      if (e.a11y_missing && e.kind !== 'field') a11y.push({ screen: n.sig, order: n.order, cls: e.class, at: `${e.center.x},${e.center.y}` });
    }
  }
}

// --- Karar ---
const reasons = [];
const warnings = [];
if (steps.install !== 'ok') reasons.push('APK emülatöre kurulamadı');
if (steps.install === 'ok' && !graph) {
  if (steps.map === 'env-error') warnings.push('keşif ortam hatasıyla kesildi (uygulama hatası değil)');
  else reasons.push('uygulama açılmadı / keşif başarısız');
}
if (run) {
  const failed = run.scenarios.filter((s) => s.result === 'fail');
  if (failed.length) reasons.push(`${failed.length} senaryo kaldı (${failed.map((s) => s.id).join(', ')})`);
  if (run.status === 'inconclusive') warnings.push(`senaryolarda ortam hatası: ${run.env_error || `${run.totals.env_error} senaryo`}`);
} else if (steps.run && !['skipped'].includes(steps.run)) {
  (steps.run === 'env-error' ? warnings : reasons).push('senaryo koşucusu rapor üretmedi');
}
if (smoke?.status === 'inconclusive') warnings.push(`smoke: ${smoke.env_error || 'ölçülemeyen faz'}`);
const crashReasons = hardCrashes.length ? [`${hardCrashes.length} çökme/ANR imzası`] : [];

const blocking = FAIL_ON === 'never' ? [] : FAIL_ON === 'crash' ? [...reasons, ...crashReasons] : reasons;
const verdict = blocking.length ? 'fail' : warnings.length ? 'inconclusive' : 'pass';

// --- Markdown ---
const ok = (b) => (b ? '✅' : '❌');
const cell = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : '';
const L = [];
L.push('<!-- testful-report -->');
L.push(`## 🧭 Testful — \`${PKG || 'bilinmeyen paket'}\``, '');
if (verdict === 'fail') L.push(`**Sonuç: ❌ Kaldı** — ${blocking.join(' · ')}`);
else if (verdict === 'inconclusive') L.push(`**Sonuç: ⚠️ Belirsiz** — ${warnings.join(' · ')}`);
else L.push(`**Sonuç: ✅ Geçti**${crashReasons.length && FAIL_ON !== 'crash' ? ` (uyarı: ${crashReasons[0]})` : ''}`);
L.push('', '| Adım | Durum |', '|---|---|');
L.push(`| Kurulum | ${ok(steps.install === 'ok')} |`);
if (graph) {
  const s = graph.stats;
  const extra = [s.scrolls ? `${s.scrolls} kaydırma` : '', s.forms_submitted ? `${s.forms_submitted} form` : '', s.risky_skipped ? `${s.risky_skipped} riskli öğe atlandı` : ''].filter(Boolean);
  L.push(`| Otonom keşif | ✅ ${s.screens} ekran · ${s.edges} geçiş · ${s.actions} dokunuş · kapsama ~%${s.coverage_pct}${extra.length ? ` · ${extra.join(' · ')}` : ''} |`);
} else if (steps.install === 'ok') {
  L.push(`| Otonom keşif | ${steps.map === 'env-error' ? '⚠️ ortam hatası' : '❌ harita çıkmadı'} |`);
}
if (run) {
  const t = run.totals;
  const icon = t.failed ? '❌' : t.env_error ? '⚠️' : t.flaky ? '🟡' : '✅';
  L.push(`| Senaryolar | ${icon} ${t.passed} geçti · ${t.failed} kaldı · ${t.flaky} flaky${t.env_error ? ` · ${t.env_error} ortam-hatası` : ''} |`);
} else {
  L.push(`| Senaryolar | ${steps.run === 'skipped' ? '⏭️ `.qa/scenarios/` yok' : '❌ rapor üretilmedi'} |`);
}
if (smoke) {
  const cold = smoke.metrics?.['soğuk açılış (ms)'];
  const sf = (smoke.findings || []).filter((f) => f.type !== 'a11y');
  L.push(`| Smoke + kaos (monkey ${process.env.MONKEY_EVENTS || ''} olay) | ${sf.length ? `⚠️ ${sf.length} bulgu` : '✅ temiz'}${cold ? ` · soğuk açılış ${cold} ms` : ''} |`);
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

if (run?.scenarios?.length) {
  const mark = { pass: '✅', fail: '❌', flaky: '🟡 flaky', 'env-error': '⚠️ ortam' };
  L.push('### Senaryolar', '', '| ID | Başlık | Sonuç | Neden |', '|---|---|---|---|');
  for (const s of run.scenarios) L.push(`| ${cell(s.id)} | ${cell(s.title)} | ${mark[s.result] || s.result} | ${s.result === 'pass' ? '' : cell(s.reason)} |`);
  L.push('');
}
if (run?.diff && (run.diff.new.length || run.diff.resolved.length)) {
  L.push(`Önceki koşuya göre: 🆕 ${run.diff.new.length} yeni · ✅ ${run.diff.resolved.length} çözülen · ⏳ ${run.diff.persisting.length} devam eden`, '');
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
  L.push('<details><summary>Çökme / hata imzaları</summary>', '');
  for (const c of crashes.slice(0, 10)) L.push(`**[${c.severity}] ${c.title}** ×${c.count} · satır ${c.line}`, '```', c.stack.slice(0, 8).join('\n').slice(0, 1200), '```');
  L.push('</details>', '');
}

const smokeFindings = (smoke?.findings || []);
if (smokeFindings.length) {
  L.push('<details><summary>Smoke bulguları</summary>', '');
  for (const f of smokeFindings) L.push(`- **[${f.severity} · ${f.confidence}]** ${f.title}`);
  L.push('', '</details>', '');
}

if (judged) {
  const all = judged.screens.flatMap((sc) => sc.findings.map((f) => ({ ...f, order: sc.order, sig: sc.sig })));
  const rank = { kritik: 0, yüksek: 1, orta: 2, düşük: 3 };
  all.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
  const errors = judged.screens.filter((sc) => sc.error).length;
  L.push(`<details><summary>Görsel değerlendirme — ${all.length} bulgu · ${judged.judged} ekran${judged.skipped ? ` (+${judged.skipped} atlandı)` : ''}${errors ? ` · ${errors} hata` : ''} · ${judged.model}</summary>`, '');
  L.push('> Görsel bulgular en düşük kanıt seviyesidir (logcat > assert > görsel): öneri niteliğindedir, CI\'ı kırmızı yapmaz.', '');
  if (all.length) {
    L.push('| Önem | Güven | Ekran | Bulgu | Nerede |', '|---|---|---|---|---|');
    for (const f of all.slice(0, 30)) L.push(`| ${f.severity} | ${f.confidence} | ${f.order} | **${cell(f.title)}** — ${cell(f.detail)} | ${cell(f.location)} |`);
  }
  L.push('', `Token: ${judged.usage.input_tokens} girdi + ${judged.usage.output_tokens} çıktı.`, '', '</details>', '');
}

if (a11y.length) {
  L.push('<details><summary>Etiketsiz öğeler (ekran okuyucu bunları okuyamaz)</summary>', '');
  for (const a of a11y.slice(0, 20)) L.push(`- ekran ${a.order} (\`${a.screen}\`): ${a.cls} @ ${a.at}`);
  L.push('', '</details>', '');
}

L.push(`📦 Ekran görüntüleri, logcat, \`graph.json\`, \`map.md\` ve raporlar: **${ARTIFACT}** artifact'ında${runUrl ? ` ([koşu sayfası](${runUrl}) → Artifacts)` : ''}.`);
if (videos.length) L.push('', `🎬 Videolar ayrı artifact'ta: **${ARTIFACT}-video** (zip'i aç → mp4'leri telefonda oynat).`);

const md = L.join('\n') + '\n';
writeFileSync(join(OUT, 'summary.md'), md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${verdict}\n`);
console.log(md);
if (verdict === 'inconclusive') console.log(`::warning::Testful: ${warnings.join(' · ')}`);
if (verdict === 'fail') {
  console.log(`::error::Testful: ${blocking.join(' · ')}`);
  process.exit(1);
}

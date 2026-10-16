#!/usr/bin/env node
// Testful CI: Firebase Test Lab sonuçlarını iş özetine yazar ve karar verir.
// gcloud çıkış kodları (resmi): 0 geçti · 1 genel hata · 2 hatalı argüman · 10 en az bir
// test kaldı · 15 belirsiz · 18 cihaz/sürüm desteklenmiyor · 19 iptal · 20 altyapı hatası.
//
// env: OUT FAIL_ON(failure|never) ARTIFACT_NAME
import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXIT = {
  0: { verdict: 'pass', text: 'tüm cihazlarda geçti' },
  1: { verdict: 'error', text: 'genel hata (ağ/kimlik/argüman) — gcloud.log\'a bak' },
  2: { verdict: 'error', text: 'geçersiz komut/argüman' },
  10: { verdict: 'fail', text: 'en az bir cihazda kaldı' },
  15: { verdict: 'infra', text: 'sonuç belirlenemedi (Test Lab iç hatası)' },
  18: { verdict: 'error', text: 'cihaz/sürüm bu test için desteklenmiyor — devices girdisini değiştir' },
  19: { verdict: 'infra', text: 'test matrisi iptal edildi' },
  20: { verdict: 'infra', text: 'Test Lab altyapı hatası' },
};

export function decide(code, failOn = 'failure') {
  const e = EXIT[code] || { verdict: 'error', text: `bilinmeyen çıkış kodu ${code}` };
  // Altyapı hataları uygulamanın suçu değildir → uyarı, kırmızı değil (güven-öncelikli).
  const red = failOn !== 'never' && (e.verdict === 'fail' || e.verdict === 'error');
  return { ...e, red };
}

export function render({ code, outcomes, consoleUrl, gcsPath, artifact, failOn }) {
  const d = decide(code, failOn);
  const icon = { pass: '✅', fail: '❌', infra: '⚠️', error: '❌' }[d.verdict];
  const L = ['## 🔥 Firebase Test Lab — Robo', '', `**Sonuç: ${icon} ${d.text}** (gcloud çıkış kodu ${code})`, ''];
  if (outcomes.length) {
    const mark = (o) => ({ Passed: '✅', Failed: '❌', Flaky: '🟡', Inconclusive: '⚠️', Skipped: '⏭️' }[o] || '❔');
    L.push('| Cihaz | Sonuç | Ayrıntı |', '|---|---|---|');
    for (const o of outcomes) L.push(`| ${o.axis_value || '?'} | ${mark(o.outcome)} ${o.outcome || ''} | ${String(o.test_details || '').replace(/\|/g, '\\|')} |`);
    L.push('');
  }
  if (consoleUrl) L.push(`🔗 [Firebase konsolunda aç](${consoleUrl}) (video, ekran görüntüleri, Robo gezinme grafiği)`);
  if (gcsPath) L.push(`📦 Ham sonuçlar: \`${gcsPath}\` · indirilenler **${artifact}** artifact'ında`);
  L.push('', '> ⚠️ Firebase Test Lab 30 Eylül 2027\'de kapanacak (Google\'ın halefi: Developer Device Platform). Testful\'un emülatör testleri bundan etkilenmez.');
  return { md: L.join('\n') + '\n', ...d };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const OUT = process.env.OUT || 'firebase-out';
  const code = Number(existsSync(join(OUT, 'exit-code')) ? readFileSync(join(OUT, 'exit-code'), 'utf8').trim() : 1);
  let outcomes = [];
  try { outcomes = JSON.parse(readFileSync(join(OUT, 'outcomes.json'), 'utf8')); } catch {}
  const log = existsSync(join(OUT, 'gcloud.log')) ? readFileSync(join(OUT, 'gcloud.log'), 'utf8') : '';
  const consoleUrl = (log.match(/https:\/\/console\.firebase\.google\.com\/[^\]\s]+/) || [])[0] || null;
  const gcsPath = existsSync(join(OUT, 'gcs-path')) ? readFileSync(join(OUT, 'gcs-path'), 'utf8').trim() : null;
  const r = render({ code, outcomes: Array.isArray(outcomes) ? outcomes : [], consoleUrl, gcsPath, artifact: process.env.ARTIFACT_NAME || 'testful-firebase', failOn: process.env.FAIL_ON });
  writeFileSync(join(OUT, 'summary.md'), r.md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, r.md);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${r.verdict}\n`);
  console.log(r.md);
  if (r.verdict === 'infra') console.log(`::warning::Firebase Test Lab: ${r.text}`);
  if (r.red) { console.log(`::error::Firebase Test Lab: ${r.text}`); process.exit(1); }
}

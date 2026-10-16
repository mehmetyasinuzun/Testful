#!/usr/bin/env node
// Testful CI: summary.md'yi PR'a tek, güncellenen ("yapışkan") yorum olarak yazar.
// PR olayı değilse ya da izin yoksa sessizce geçer — koşuyu asla kırmaz.
//
// env: OUT GITHUB_TOKEN GITHUB_EVENT_NAME GITHUB_EVENT_PATH GITHUB_REPOSITORY GITHUB_API_URL
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = '<!-- testful-report -->';
const { OUT = 'testful-out', GITHUB_TOKEN, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY } = process.env;
const API = process.env.GITHUB_API_URL || 'https://api.github.com';

async function main() {
  if (!/^pull_request/.test(GITHUB_EVENT_NAME || '')) return console.log('PR olayı değil — yorum atlanıyor');
  const summary = join(OUT, 'summary.md');
  if (!GITHUB_TOKEN || !existsSync(summary)) return console.log('token ya da summary.md yok — yorum atlanıyor');
  const pr = JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8')).pull_request?.number;
  if (!pr) return;

  const body = readFileSync(summary, 'utf8');
  const h = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  const base = `${API}/repos/${GITHUB_REPOSITORY}/issues`;

  let existing = null;
  for (let page = 1; page <= 10 && !existing; page++) {
    const r = await fetch(`${base}/${pr}/comments?per_page=100&page=${page}`, { headers: h });
    if (!r.ok) throw new Error(`yorumlar okunamadı: ${r.status}`);
    const list = await r.json();
    existing = list.find((c) => c.body?.includes(MARKER));
    if (list.length < 100) break;
  }
  const r = existing
    ? await fetch(`${base}/comments/${existing.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ body }) })
    : await fetch(`${base}/${pr}/comments`, { method: 'POST', headers: h, body: JSON.stringify({ body }) });
  if (!r.ok) throw new Error(`yorum yazılamadı: ${r.status} (workflow'a 'pull-requests: write' izni ver)`);
  console.log(existing ? 'PR yorumu güncellendi' : 'PR yorumu eklendi');
}

main().catch((e) => console.log(`::warning::Testful PR yorumu: ${e.message}`));

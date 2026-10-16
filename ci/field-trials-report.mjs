#!/usr/bin/env node
// Saha denemeleri raporu: gerçek açık kaynak uygulamalarda N tekrar koşusunun
// sonuçlarını toplar → kararlılık (flakiness) kanıtı.
//
// Girdi: <dir>/<artifact>/ altında her koşunun çıktısı (map/graph.json, logcat.txt,
// steps.env, trial.json {app, version, run}).
// Çıktı: field-trials.json + iş özeti (markdown).
import { readdirSync, readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanLogcat } from '../cli/lib/logcat.mjs';

const HARD = new Set(['crash', 'anr', 'oom']);

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : 0; };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function collect(dir) {
  const runs = [];
  for (const name of readdirSync(dir)) {
    const d = join(dir, name);
    const meta = readJson(join(d, 'trial.json'));
    if (!meta) continue;
    const graph = readJson(join(d, 'map', 'graph.json'));
    const steps = Object.fromEntries((existsSync(join(d, 'steps.env')) ? readFileSync(join(d, 'steps.env'), 'utf8') : '')
      .split('\n').filter(Boolean).map((l) => l.split('=')));
    const log = existsSync(join(d, 'logcat.txt')) ? readFileSync(join(d, 'logcat.txt'), 'utf8') : '';
    const hits = meta.package ? scanLogcat(log, { pkg: meta.package }).hits : [];
    const sigs = graph ? Object.keys(graph.nodes) : [];
    runs.push({
      ...meta,
      ok: steps.install === 'ok' && steps.map === 'ok',
      screens: graph?.stats.screens ?? 0,
      coverage: graph?.stats.coverage_pct ?? 0,
      actions: graph?.stats.actions ?? 0,
      unlabeled: graph ? Object.values(graph.nodes).flatMap((n) => n.interactives).filter((e) => e.a11y_missing).length : 0,
      crashes: hits.filter((h) => HARD.has(h.type)).length,
      sigs,
    });
  }
  return runs;
}

/** Uygulama başına: ortalama ± sapma, ekran kümesinin tekrarlar arası örtüşmesi (Jaccard). */
export function aggregate(runs) {
  const byApp = {};
  for (const r of runs) (byApp[r.app] ||= []).push(r);
  return Object.entries(byApp).map(([app, rs]) => {
    rs.sort((a, b) => a.run - b.run);
    const sets = rs.map((r) => new Set(r.sigs));
    let jac = [];
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
      const inter = [...sets[i]].filter((x) => sets[j].has(x)).length;
      const uni = new Set([...sets[i], ...sets[j]]).size;
      jac.push(uni ? inter / uni : 1);
    }
    const screens = rs.map((r) => r.screens), coverage = rs.map((r) => r.coverage);
    return {
      app, version: rs[0].version, package: rs[0].package, runs: rs.length,
      ok_runs: rs.filter((r) => r.ok).length,
      screens: { mean: +mean(screens).toFixed(1), stdev: +stdev(screens).toFixed(1), min: Math.min(...screens), max: Math.max(...screens) },
      coverage: { mean: +mean(coverage).toFixed(1), stdev: +stdev(coverage).toFixed(1) },
      screen_overlap: jac.length ? +mean(jac).toFixed(2) : 1,
      crash_runs: rs.filter((r) => r.crashes > 0).length,
      unlabeled_mean: +mean(rs.map((r) => r.unlabeled)).toFixed(1),
    };
  });
}

export function render(rows, total) {
  const L = ['## 🧪 Testful saha denemeleri', '',
    `${total} koşu · ${rows.length} gerçek uygulama (F-Droid). Aynı uygulamanın tekrarları arasındaki fark = ortam/araç kararsızlığı.`, '',
    '| Uygulama | Sürüm | Başarılı koşu | Ekran (ort ± sapma) | Kapsama % | Ekran kümesi örtüşmesi | Çökme olan koşu | Etiketsiz öğe |',
    '|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    L.push(`| ${r.app} | ${r.version} | ${r.ok_runs}/${r.runs} | ${r.screens.mean} ± ${r.screens.stdev} (${r.screens.min}–${r.screens.max}) | ${r.coverage.mean} ± ${r.coverage.stdev} | ${r.screen_overlap} | ${r.crash_runs} | ${r.unlabeled_mean} |`);
  }
  L.push('', '> **Ekran kümesi örtüşmesi** (Jaccard, 0–1): tekrarlarda aynı ekranların bulunma oranı. 1 = tamamen tekrarlanabilir keşif.');
  return L.join('\n') + '\n';
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dir = process.argv[2] || 'trials';
  const runs = collect(dir);
  const rows = aggregate(runs);
  const md = render(rows, runs.length);
  writeFileSync('field-trials.json', JSON.stringify({ generated_at: new Date().toISOString(), apps: rows, runs: runs.map(({ sigs, ...r }) => r) }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
}

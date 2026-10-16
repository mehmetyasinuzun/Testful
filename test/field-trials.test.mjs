import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, aggregate, render } from '../ci/field-trials-report.mjs';

function trial(root, name, { app, run, sigs, coverage, crash = false, ok = true }) {
  const d = join(root, name);
  mkdirSync(join(d, 'map'), { recursive: true });
  writeFileSync(join(d, 'trial.json'), JSON.stringify({ app, package: `org.${app}`, version: '7', run }));
  const nodes = Object.fromEntries(sigs.map((s) => [s, { interactives: [{ kind: 'button', label: s }, { kind: 'button', a11y_missing: true }] }]));
  writeFileSync(join(d, 'map', 'graph.json'), JSON.stringify({ nodes, stats: { screens: sigs.length, coverage_pct: coverage, actions: 10 } }));
  writeFileSync(join(d, 'steps.env'), `install=ok\nmap=${ok ? 'ok' : 'fail'}\n`);
  writeFileSync(join(d, 'logcat.txt'), crash ? `E AndroidRuntime: FATAL EXCEPTION: main\nE AndroidRuntime: Process: org.${app}, PID: 1\n` : 'I x: y\n');
}

test('saha denemeleri: tekrarlar arası sapma, ekran örtüşmesi ve çökme sayımı', () => {
  const root = mkdtempSync(join(tmpdir(), 'trials-'));
  trial(root, 'trial-notes-1', { app: 'notes', run: 1, sigs: ['a', 'b', 'c', 'd'], coverage: 60 });
  trial(root, 'trial-notes-2', { app: 'notes', run: 2, sigs: ['a', 'b', 'c', 'd'], coverage: 70, crash: true });
  trial(root, 'trial-notes-3', { app: 'notes', run: 3, sigs: ['a', 'b', 'c', 'e'], coverage: 80 });
  trial(root, 'trial-cards-1', { app: 'cards', run: 1, sigs: ['x'], coverage: 10, ok: false });
  mkdirSync(join(root, 'trial-notes-1-apk')); // APK artifact'ı: trial.json yok → atlanmalı

  const rows = aggregate(collect(root));
  const notes = rows.find((r) => r.app === 'notes');
  assert.equal(notes.runs, 3);
  assert.equal(notes.ok_runs, 3);
  assert.deepEqual(notes.screens, { mean: 4, stdev: 0, min: 4, max: 4 });
  assert.equal(notes.coverage.mean, 70);
  assert.equal(notes.crash_runs, 1);
  assert.equal(notes.unlabeled_mean, 4);
  // {a,b,c,d}∩{a,b,c,e}=3, ∪=5 → 0.6 ; iki çift 0.6, bir çift 1 → ort 0.73
  assert.equal(notes.screen_overlap, 0.73);
  assert.equal(rows.find((r) => r.app === 'cards').ok_runs, 0);
  assert.match(render(rows, 4), /\| notes \| 7 \| 3\/3 \| 4 ± 0/);
});

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { readJson } from './util.mjs';

const SEV_ORDER = { kritik: 0, 'yüksek': 1, orta: 2, 'düşük': 3 };
const bySeverity = (a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9);

export function scenarioFindings(scenarios) {
  return scenarios.filter((s) => s.result === 'fail').map((s) => ({
    type: s.crash ? s.crash.type : 'scenario-fail',
    severity: s.crash ? s.crash.severity : 'yüksek',
    confidence: s.confidence,
    title: s.crash ? `${s.id}: ${s.crash.title}` : `${s.id} başarısız — ${s.title || ''}`.trim(),
    detail: s.reason || null,
    source: `scenario:${s.id}`,
    evidence: [...(s.logs || []), ...(s.screenshots || [])],
    key: `scenario:${s.id}`,
  }));
}

function previousReport(runDir, kind) {
  const root = dirname(runDir);
  if (!existsSync(root)) return null;
  const me = basename(runDir);
  const prev = readdirSync(root).filter((d) => d < me).sort().reverse();
  for (const d of prev) {
    const r = readJson(join(root, d, 'report.json'));
    if (r && r.kind === kind) return r;
  }
  return null;
}

function computeDiff(findings, prev) {
  if (!prev) return null;
  const cur = new Map(findings.map((f) => [f.key, f]));
  const old = new Map((prev.findings || []).map((f) => [f.key, f]));
  return {
    previous_run: prev.run_id,
    new: [...cur.keys()].filter((k) => !old.has(k)).map((k) => cur.get(k).title),
    resolved: [...old.keys()].filter((k) => !cur.has(k)).map((k) => old.get(k).title),
    persisting: [...cur.keys()].filter((k) => old.has(k)).map((k) => cur.get(k).title),
  };
}

function nextActions(report) {
  const acts = [];
  if (report.status === 'inconclusive') acts.push('Ortam hatası var: "testful doctor" çalıştır, cihazı/emülatörü kontrol et ve koşuyu tekrarla. Bu durum uygulama hatası DEĞİLDİR.');
  for (const f of report.findings.filter((x) => x.confidence === 'kesin' && (x.severity === 'kritik' || x.severity === 'yüksek')).slice(0, 5)) {
    acts.push(`Düzelt: ${f.title}${f.evidence?.length ? ` (kanıt: ${[].concat(f.evidence)[0]})` : ''}`);
  }
  if (report.totals.flaky) acts.push(`${report.totals.flaky} flaky senaryo karantinada — düzeltme döngüsüne alma; seçicileri "testful observe" ile doğrula.`);
  if (report.status === 'ready' && !acts.length) acts.push('Engel yok. Yeni ekran/akış eklediysen "testful map" + "testful author --from-map" ile kapsamı genişlet.');
  return acts;
}

export function refinalize(runDir) {
  const data = readJson(join(runDir, 'run.json'));
  if (!data) return null;
  return finalizeReport(runDir, data);
}

export function compact(report, runDir) {
  return {
    status: report.status,
    ship_ready: report.ship_ready,
    kind: report.kind,
    run_dir: runDir,
    report_md: join(runDir, 'report.md'),
    totals: report.totals,
    findings: report.findings.map((f) => ({
      id: f.id, severity: f.severity, confidence: f.confidence, title: f.title,
      blocking: report.blocking.includes(f.id),
      detail: f.detail ? String(f.detail).slice(0, 400) : undefined,
      evidence: [].concat(f.evidence || []).slice(0, 4).map((e) => join(runDir, e)),
    })),
    failed_scenarios: report.scenarios.filter((s) => s.result !== 'pass').map((s) => ({ id: s.id, result: s.result, reason: s.reason, flow: s.flow })),
    diff: report.diff,
    next_actions: report.next_actions,
  };
}

export function finalizeReport(runDir, data) {
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(data, null, 2));
  const extra = readJson(join(runDir, 'findings.extra.json'), { findings: [] });
  const extraFindings = (extra.findings || []).map((f, i) => ({
    type: f.type || 'vision',
    severity: f.severity || 'orta',
    confidence: f.confidence || 'muhtemel',
    title: f.title || `ek bulgu ${i + 1}`,
    detail: f.detail || null,
    source: f.source || 'ai',
    evidence: f.evidence || [],
    status: f.status,
    key: f.key || `extra:${f.title}`,
  }));
  const scenarios = data.scenarios || [];
  const findings = [...scenarioFindings(scenarios), ...(data.findings || []), ...extraFindings]
    .sort(bySeverity)
    .map((f, i) => ({ id: `F-${String(i + 1).padStart(2, '0')}`, ...f }));

  const totals = {
    scenarios: scenarios.length,
    passed: scenarios.filter((s) => s.result === 'pass').length,
    failed: scenarios.filter((s) => s.result === 'fail').length,
    flaky: scenarios.filter((s) => s.result === 'flaky').length,
    env_error: scenarios.filter((s) => s.result === 'env-error').length,
    findings: findings.length,
  };
  const blocking = findings.filter((f) => f.status !== 'fixed' && f.confidence !== 'flaky-şüphesi'
    && (f.severity === 'kritik' || (f.severity === 'yüksek' && f.confidence === 'kesin')));
  const status = (totals.env_error || data.env_error) ? 'inconclusive' : blocking.length ? 'not-ready' : 'ready';

  const report = {
    schema: 'testful/report@1',
    run_id: basename(runDir),
    kind: data.kind,
    generated_at: new Date().toISOString(),
    app: data.app || {},
    device: data.device || {},
    status,
    ship_ready: status === 'ready',
    totals,
    blocking: blocking.map((f) => f.id),
    scenarios,
    findings,
    metrics: data.metrics || {},
    env_error: data.env_error || null,
  };
  report.diff = computeDiff(findings, previousReport(runDir, data.kind));
  report.next_actions = nextActions(report);

  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(runDir, 'report.md'), renderMarkdown(report));
  return report;
}

const STATUS_TEXT = {
  ready: '✅ HAZIR — engelleyici bulgu yok',
  'not-ready': '❌ HAZIR DEĞİL — engelleyici bulgular var',
  inconclusive: '⚠️ BELİRSİZ — ortam hatası nedeniyle karar verilemedi',
};
const RESULT_MARK = { pass: '✅ geçti', fail: '❌ kaldı', flaky: '🟡 flaky', 'env-error': '⚠️ ortam' };
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderMarkdown(r) {
  const L = [];
  L.push(`# Testful Raporu — ${r.run_id} (${r.kind})`, '');
  L.push(`**Karar:** ${STATUS_TEXT[r.status]}`, '');
  if (r.app.package) L.push(`- Uygulama: \`${r.app.package}\`${r.app.framework && r.app.framework !== 'unknown' ? ` (${r.app.framework})` : ''}`);
  if (r.device.model) L.push(`- Cihaz: ${r.device.model} · Android ${r.device.android} · ${r.device.serial}`);
  const t = r.totals;
  if (t.scenarios) L.push(`- Senaryolar: ${t.passed} geçti · ${t.failed} kaldı · ${t.flaky} flaky · ${t.env_error} ortam-hatası`);
  L.push(`- Bulgular: ${t.findings} (engelleyici: ${r.blocking.length})`);
  for (const [k, v] of Object.entries(r.metrics || {})) if (v !== null && v !== undefined) L.push(`- ${k}: ${v}`);
  if (r.env_error) L.push('', `> ⚠️ Ortam hatası: ${r.env_error}`);
  L.push('');

  if (r.next_actions?.length) {
    L.push('## Sıradaki adımlar', '');
    for (const a of r.next_actions) L.push(`- ${a}`);
    L.push('');
  }

  if (r.findings.length) {
    L.push('## Bulgular', '');
    for (const f of r.findings) {
      L.push(`### ${f.id} · [${f.severity} · ${f.confidence}] ${f.title}`);
      L.push(`- Tür: ${f.type} · Kaynak: ${f.source || '-'}${f.count > 1 ? ` · ${f.count} kez` : ''}${f.status ? ` · Durum: **${f.status}**` : ''}`);
      const ev = [].concat(f.evidence || []).filter(Boolean);
      if (ev.length) L.push(`- Kanıt: ${ev.join(', ')}`);
      if (f.detail) L.push('', '```', String(f.detail).slice(0, 1500), '```');
      L.push('');
    }
  }

  if (r.scenarios.length) {
    L.push('## Senaryolar', '');
    L.push('| ID | Başlık | Durum | Sonuç | Güven | Deneme | Neden |');
    L.push('|---|---|---|---|---|---|---|');
    for (const s of r.scenarios) {
      L.push(`| ${cell(s.id)} | ${cell(s.title)} | ${cell(s.state || 'normal')} | ${RESULT_MARK[s.result] || s.result} | ${cell(s.confidence)} | ${s.attempts} | ${cell(s.result === 'pass' ? '' : s.reason)} |`);
    }
    L.push('');
    const flaky = r.scenarios.filter((s) => s.result === 'flaky');
    if (flaky.length) {
      L.push('### Flaky karantinası (düzeltme döngüsüne girmez)', '');
      for (const s of flaky) L.push(`- ${s.id} — ${s.title || ''} (${s.passes}/${s.attempts} geçti)`);
      L.push('');
    }
  }

  if (r.diff) {
    L.push(`## Önceki koşuya göre (${r.diff.previous_run})`, '');
    L.push(`- 🆕 Yeni: ${r.diff.new.length ? r.diff.new.join(' · ') : '—'}`);
    L.push(`- ✅ Çözülen: ${r.diff.resolved.length ? r.diff.resolved.join(' · ') : '—'}`);
    L.push(`- ⏳ Devam eden: ${r.diff.persisting.length ? r.diff.persisting.join(' · ') : '—'}`);
    L.push('');
  }
  return L.join('\n');
}

export function summaryLine(r) {
  const t = r.totals;
  const sc = t.scenarios ? ` · senaryo ${t.passed}/${t.scenarios} geçti${t.flaky ? `, ${t.flaky} flaky` : ''}${t.env_error ? `, ${t.env_error} ortam-hatası` : ''}` : '';
  return `${STATUS_TEXT[r.status]}${sc} · ${t.findings} bulgu (${r.blocking.length} engelleyici)`;
}

import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import {
  requireDevice, deviceInfo, stabilize, resetApp, launch, clearLogcat, dumpLogcat, reverse,
  isInstalled, installApk, listDevices,
} from './device.mjs';
import { qlog, configureLog } from './log.mjs';
import { preflightDisk } from './doctor.mjs';
import { applyMatrixState, validateMatrix } from './matrix.mjs';
import { loadConfig, loadSecrets, detectFramework } from './config.mjs';
import { resolveMaestro, runFlow } from './maestro.mjs';
import { scanLogcat } from './logcat.mjs';
import { finalizeReport, summaryLine } from './report.mjs';
import { globToRegex, newRunId, sleep } from './util.mjs';
import { UsageError, EnvError } from './errors.mjs';

export function readOracle(scenariosDir, id) {
  const p = join(scenariosDir, `${id}.yaml`);
  if (!existsSync(p)) return { title: id, tier: '' };
  const t = readFileSync(p, 'utf8');
  const field = (k) => (t.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
  return { title: field('title') || id, tier: field('tier') || '' };
}

export function listFlows(scenariosDir, glob = '*') {
  if (!existsSync(scenariosDir)) throw new UsageError(`senaryo klasörü yok: ${scenariosDir} — önce "testful init" ve "testful author" çalıştır`);
  const re = globToRegex(glob);
  return readdirSync(scenariosDir)
    .filter((f) => f.endsWith('.flow.yaml') && !f.startsWith('_'))
    .map((f) => basename(f, '.flow.yaml'))
    .filter((id) => re.test(id))
    .sort();
}

const flowAppId = (path) => (readFileSync(path, 'utf8').match(/^appId:\s*["']?([\w.]+)["']?\s*$/m) || [])[1] || null;

function deviceAlive(serial) {
  try { return listDevices().some((d) => d.serial === serial && d.state === 'device'); } catch { return false; }
}

const pngsIn = (dir, prefix = '') => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png') && f.startsWith(prefix)) : []);

export async function runSuite({ appDir = '.', glob = '*', matrix = [], apk = null, json = false }) {
  const cfg = loadConfig(appDir);
  configureLog({ appDir: cfg.appDir, stderr: json });
  validateMatrix(matrix);
  const scenariosDir = join(cfg.appDir, '.qa', 'scenarios');
  const ids = listFlows(scenariosDir, glob);
  if (!ids.length) throw new UsageError(`"${glob}" ile eşleşen senaryo yok (${scenariosDir})`);

  preflightDisk();
  const serial = requireDevice();
  resolveMaestro();
  const pkg = cfg.package || flowAppId(join(scenariosDir, `${ids[0]}.flow.yaml`));
  const apkPath = apk || cfg.apk;
  if (apkPath && (apk || (pkg && !isInstalled(pkg)))) {
    qlog(`[KURULUM] ${apkPath}`);
    installApk(apkPath);
  }
  if (pkg && !isInstalled(pkg)) throw new EnvError(`${pkg} cihazda kurulu değil — --apk <yol> ver ya da .qa/testful.json içine "apk" ekle`);

  const runId = newRunId();
  const runDir = join(cfg.appDir, '.qa', 'results', runId);
  for (const d of ['logs', 'logcat', 'debug', 'screenshots']) mkdirSync(join(runDir, d), { recursive: true });
  const rel = (p) => relative(runDir, p).replace(/\\/g, '/');
  const secrets = loadSecrets(cfg.appDir);
  const prelaunch = cfg.prelaunch || process.env.TESTFUL_PRELAUNCH === '1';
  const isolate = cfg.isolate !== false;
  const attemptsMax = 1 + Math.max(0, Number(cfg.retries));

  const unstabilize = stabilize();
  qlog(`[KOŞU] ${runId} · ${ids.length} senaryo × ${1 + matrix.length} durum · cihaz ${serial}`);

  const scenarios = [];
  let envAbort = null;

  const attempt = async (id, state, n) => {
    const flowPath = join(scenariosDir, `${id}.flow.yaml`);
    const appId = flowAppId(flowPath) || pkg;
    const tag = `${id}${state ? `@${state}` : ''}-${n}`;
    if (isolate && appId) resetApp(appId);
    reverse(cfg.reverse);
    clearLogcat();
    if (prelaunch && appId) { launch(appId); await sleep(8000); }
    const shotsDir = join(runDir, 'screenshots', state || 'normal');
    mkdirSync(shotsDir, { recursive: true });
    const debugDir = join(runDir, 'debug', tag);
    const logPath = join(runDir, 'logs', `${tag}.txt`);
    const res = await runFlow({ flowPath, cwd: shotsDir, debugDir, logPath, serial, env: secrets, timeoutSec: cfg.flowTimeoutSec });
    const logcat = dumpLogcat();
    const scan = scanLogcat(logcat, { pkg: appId });
    const crash = scan.hits.find((h) => ['crash', 'anr', 'oom'].includes(h.type)) || null;
    const evidence = [rel(logPath), ...pngsIn(debugDir).map((f) => rel(join(debugDir, f)))];
    if (!res.ok || !scan.clean) {
      const lc = join(runDir, 'logcat', `${tag}.txt`);
      writeFileSync(lc, logcat || '[testful] logcat okunamadı');
      evidence.push(rel(lc));
    }
    return { ...res, ok: res.ok && !crash, crash, appHits: scan.hits, evidence };
  };

  const runOne = async (id, state) => {
    const oracle = readOracle(scenariosDir, id);
    const fullId = state ? `${id}@${state}` : id;
    const results = [];
    let envFails = 0;
    let crashConfirmed = false;
    for (let n = 1; results.length < attemptsMax && n <= attemptsMax + 2; n++) {
      if (!deviceAlive(serial)) { envAbort = `cihaz bağlantısı koptu (${serial})`; break; }
      const r = await attempt(id, state, n);
      if (r.envError && !r.crash) {
        envFails++;
        qlog(`  [ORTAM] ${fullId} deneme ${n}: ${r.reason || 'sürücü hatası'} — tekrar`);
        if (envFails >= 2) break;
        await sleep(3000);
        continue;
      }
      results.push(r);
      if (r.ok && results.length === 1) break;
      const sameCrash = results.filter((x) => x.crash).map((x) => x.crash.key);
      if (sameCrash.length >= 2 && sameCrash[sameCrash.length - 1] === sameCrash[sameCrash.length - 2]) { crashConfirmed = true; break; }
    }
    const passes = results.filter((r) => r.ok).length;
    const lastFail = [...results].reverse().find((r) => !r.ok);
    let result, confidence;
    if (!results.length) { result = 'env-error'; confidence = null; }
    else if (passes === results.length) { result = 'pass'; confidence = 'kesin'; }
    else if (passes === 0) { result = 'fail'; confidence = results.length >= attemptsMax || crashConfirmed ? 'kesin' : 'muhtemel'; }
    else { result = 'flaky'; confidence = 'flaky-şüphesi'; }
    const shots = pngsIn(join(runDir, 'screenshots', state || 'normal'), id).map((f) => `screenshots/${state || 'normal'}/${f}`);
    const sc = {
      id: fullId,
      flow: `${id}.flow.yaml`,
      title: oracle.title,
      tier: oracle.tier,
      state: state || 'normal',
      result,
      confidence,
      attempts: results.length,
      passes,
      reason: result === 'env-error' ? (envAbort || 'Maestro sürücüsü/cihaz hatası') : lastFail ? (lastFail.crash ? `${lastFail.crash.title}: ${lastFail.crash.stack[1] || lastFail.crash.text}` : lastFail.reason) : null,
      crash: lastFail?.crash ? { type: lastFail.crash.type, severity: lastFail.crash.severity, title: lastFail.crash.title, stack: lastFail.crash.stack } : undefined,
      duration_ms: results.reduce((a, r) => a + r.durationMs, 0),
      logs: lastFail ? lastFail.evidence : results[0]?.evidence.slice(0, 1) || [],
      screenshots: shots,
    };
    const icon = { pass: '✓', fail: '✗', flaky: '~', 'env-error': '!' }[result];
    qlog(`  ${icon} ${fullId} — ${result}${sc.reason && result !== 'pass' ? ` (${sc.reason})` : ''}`);
    scenarios.push(sc);
  };

  try {
    for (const state of ['', ...matrix]) {
      if (envAbort) break;
      const restore = state ? applyMatrixState(state) : null;
      try {
        for (const id of ids) {
          if (envAbort) break;
          await runOne(id, state);
        }
      } finally {
        if (restore) restore();
      }
    }
  } finally {
    unstabilize();
  }

  const report = finalizeReport(runDir, {
    kind: 'run',
    app: { package: pkg, framework: detectFramework(cfg.appDir) },
    device: deviceAlive(serial) ? deviceInfo() : { serial },
    scenarios,
    env_error: envAbort,
  });
  qlog(`[SONUÇ] ${summaryLine(report)}`);
  qlog(`[RAPOR] ${join(runDir, 'report.md')}`);
  return { report, runDir };
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  requireDevice, deviceInfo, isInstalled, installApk, clearLogcat, dumpLogcat, coldStartMs, runMonkey,
  screenshot, dumpTree, tryShell, stabilize, launch, collapseShade,
} from './device.mjs';
import { parseNodes, interactives, a11yIssues } from './tree.mjs';
import { scanLogcat, hitsToFindings } from './logcat.mjs';
import { finalizeReport, summaryLine } from './report.mjs';
import { loadConfig, detectPackage, detectFramework } from './config.mjs';
import { qlog, configureLog } from './log.mjs';
import { preflightDisk } from './doctor.mjs';
import { newRunId, sleep } from './util.mjs';
import { UsageError, EnvError } from './errors.mjs';

export function deviceDensity() {
  const out = tryShell('wm', 'density');
  const m = out.match(/Override density:\s*(\d+)/) || out.match(/Physical density:\s*(\d+)/);
  return m ? Number(m[1]) / 160 : 2.625;
}

export function monkeyCrashedPkg(out, pkg) {
  return [...String(out).matchAll(/\/\/ (?:CRASH|NOT RESPONDING): ([\w.]+)/g)].some((m) => m[1] === pkg);
}

const isRunning =(pkg) => tryShell('pidof', pkg).trim().length > 0;

export function a11yFindings(issues, evidence) {
  const groups = {};
  for (const i of issues) (groups[i.kind] ||= []).push(i);
  const out = [];
  if (groups['label-missing']) {
    out.push({
      type: 'a11y', severity: 'orta', confidence: 'kesin',
      title: `${groups['label-missing'].length} etkileşimli öğenin erişilebilirlik etiketi yok`,
      detail: groups['label-missing'].map((i) => `${i.element}: ${i.detail}`).join('\n'),
      source: 'a11y-tree', evidence, key: `a11y:label-missing:${groups['label-missing'].length}`,
    });
  }
  if (groups['small-target']) {
    out.push({
      type: 'a11y', severity: 'düşük', confidence: 'muhtemel',
      title: `${groups['small-target'].length} dokunma hedefi 48dp'den küçük`,
      detail: groups['small-target'].map((i) => `${i.element}: ${i.detail}`).join('\n'),
      source: 'a11y-tree', evidence, key: `a11y:small-target:${groups['small-target'].length}`,
    });
  }
  return out;
}

export async function smoke({ appDir = '.', pkg, apk, events = 1500, seed = 42, json = false }) {
  const cfg = loadConfig(appDir);
  configureLog({ appDir: cfg.appDir, stderr: json });
  pkg = pkg || cfg.package || detectPackage(cfg.appDir);
  if (!pkg) throw new UsageError('paket adı bulunamadı — --pkg <com.ornek.app> ver ya da .qa/testful.json içine "package" yaz');
  preflightDisk();
  const serial = requireDevice();
  const apkPath = apk || cfg.apk;
  if (apkPath && (apk || !isInstalled(pkg))) { qlog(`[KURULUM] ${apkPath}`); installApk(apkPath); }
  if (!isInstalled(pkg)) throw new EnvError(`${pkg} cihazda kurulu değil — --apk <yol> ver`);

  const runDir = join(cfg.appDir, '.qa', 'results', newRunId());
  mkdirSync(runDir, { recursive: true });
  const findings = [];
  const metrics = {};
  const gaps = [];
  const unstabilize = stabilize();
  qlog(`[SMOKE] ${pkg} · cihaz ${serial}`);

  clearLogcat();
  tryShell('pm', 'clear', pkg);
  const coldMs = coldStartMs(pkg);
  metrics['soğuk açılış (ms)'] = coldMs;
  if (coldMs === null) launch(pkg);
  await sleep(6000);
  if (coldMs !== null && coldMs > 5000) {
    findings.push({ type: 'performance', severity: 'orta', confidence: 'muhtemel', title: `Soğuk açılış yavaş: ${coldMs} ms (> 5000 ms)`, source: 'am start -W', evidence: [], key: 'perf:cold-start' });
  }
  const aliveAfterLaunch = isRunning(pkg);
  let log = dumpLogcat();
  if (log === null) gaps.push('açılış logcat');
  writeFileSync(join(runDir, 'launch-logcat.txt'), log || '');
  const launchHits = scanLogcat(log, { pkg }).hits;
  findings.push(...hitsToFindings(launchHits, { source: 'açılış', evidence: ['launch-logcat.txt'] }));
  if (!aliveAfterLaunch && !launchHits.some((h) => h.type === 'crash')) {
    findings.push({ type: 'crash', severity: 'kritik', confidence: 'muhtemel', title: 'Uygulama açıldıktan sonra süreç yaşamıyor', source: 'açılış', evidence: ['launch-logcat.txt'], key: 'launch:dead' });
  }

  if (aliveAfterLaunch) {
    try {
      writeFileSync(join(runDir, 'launch.png'), screenshot());
      const xml = dumpTree();
      writeFileSync(join(runDir, 'launch.xml'), xml);
      const els = interactives(parseNodes(xml), pkg);
      metrics['ilk ekran etkileşim sayısı'] = els.length;
      findings.push(...a11yFindings(a11yIssues(els, { density: deviceDensity() }), ['launch.png', 'launch.xml']));
    } catch (e) {
      gaps.push('ilk ekran (ağaç/görüntü)');
      qlog(`  [UYARI] ilk ekran ölçülemedi: ${e.message.split(/\r?\n/)[0]}`);
    }
  }

  if (events > 0) {
    qlog(`[KAOS] monkey ${events} olay · seed ${seed}`);
    clearLogcat();
    const monkeyOut = runMonkey(pkg, { events, seed });
    collapseShade();
    writeFileSync(join(runDir, 'monkey.txt'), monkeyOut);
    log = dumpLogcat();
    if (log === null || !/Events injected/.test(monkeyOut)) gaps.push('kaos (monkey/logcat)');
    writeFileSync(join(runDir, 'monkey-logcat.txt'), log || '');
    const hits = scanLogcat(log, { pkg }).hits;
    findings.push(...hitsToFindings(hits, { source: `monkey seed=${seed}`, evidence: ['monkey-logcat.txt', 'monkey.txt'] })
      .map((f) => ({ ...f, detail: `Tekrar üret: testful smoke --pkg ${pkg} --events ${events} --seed ${seed}\n${f.detail}` })));
    if (monkeyCrashedPkg(monkeyOut, pkg) && !hits.some((h) => h.type === 'crash' || h.type === 'anr')) {
      findings.push({ type: 'crash', severity: 'kritik', confidence: 'kesin', title: 'Kaos testinde çökme/ANR (monkey raporu)', source: `monkey seed=${seed}`, evidence: ['monkey.txt'], key: 'monkey:crash' });
    }
    metrics['kaos olayı'] = events;
  }
  tryShell('am', 'force-stop', pkg);
  unstabilize();

  const report = finalizeReport(runDir, {
    kind: 'smoke',
    app: { package: pkg, framework: detectFramework(cfg.appDir) },
    device: deviceInfo(),
    findings,
    metrics,
    env_error: gaps.length ? `ölçülemeyen fazlar: ${gaps.join(', ')}` : null,
  });
  qlog(`[SONUÇ] ${summaryLine(report)}`);
  qlog(`[RAPOR] ${join(runDir, 'report.md')}`);
  return { report, runDir };
}

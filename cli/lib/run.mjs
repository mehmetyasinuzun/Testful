import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { adb, requireDevice, setAnimations, resetApp, launch, scanLogcat } from './device.mjs';
import { qlog } from './log.mjs';
import { applyMatrixState } from './matrix.mjs';

function getMaestroCmd() {
  try {
    execSync('maestro --version', { stdio: 'ignore' });
    return 'maestro';
  } catch {}
  if (existsSync('C:\\dev\\maestro\\bin\\maestro.bat')) {
    return 'C:\\dev\\maestro\\bin\\maestro.bat';
  }
  if (existsSync('C:\\dev\\maestro\\bin\\maestro')) {
    return 'C:\\dev\\maestro\\bin\\maestro';
  }
  throw new Error('Maestro CLI bulunamadı. Lütfen "testful setup" çalıştırın.');
}

export async function runSuite({ appDir, glob = '*', matrix = [] }) {
  appDir = resolve(appDir);
  requireDevice();
  const maestro = getMaestroCmd();
  
  // Disable animations for stability
  setAnimations('off');
  
  const scenariosDir = join(appDir, '.qa', 'scenarios');
  if (!existsSync(scenariosDir)) {
    throw new Error(`Senaryolar klasörü bulunamadı: ${scenariosDir}`);
  }
  
  const files = readdirSync(scenariosDir).filter(f => f.endsWith('.flow.yaml') && !f.startsWith('_'));
  const regex = new RegExp('^' + glob.replace(/\*/g, '.*') + '$');
  const matchingFiles = files.filter(f => regex.test(basename(f, '.flow.yaml')));
  
  if (matchingFiles.length === 0) {
    qlog(`[UYARI] Glob ile eşleşen senaryo bulunamadı: ${glob}`);
    return;
  }
  
  // Create Run directory
  const runId = new Date().toISOString().replace(/T/, '-').replace(/\..+/, '').replace(/:/g, '').replace(/-/g, '');
  const runDir = join(appDir, '.qa', 'results', runId);
  const shotsDir = join(runDir, 'screenshots');
  const logcatDir = join(runDir, 'logcat');
  mkdirSync(shotsDir, { recursive: true });
  mkdirSync(logcatDir, { recursive: true });
  
  qlog(`[RUN] Koşu başladı: ${runId}`);
  const resultsFile = join(runDir, 'results.ndjson');
  
  const executeFlow = (flowPath, logPath) => {
    try {
      const res = spawnSync(maestro, ['test', flowPath], {
        cwd: shotsDir,
        stdio: 'pipe',
        encoding: 'utf8',
        shell: true
      });
      if (res.error) {
        writeFileSync(logPath, `Spawning hatası: ${res.error.message}\nCode: ${res.error.code}`);
        return false;
      }
      writeFileSync(logPath, (res.stdout || '') + '\n' + (res.stderr || ''));
      return res.status === 0;
    } catch (e) {
      writeFileSync(logPath, `İstisna: ${e.message}`);
      return false;
    }
  };

  const runAllScenarios = async (stateLabel = '') => {
    const suffix = stateLabel ? `-${stateLabel}` : '';
    for (const file of matchingFiles) {
      const id = basename(file, '.flow.yaml');
      const fullId = id + suffix;
      const flowPath = join(scenariosDir, file);
      
      // Parse app package
      const flowContent = readFileSync(flowPath, 'utf8');
      const pkgMatch = flowContent.match(/^appId:\s*(.+)$/m);
      const pkg = pkgMatch ? pkgMatch[1].trim() : '';
      
      qlog(`[SCENARIO] Çalıştırılıyor: ${fullId}`);
      
      // Set up adb reverse
      try { adb('reverse', 'tcp:8080', 'tcp:8080'); } catch {}
      
      const prelaunch = () => {
        if (process.env.TESTFUL_PRELAUNCH === '1' && pkg) {
          try {
            adb('shell', 'am', 'force-stop', pkg);
            adb('shell', 'pm', 'clear', pkg);
            adb('shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1');
            adb('shell', 'sleep', '8');
          } catch {}
        }
      };

      prelaunch();
      
      // 1. Run
      const log1 = join(logcatDir, `${fullId}-1.txt`);
      const ok1 = executeFlow(flowPath, log1);
      
      if (ok1) {
        qlog(`[PASS] ${fullId}`);
        writeFileSync(resultsFile, JSON.stringify({ id: fullId, result: 'pass', confidence: 'kesin', retries: 0 }) + '\n', { flag: 'a' });
        continue;
      }
      
      // Failed. Run 2 more retries from clean state
      qlog(`[RETRY] ${fullId} başarısız oldu. 2 tekrar denemesi yapılıyor...`);
      let passes = 0;
      for (let n = 2; n <= 3; n++) {
        if (pkg) {
          try { adb('shell', 'am', 'force-stop', pkg); } catch {}
        }
        try { adb('reverse', 'tcp:8080', 'tcp:8080'); } catch {}
        prelaunch();
        
        const logN = join(logcatDir, `${fullId}-${n}.txt`);
        const okN = executeFlow(flowPath, logN);
        if (okN) passes++;
      }
      
      if (passes === 0) {
        qlog(`[FAIL] ${fullId} (3/3 fail)`);
        writeFileSync(resultsFile, JSON.stringify({ id: fullId, result: 'fail', confidence: 'kesin', retries: 2 }) + '\n', { flag: 'a' });
      } else {
        qlog(`[FLAKY] ${fullId} (1. fail, tekrarlarda ${passes}/2 geçti)`);
        writeFileSync(resultsFile, JSON.stringify({ id: fullId, result: 'flaky', confidence: 'flaky-suphesi', retries: 2 }) + '\n', { flag: 'a' });
      }
    }
  };

  // Run base scenarios
  await runAllScenarios('');

  // Run matrix states if requested
  if (matrix.length > 0) {
    for (const state of matrix) {
      const restore = applyMatrixState(state);
      try {
        await runAllScenarios(state);
      } finally {
        restore();
      }
    }
  }

  // Copy extra findings if seed exists
  const seedFile = join(appDir, '.qa', 'findings.seed.json');
  const extraFile = join(runDir, 'findings.extra.json');
  if (existsSync(seedFile)) {
    copyFileSync(seedFile, extraFile);
  }

  // Compile reports
  compileReport(runDir, appDir);
}

export function compileReport(runDir, appDir) {
  const runId = basename(runDir);
  const ndjsonFile = join(runDir, 'results.ndjson');
  const ndjson = existsSync(ndjsonFile)
    ? readFileSync(ndjsonFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    : [];

  const scenDir = join(appDir, '.qa', 'scenarios');
  
  function oracle(id) {
    const baseId = id.replace(/-(dark|large-font|landscape|offline)$/, '');
    const p = join(scenDir, `${baseId}.yaml`);
    if (!existsSync(p)) return { title: id, tier: '' };
    const t = readFileSync(p, 'utf8');
    const title = (t.match(/^title:\s*(.+)$/m) || [])[1]?.replace(/^["']|["']$/g, '') || baseId;
    const tier = (t.match(/^tier:\s*(.+)$/m) || [])[1]?.trim() || '';
    return { title, tier };
  }

  function getShots(id) {
    const d = join(runDir, 'screenshots');
    if (!existsSync(d)) return [];
    return readdirSync(d).filter((f) => f.startsWith(id + '-') && f.endsWith('.png'))
      .map((f) => `screenshots/${f}`);
  }

  const scenarios = ndjson.map((r) => ({ ...r, ...oracle(r.id), screenshots: getShots(r.id) }));
  
  const extraFile = join(runDir, 'findings.extra.json');
  const extra = existsSync(extraFile)
    ? JSON.parse(readFileSync(extraFile, 'utf8'))
    : { findings: [] };

  const totals = {
    passed: scenarios.filter((s) => s.result === 'pass').length,
    failed: scenarios.filter((s) => s.result === 'fail').length,
    flaky: scenarios.filter((s) => s.result === 'flaky').length,
  };
  const shipReady = totals.failed === 0 && (extra.findings || []).every((f) => f.severity !== 'kritik');

  const report = { 
    run_id: runId, 
    generated_from: 'testful/run-suite', 
    totals, 
    scenarios, 
    extra_findings: extra.findings || [], 
    ship_ready: shipReady 
  };
  
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2));

  const L = [];
  L.push(`# Testful Raporu — ${runId}`, '');
  L.push(`**Özet:** ${totals.passed} geçti · ${totals.failed} kaldı · ${totals.flaky} flaky-şüphesi`);
  L.push('');
  L.push(`**Piyasaya hazır mı?** ${shipReady ? '✅ Evet — kritik/kesin engel yok' : '❌ Hayır — aşağıdaki engeller var'}`);
  L.push('');
  L.push('## Senaryolar', '');
  L.push('| ID | Başlık | Tier | Sonuç | Güven |');
  L.push('|---|---|---|---|---|');
  for (const s of scenarios) {
    const mark = s.result === 'pass' ? '✅ geçti' : s.result === 'flaky' ? '🟡 flaky' : '❌ kaldı';
    L.push(`| ${s.id} | ${s.title || ''} | ${s.tier || ''} | ${mark} | ${s.confidence || ''} |`);
  }
  L.push('');
  
  const fails = scenarios.filter((s) => s.result === 'fail');
  if (fails.length) {
    L.push('## Kesin bulgular', '');
    for (const s of fails) {
      L.push(`### ${s.id} — ${s.title || ''}`);
      if (s.screenshots.length) L.push(`- Ekran görüntüleri: ${s.screenshots.join(', ')}`);
      L.push(`- Log: logcat/${s.id}-1.txt`, '');
    }
  }
  
  if ((extra.findings || []).length) {
    L.push('## Ek bulgular (kaos / testability / performans)', '');
    for (const f of extra.findings) {
      L.push(`### [${f.severity || 'orta'} · ${f.confidence || ''}] ${f.title}`);
      if (f.detail) L.push(f.detail);
      if (f.status) L.push(`- Durum: **${f.status}**`);
      if (f.evidence) L.push(`- Kanıt: ${f.evidence}`);
      L.push('');
    }
  }
  
  const flakies = scenarios.filter((s) => s.result === 'flaky');
  if (flakies.length) {
    L.push('## Flaky karantinası (fix loop\'a girmez)', '');
    for (const s of flakies) L.push(`- ${s.id} — ${s.title || ''} (1. koşu başarısız, tekrarda geçti)`);
    L.push('');
  }
  
  L.push('## Uygulama haritası', '');
  L.push('> Kapsama boyalı ekran-geçiş grafiği (graph.json).');
  L.push('');
  
  writeFileSync(join(runDir, 'report.md'), L.join('\n'));
  qlog(`[REPORT] Rapor yazıldı: ${join(runDir, 'report.md')}`);
}
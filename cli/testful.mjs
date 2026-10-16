#!/usr/bin/env node
// Testful CLI — ölçüm çekirdeğinin tek kapısı.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { observe } from './lib/observe.mjs';
import { map } from './lib/map.mjs';
import { setup } from './lib/setup.mjs';
import { doctor } from './lib/doctor.mjs';
import { runSuite } from './lib/run.mjs';
import { author } from './lib/author.mjs';

const HELP = `testful — güven-öncelikli mobil UX/UI test aracı

kullanım:
  testful observe --pkg <package> [--out <dir>]   ekran paketi: ağaç + png + selectors.json
                                                  (seçiciler GERÇEK a11y ağacından; çok-satır
                                                  düğümlere [\\s\\S]* önerisi, etiketsiz alanlara
                                                  a11y bayrağı + merkez koordinat)
  testful map --pkg <package> [--out <dir>] [--max N] [--max-minutes M] [--no-clear]
                                                  otonom keşif: ekran haritası + graph.json +
                                                  KAPSAMA METRİĞİ; kaydırma, giriş/OTP formu
                                                  (TESTFUL_LOGIN_USER/_PASSWORD/_OTP), gezinme
  testful judge [--map <dir>] [--max-screens N] [--model id] [--effort low|medium|high]
                                                  görsel hakem: haritadaki her benzersiz ekranı
                                                  Claude ile değerlendirir → judge.json
                                                  (ANTHROPIC_API_KEY gerekir; dokunma hedefi
                                                  kontrolü AI'sız)
  testful run <app_dir> [id_glob] [--matrix list] senaryo paketi (3x retry + flaky karantina)
                                                  örnek matrix: --matrix dark,large-font,landscape,offline
                                                  env: TESTFUL_PRELAUNCH=1 → launch adb ile
  testful author --in <dir> [--pkg <package>] [--out <dir>]
                                                  ekran paketlerinden senaryo iskeleti üretir
  testful doctor                                  ortam sağlık kontrolü (native Node.js)
  testful setup                                   yerel emülatör + Maestro CLI kurulumu (indirmeli/yerel)
  testful ci-init [repo_dir] [--force]            repoya GitHub Actions workflow'u ekler: her push/PR'da
                                                  bulut emülatöründe test (bkz. docs/CI.md)
`;

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return (i > -1 && i + 1 < process.argv.length) ? process.argv[i + 1] : def;
}

const cmd = process.argv[2];
try {
  if (cmd === 'observe') {
    const pkg = arg('--pkg');
    if (!pkg) { console.error('--pkg gerekli'); process.exit(2); }
    const out = arg('--out', '.qa/observe');
    const b = observe({ pkg, out });
    console.log(`ekran ${b.sig} → ${out}/  (${b.interactive_count} etkileşim, ${b.a11y_missing_count} a11y-eksik)`);
    for (const e of b.interactives) {
      const sel = e.selector || `KOORDINAT ${e.center.x},${e.center.y} (a11y-eksik!)`;
      console.log(`  [${e.kind}] ${e.label || '(etiketsiz ' + e.class + ')'} → ${sel}${e.ambiguous ? '  ⚠ belirsiz-önek' : ''}`);
    }
  } else if (cmd === 'map') {
    const pkg = arg('--pkg');
    if (!pkg) { console.error('--pkg gerekli'); process.exit(2); }
    await map({
      pkg,
      out: arg('--out', '.qa/map'),
      maxActions: Number(arg('--max', '80')),
      maxMinutes: Number(arg('--max-minutes', '10')),
      clear: !process.argv.includes('--no-clear'),
    });
  } else if (cmd === 'judge') {
    const { judge, DEFAULT_MODEL } = await import('./lib/judge.mjs');
    const mapDir = arg('--map', '.qa/map');
    await judge({
      mapDir,
      out: arg('--out', join(mapDir, 'judge.json')),
      model: arg('--model', DEFAULT_MODEL),
      effort: arg('--effort', 'medium'),
      maxScreens: Number(arg('--max-screens', '12')),
    });
  } else if (cmd === 'run') {
    const appDir = process.argv[3];
    if (!appDir || appDir.startsWith('-')) { console.error('kullanım: testful run <app_dir> [id_glob] [--matrix dark,offline]'); process.exit(2); }
    
    // Glob specifies optional scenario filter, e.g. CORE-*
    let glob = '*';
    if (process.argv[4] && !process.argv[4].startsWith('-')) {
      glob = process.argv[4];
    }
    
    const matrixStr = arg('--matrix', '');
    const matrix = matrixStr ? matrixStr.split(',').map(s => s.trim()) : [];
    
    await runSuite({ appDir, glob, matrix });
  } else if (cmd === 'author') {
    const dir = arg('--in');
    if (!dir) { console.error('--in <dir> gerekli'); process.exit(2); }
    const pkg = arg('--pkg');
    const out = arg('--out', '.qa/scenarios');
    author({ pkg, dir, out });
  } else if (cmd === 'animations') {
    const mode = process.argv[3] || 'off';
    const { setAnimations } = await import('./lib/device.mjs');
    setAnimations(mode);
  } else if (cmd === 'reset') {
    const pkg = process.argv[3];
    if (!pkg) { console.error('pkg gerekli'); process.exit(2); }
    const { resetApp } = await import('./lib/device.mjs');
    resetApp(pkg);
  } else if (cmd === 'monkey') {
    const pkg = process.argv[3];
    if (!pkg) { console.error('pkg gerekli'); process.exit(2); }
    const n = Number(process.argv[4] || '3000');
    const seed = Number(process.argv[5] || '42');
    const out = process.argv[6] || 'monkey-logcat.txt';
    const { runMonkey } = await import('./lib/device.mjs');
    runMonkey(pkg, n, seed, out);
  } else if (cmd === 'logcat-scan') {
    const file = process.argv[3];
    if (!file) { console.error('dosya gerekli'); process.exit(2); }
    const { scanLogcat } = await import('./lib/device.mjs');
    const res = scanLogcat(file);
    if (!res.clean) {
      for (const h of res.hits) {
        console.log(`${h.lineNum}: ${h.content}`);
      }
      console.log(`--- ${res.hits.length} kritik satır bulundu ---`);
      process.exit(1);
    }
    console.log('temiz');
  } else if (cmd === 'doctor') {
    const passed = doctor();
    process.exit(passed ? 0 : 1);
  } else if (cmd === 'setup') {
    setup();
  } else if (cmd === 'ci-init') {
    const dir = process.argv[3] && !process.argv[3].startsWith('-') ? process.argv[3] : '.';
    const { existsSync, mkdirSync, copyFileSync } = await import('node:fs');
    const target = join(dir, '.github', 'workflows', 'testful.yml');
    if (existsSync(target) && !process.argv.includes('--force')) {
      console.error(`zaten var: ${target} (üzerine yazmak için --force)`);
      process.exit(1);
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'testful-ci.yml'), target);
    console.log(`eklendi: ${target}\ncommit + push et → Actions sekmesinde "Testful" koşusu başlar.`);
  } else {
    console.log(HELP);
    process.exit(cmd ? 2 : 0);
  }
} catch (e) {
  console.error(`HATA: ${e.message}`);
  process.exit(1);
}

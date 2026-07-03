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
  testful map --pkg <package> [--out <dir>] [--max N] [--no-clear]
                                                  otonom keşif: ekran haritası + graph.json +
                                                  KAPSAMA METRİĞİ; engelde alan doldurma sezgisi
  testful run <app_dir> [id_glob] [--matrix list] senaryo paketi (3x retry + flaky karantina)
                                                  örnek matrix: --matrix dark,large-font,landscape,offline
                                                  env: TESTFUL_PRELAUNCH=1 → launch adb ile
  testful author --in <dir> [--pkg <package>] [--out <dir>]
                                                  ekran paketlerinden senaryo iskeleti üretir
  testful doctor                                  ortam sağlık kontrolü (native Node.js)
  testful setup                                   yerel emülatör + Maestro CLI kurulumu (indirmeli/yerel)
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
      clear: !process.argv.includes('--no-clear'),
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
  } else {
    console.log(HELP);
    process.exit(cmd ? 2 : 0);
  }
} catch (e) {
  console.error(`HATA: ${e.message}`);
  process.exit(1);
}

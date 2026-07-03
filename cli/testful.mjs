#!/usr/bin/env node
// Testful CLI — ölçüm çekirdeğinin tek kapısı.
// v0.1: observe (yeni, native) · run/doctor (kanıtlı bash çekirdeğine delege)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { observe } from './lib/observe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..', '.claude', 'skills', 'mobile-ux-test', 'scripts');

const HELP = `testful — güven-öncelikli mobil UX/UI test aracı

kullanım:
  testful observe --pkg <package> [--out <dir>]   ekran paketi: ağaç + png + selectors.json
                                                  (seçiciler GERÇEK a11y ağacından; çok-satır
                                                  düğümlere [\\s\\S]* önerisi, etiketsiz alanlara
                                                  a11y bayrağı + merkez koordinat)
  testful run <app_dir> [id_glob]                 senaryo paketi (3x retry + flaky karantina)
                                                  env: TESTFUL_PRELAUNCH=1 → launch adb ile
  testful doctor                                  ortam sağlık kontrolü
`;

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : def;
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
  } else if (cmd === 'run') {
    const appDir = process.argv[3];
    if (!appDir) { console.error('kullanım: testful run <app_dir> [id_glob]'); process.exit(2); }
    execFileSync('bash', [join(SCRIPTS, 'run-suite.sh'), appDir, process.argv[4] || '*'], { stdio: 'inherit' });
  } else if (cmd === 'doctor') {
    execFileSync('bash', [join(SCRIPTS, 'doctor.sh')], { stdio: 'inherit' });
  } else {
    console.log(HELP);
    process.exit(cmd ? 2 : 0);
  }
} catch (e) {
  console.error(`HATA: ${e.message}`);
  process.exit(1);
}

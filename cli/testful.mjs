#!/usr/bin/env node
import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, UsageError } from './lib/errors.mjs';
import { parseArgs } from './lib/util.mjs';

const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;

const HELP = `testful ${VERSION} — AI ile kod yazanlar için mobil (Android) test çekirdeği

BAŞLANGIÇ
  testful init [app_dir] [--no-skill]     .qa/ iskeleti + config + .gitignore + Claude Code skill'i
  testful doctor [--json]                 ortam sağlık kontrolü
  testful setup [--avd testful]           AVD (yerel imajdan) + Maestro kurulumu
  testful ci-init [repo_dir] [--force]     GitHub Actions workflow'u ekler: her push/PR'da bulut
                                          emülatöründe test (bilgisayarsız; bkz. docs/CI.md)

TEST
  testful smoke [app_dir] [--pkg P] [--apk F] [--events 1500] [--seed 42] [--json]
                                          senaryosuz hızlı karar: kur → soğuk açılış → çökme/ANR
                                          → a11y ölçümü → seed'li kaos → rapor
  testful run [app_dir] [glob] [--matrix dark,large-font,landscape,offline] [--apk F] [--json]
                                          .qa/scenarios/*.flow.yaml (Maestro) · izolasyon · 3x retry
                                          · flaky karantina · logcat çökme tespiti · önceki koşuyla fark
  testful report <run_dir> [--json]       findings.extra.json (AI/vision bulguları) ile raporu yeniden üret

KEŞİF ve ÜRETİM
  testful observe [--pkg P] [--out .qa/observe] [--json]
                                          o anki ekran: ağaç + png + gerçek seçiciler + a11y sorunları
  testful map [--pkg P] [--out .qa/map] [--max 80] [--max-minutes 10] [--no-clear]
                                          otonom keşif → graph.json + map.md (mermaid) + kapsama;
                                          kaydırır, giriş/OTP formunu doldurur (MAESTRO_EMAIL/
                                          _PASSWORD/_OTP/_PHONE), işi kalan ekrana yoldan döner
  testful judge [--map .qa/map] [--max-screens 12] [--model id] [--effort low|medium|high]
                                          görsel hakem: haritadaki her benzersiz ekranı Claude ile
                                          değerlendirir → judge.json (ANTHROPIC_API_KEY gerekir)
  testful author --from-map [.qa/map] [--out .qa/scenarios] [--force]
                                          haritadan her ekrana giden regresyon flow'ları (AI'sız)
  testful author --in .qa/observe [--pkg P] [--out .qa/scenarios] [--force]

ARAÇLAR
  testful screenshot <out.png> · testful reset <pkg> · testful animations on|off
  testful logcat-scan <file> [--pkg P]

ÇIKIŞ KODLARI  0 hazır · 1 engelleyici bulgu · 2 kullanım hatası · 3 ortam hatası (uygulama hatası DEĞİL)
ORTAM          ANDROID_SERIAL (cihaz seçimi) · ANDROID_HOME · MAESTRO · TESTFUL_LOG_DIR · TESTFUL_PRELAUNCH=1`;

const BOOL_FLAGS = new Set(['json', 'no-skill', 'no-clear', 'force', 'help', 'version']);

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const num = (v, def, name) => {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${name} sayı olmalı`);
  return n;
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest, BOOL_FLAGS);
  const json = flags.json === true;
  const emit = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return EXIT.OK; }
  if (cmd === '--version' || cmd === 'version' || cmd === '-v') { console.log(VERSION); return EXIT.OK; }

  const { configureLog } = await import('./lib/log.mjs');
  if (json) configureLog({ stderr: true });

  switch (cmd) {
    case 'init': {
      const { init } = await import('./lib/init.mjs');
      configureLog({ appDir: pos[0] || '.' });
      init({ appDir: pos[0] || '.', skill: !flags['no-skill'] });
      return EXIT.OK;
    }
    case 'doctor': {
      const { doctor } = await import('./lib/doctor.mjs');
      const r = doctor();
      if (json) emit(r);
      return r.ok ? EXIT.OK : EXIT.ENV;
    }
    case 'setup': {
      const { setup } = await import('./lib/setup.mjs');
      return setup({ avd: flags.avd || 'testful' }) ? EXIT.OK : EXIT.ENV;
    }
    case 'smoke': {
      const { smoke } = await import('./lib/smoke.mjs');
      const { compact } = await import('./lib/report.mjs');
      const { report, runDir } = await smoke({
        appDir: pos[0] || '.', pkg: flags.pkg, apk: flags.apk && resolve(flags.apk),
        events: num(flags.events, 1500, 'events'), seed: num(flags.seed, 42, 'seed'), json,
      });
      if (json) emit(compact(report, runDir));
      return exitFor(report);
    }
    case 'run': {
      const { runSuite } = await import('./lib/run.mjs');
      const { validateMatrix } = await import('./lib/matrix.mjs');
      const { compact } = await import('./lib/report.mjs');
      let appDir = '.';
      let glob = '*';
      if (pos[0] && isDir(pos[0])) { appDir = pos[0]; glob = pos[1] || '*'; } else if (pos[0]) glob = pos[0];
      const matrix = typeof flags.matrix === 'string' ? flags.matrix.split(',').map((s) => s.trim()).filter(Boolean) : [];
      validateMatrix(matrix);
      const { report, runDir } = await runSuite({ appDir, glob, matrix, apk: flags.apk && resolve(flags.apk), json });
      if (json) emit(compact(report, runDir));
      return exitFor(report);
    }
    case 'report': {
      const { refinalize, compact, summaryLine } = await import('./lib/report.mjs');
      const runDir = pos[0] && resolve(pos[0]);
      if (!runDir || !existsSync(join(runDir, 'run.json'))) throw new UsageError('kullanım: testful report <run_dir> (içinde run.json olmalı)');
      const report = refinalize(runDir);
      if (json) emit(compact(report, runDir));
      else console.log(`${summaryLine(report)}\n${join(runDir, 'report.md')}`);
      return exitFor(report);
    }
    case 'observe': {
      const { observe } = await import('./lib/observe.mjs');
      const { loadConfig } = await import('./lib/config.mjs');
      const pkg = flags.pkg || loadConfig('.').package;
      const out = flags.out || '.qa/observe';
      const b = observe({ pkg, out });
      if (json) { emit(b); return EXIT.OK; }
      console.log(`ekran ${b.sig} → ${out}/  (${b.interactive_count} etkileşim, ${b.a11y_missing_count} etiketsiz)`);
      for (const e of b.interactives) {
        const sel = e.selector || `KOORDİNAT ${e.center.x},${e.center.y} (etiketsiz!)`;
        console.log(`  [${e.kind}] ${e.label || `(etiketsiz ${e.class})`} → ${sel}${e.ambiguous ? '  ⚠ aynı etiketten birden fazla' : ''}`);
      }
      for (const i of b.a11y_issues) console.log(`  a11y: ${i.element} — ${i.detail}`);
      return EXIT.OK;
    }
    case 'map': {
      const { map } = await import('./lib/map.mjs');
      const { loadConfig, loadSecrets } = await import('./lib/config.mjs');
      const cfg = loadConfig('.');
      const pkg = flags.pkg || cfg.package;
      if (!pkg) throw new UsageError('--pkg gerekli (ya da .qa/testful.json içinde "package")');
      const g = await map({ pkg, out: flags.out || '.qa/map', maxActions: num(flags.max, 80, 'max'), maxMinutes: num(flags['max-minutes'], 10, 'max-minutes'), clear: !flags['no-clear'], reversePorts: cfg.reverse, secrets: loadSecrets('.') });
      if (json) emit({ stats: g.stats, crashes: g.crashes, graph: join(flags.out || '.qa/map', 'graph.json') });
      return g.crashes?.some((c) => ['crash', 'anr', 'oom'].includes(c.type)) ? EXIT.NOT_READY : EXIT.OK;
    }
    case 'judge': {
      const { judge, DEFAULT_MODEL } = await import('./lib/judge.mjs');
      const mapDir = typeof flags.map === 'string' ? flags.map : '.qa/map';
      const r = await judge({
        mapDir,
        out: typeof flags.out === 'string' ? flags.out : join(mapDir, 'judge.json'),
        model: typeof flags.model === 'string' ? flags.model : DEFAULT_MODEL,
        effort: typeof flags.effort === 'string' ? flags.effort : 'medium',
        maxScreens: num(flags['max-screens'], 12, 'max-screens'),
      });
      if (json) emit(r);
      return EXIT.OK;
    }
    case 'ci-init': {
      const { mkdirSync, copyFileSync } = await import('node:fs');
      const target = join(pos[0] || '.', '.github', 'workflows', 'testful.yml');
      if (existsSync(target) && !flags.force) throw new UsageError(`zaten var: ${target} (üzerine yazmak için --force)`);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'testful-ci.yml'), target);
      console.log(`eklendi: ${target}\ncommit + push et → Actions sekmesinde "Testful" koşusu başlar.`);
      return EXIT.OK;
    }
    case 'author': {
      const { authorFromMap, authorFromObserve } = await import('./lib/author.mjs');
      const out = flags.out || '.qa/scenarios';
      if (flags['from-map'] !== undefined) {
        const mapDir = typeof flags['from-map'] === 'string' ? flags['from-map'] : '.qa/map';
        const r = authorFromMap({ mapDir, out, force: !!flags.force });
        if (json) emit(r);
      } else if (typeof flags.in === 'string') {
        const r = authorFromObserve({ dir: flags.in, out, pkg: flags.pkg, force: !!flags.force });
        if (json) emit(r);
      } else throw new UsageError('kullanım: testful author --from-map [dir] | --in <observe_dir>');
      return EXIT.OK;
    }
    case 'screenshot': {
      if (!pos[0]) throw new UsageError('kullanım: testful screenshot <out.png>');
      const { requireDevice, screenshot } = await import('./lib/device.mjs');
      requireDevice();
      writeFileSync(pos[0], screenshot());
      console.log(pos[0]);
      return EXIT.OK;
    }
    case 'reset': {
      if (!pos[0]) throw new UsageError('kullanım: testful reset <pkg>');
      const { requireDevice, resetApp } = await import('./lib/device.mjs');
      requireDevice();
      resetApp(pos[0]);
      return EXIT.OK;
    }
    case 'animations': {
      const mode = pos[0] || 'off';
      if (!['on', 'off'].includes(mode)) throw new UsageError('kullanım: testful animations on|off');
      const { requireDevice, setAnimations } = await import('./lib/device.mjs');
      requireDevice();
      setAnimations(mode);
      return EXIT.OK;
    }
    case 'logcat-scan': {
      if (!pos[0] || !existsSync(pos[0])) throw new UsageError('kullanım: testful logcat-scan <dosya> [--pkg P]');
      const { scanLogcat } = await import('./lib/logcat.mjs');
      const r = scanLogcat(readFileSync(pos[0], 'utf8'), { pkg: typeof flags.pkg === 'string' ? flags.pkg : undefined });
      if (json) emit(r);
      else if (r.clean) console.log('temiz');
      else for (const h of r.hits) console.log(`[${h.severity}] ${h.title} ×${h.count} (satır ${h.line})\n    ${h.stack.slice(0, 3).join('\n    ')}`);
      return r.hits.some((h) => h.severity === 'kritik') ? EXIT.NOT_READY : EXIT.OK;
    }
    default:
      throw new UsageError(`bilinmeyen komut: ${cmd}\n\n${HELP}`);
  }
}

function exitFor(report) {
  return report.status === 'ready' ? EXIT.OK : report.status === 'inconclusive' ? EXIT.ENV : EXIT.NOT_READY;
}

main().then((code) => { process.exitCode = code; }).catch((e) => {
  console.error(`HATA: ${e.message}`);
  if (process.env.TESTFUL_DEBUG) console.error(e.stack);
  process.exitCode = e.exitCode ?? EXIT.ENV;
});

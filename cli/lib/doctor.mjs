import { execFileSync, spawnSync } from 'node:child_process';
import { statfsSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { qlog } from './log.mjs';
import { resolveAdb, listDevices, sdkTool, sdkRoot } from './device.mjs';
import { resolveMaestro } from './maestro.mjs';
import { which } from './util.mjs';
import { EnvError } from './errors.mjs';

function versionOf(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000 });
  return `${r.stdout || ''}${r.stderr || ''}` || null;
}

export function javaMajor() {
  const javaHome = process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const java = (javaHome && existsSync(javaHome) && javaHome) || which('java');
  if (!java) return null;
  const out = versionOf(java, ['-version']) || '';
  const m = out.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]);
}

export function doctor() {
  const checks = [];
  const add = (name, ok, detail, fix, required = true) => checks.push({ name, ok, required, detail, fix: ok ? undefined : fix });

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add('node', nodeMajor >= 18, `v${process.versions.node}`, 'Node.js 18+ kur');

  const adb = resolveAdb({ optional: true });
  add('adb', !!adb, adb || 'bulunamadı', 'Android SDK platform-tools kur (ANDROID_HOME ayarla ya da PATH\'e ekle)');

  if (adb) {
    let devs = [];
    try { devs = listDevices(); } catch {}
    const ready = devs.filter((d) => d.state === 'device');
    const unauth = devs.filter((d) => d.state === 'unauthorized');
    add('cihaz', ready.length > 0,
      ready.length ? ready.map((d) => d.serial).join(', ') : unauth.length ? `yetkisiz: ${unauth.map((d) => d.serial).join(', ')}` : 'bağlı cihaz yok',
      unauth.length ? 'telefonda USB hata ayıklama iznini onayla' : `emülatör başlat: ${sdkTool('emulator/emulator')} -avd testful`);
  }

  const maestro = resolveMaestro({ optional: true });
  add('maestro', !!maestro, maestro || 'bulunamadı', '"testful setup" ya da https://docs.maestro.dev kurulum rehberi');

  const jm = javaMajor();
  add('java 17+', jm !== null && jm >= 17, jm ? `Java ${jm}` : 'bulunamadı', 'JDK 17+ kur ve JAVA_HOME ayarla (Maestro için)');

  const seenRoots = new Set();
  for (const [label, p] of [['çalışma dizini', process.cwd()], ['geçici dizin', tmpdir()], ['ev dizini (AVD/Maestro)', homedir()]]) {
    const root = parse(resolve(p)).root.toLowerCase();
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    try {
      const st = statfsSync(p);
      const freeGb = (st.bavail * st.bsize) / 1e9;
      add(`disk ${root}`, freeGb >= 8, `${freeGb.toFixed(1)} GB boş (${label})`, "en az 8 GB boş alan aç — dolu disk emülatörü ve Maestro JVM'ini sessizce bozar");
    } catch {}
  }

  const emu = sdkTool('emulator/emulator');
  let avds = [];
  if (existsSync(emu)) {
    try { avds = execFileSync(emu, ['-list-avds'], { encoding: 'utf8', timeout: 30000 }).split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('INFO')); } catch {}
  }
  add('emülatör (AVD)', avds.length > 0, avds.length ? avds.join(', ') : `SDK: ${sdkRoot() || '-'}`, '"testful setup" yerel sistem imajından AVD kurar', false);

  const flutter = which('flutter');
  add('flutter', !!flutter, flutter || 'yok', 'yalnız Flutter projeleri için gerekli', false);
  const patrol = which('patrol') || (process.env.LOCALAPPDATA && [join(process.env.LOCALAPPDATA, 'Pub', 'Cache', 'bin', 'patrol.bat')].find(existsSync)) || [join(homedir(), '.pub-cache', 'bin', 'patrol')].find(existsSync);
  add('patrol', !!patrol, patrol || 'yok', 'Flutter derin mod için: dart pub global activate patrol_cli', false);

  qlog('=== testful doctor ===');
  for (const c of checks) {
    const mark = c.ok ? '[TAMAM]' : c.required ? '[EKSİK]' : '[opsiyonel]';
    qlog(`${mark} ${c.name}: ${c.detail}${c.fix ? `  → ${c.fix}` : ''}`);
  }
  const missing = checks.filter((c) => c.required && !c.ok);
  qlog(missing.length ? `=== ${missing.length} zorunlu eksik ===` : '=== hazır ===');
  return { ok: missing.length === 0, checks };
}

export function preflightDisk(minGb = 0.5) {
  for (const p of [tmpdir(), homedir()]) {
    try {
      const st = statfsSync(p);
      const freeGb = (st.bavail * st.bsize) / 1e9;
      if (freeGb < minGb) throw new EnvError(`disk dolu: ${parse(resolve(p)).root} üzerinde ${freeGb.toFixed(2)} GB boş (${p}) — emülatör/Maestro güvenilir çalışamaz, yer aç`);
    } catch (e) {
      if (e instanceof EnvError) throw e;
    }
  }
}

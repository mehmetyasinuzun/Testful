import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EnvError } from './errors.mjs';

const IS_WIN = process.platform === 'win32';

export function sdkRoot() {
  const cands = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    IS_WIN && process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.platform === 'darwin' && join(homedir(), 'Library', 'Android', 'sdk'),
    join(homedir(), 'Android', 'Sdk'),
  ].filter(Boolean);
  return cands.find((p) => existsSync(p)) || cands[0] || '';
}

export const sdkTool = (rel) => join(sdkRoot(), rel + (IS_WIN ? (rel.includes('cmdline-tools') ? '.bat' : '.exe') : ''));

let adbPath = null;
export function resolveAdb({ optional = false } = {}) {
  if (adbPath) return adbPath;
  for (const cand of [process.env.ADB, 'adb', sdkTool('platform-tools/adb')]) {
    if (!cand) continue;
    try {
      execFileSync(cand, ['version'], { stdio: 'ignore', timeout: 15000 });
      adbPath = cand;
      return adbPath;
    } catch {}
  }
  if (optional) return null;
  throw new EnvError('adb bulunamadı (PATH, ANDROID_HOME ya da varsayılan SDK konumu). Kurulum: Android SDK platform-tools');
}

const TRANSIENT = /device offline|device '.*' not found|no devices\/emulators found|device still connecting|closed|connection reset/i;

export function waitForDevice(timeout = 60000) {
  try {
    execFileSync(resolveAdb(), ['wait-for-device'], { stdio: 'ignore', timeout });
    for (let i = 0; i < 30; i++) {
      const out = execFileSync(resolveAdb(), ['shell', 'getprop', 'sys.boot_completed'], { timeout: 10000 }).toString().trim();
      if (out === '1') return true;
      execFileSync(resolveAdb(), ['shell', 'sleep', '1'], { stdio: 'ignore', timeout: 10000 });
    }
  } catch {}
  return false;
}

export function adb(args, { timeout = 120000, input } = {}) {
  const run = () => execFileSync(resolveAdb(), args, { maxBuffer: 256e6, timeout, input, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    return run();
  } catch (e) {
    const msg = `${e.stderr || ''}${e.message || ''}`;
    if (!TRANSIENT.test(msg) || !waitForDevice()) throw e;
    return run();
  }
}
export const adbStr = (args, opts) => adb(args, opts).toString('utf8');
export const shell = (...args) => adbStr(['shell', ...args]);
export const tryShell = (...args) => { try { return shell(...args); } catch { return ''; } };

export function listDevices() {
  const lines = adbStr(['devices']).split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean);
  return lines.map((l) => {
    const [serial, state] = l.split(/\s+/);
    return { serial, state };
  });
}

export function requireDevice() {
  const devs = listDevices();
  const wanted = process.env.ANDROID_SERIAL;
  if (wanted) {
    const d = devs.find((x) => x.serial === wanted);
    if (!d || d.state !== 'device') throw new EnvError(`ANDROID_SERIAL=${wanted} hazır değil (durum: ${d?.state || 'yok'})`);
    return wanted;
  }
  const ready = devs.filter((d) => d.state === 'device');
  if (!ready.length) {
    const unauth = devs.find((d) => d.state === 'unauthorized');
    if (unauth) throw new EnvError(`cihaz yetkisiz (${unauth.serial}): telefonda USB hata ayıklama iznini onayla`);
    throw new EnvError('bağlı cihaz yok — emülatörü başlat: emulator -avd testful  (ya da USB ile cihaz bağla)');
  }
  process.env.ANDROID_SERIAL = ready[0].serial;
  return ready[0].serial;
}

export function deviceInfo() {
  const prop = (k) => tryShell('getprop', k).trim();
  return {
    serial: process.env.ANDROID_SERIAL || null,
    model: prop('ro.product.model'),
    android: prop('ro.build.version.release'),
    sdk: prop('ro.build.version.sdk'),
    kind: (process.env.ANDROID_SERIAL || '').startsWith('emulator-') ? 'emulator' : 'device',
  };
}

export function dumpTree() {
  for (let i = 0; i < 3; i++) {
    try {
      const out = adbStr(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { timeout: 60000 });
      const start = out.indexOf('<?xml');
      const end = out.lastIndexOf('>');
      if (start > -1 && out.includes('<hierarchy')) return out.slice(start, end + 1);
    } catch {}
    tryShell('sleep', '0.6');
  }
  throw new EnvError('uiautomator dump 3 denemede başarısız (ekran kilitli ya da uygulama sürekli animasyonda olabilir)');
}

export const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export const screenshot = () => adb(['exec-out', 'screencap', '-p']);
export const tap = (x, y) => shell('input', 'tap', String(Math.round(x)), String(Math.round(y)));
export const typeText = (s) => shell('input', 'text', shQuote(String(s).replace(/ /g, '%s')));
export function clearField(len = 0) {
  shell('input', 'keyevent', 'KEYCODE_MOVE_END');
  const n = Math.min(Math.max(len, 0) + 2, 200);
  for (let i = 0; i < n; i += 50) shell('input', 'keyevent', ...Array(Math.min(50, n - i)).fill('67'));
}
export const back = () => shell('input', 'keyevent', 'KEYCODE_BACK');
export const hideKb = () => shell('input', 'keyevent', 'KEYCODE_ESCAPE');

export const collapseShade = () => tryShell('cmd', 'statusbar', 'collapse');

export function isInstalled(pkg) {
  return tryShell('pm', 'path', pkg).includes('package:');
}

export function installApk(apk) {
  if (!existsSync(apk)) throw new EnvError(`APK bulunamadı: ${apk}`);
  const out = adbStr(['install', '-r', '-t', apk], { timeout: 600000 });
  if (!/Success/.test(out)) throw new EnvError(`APK kurulamadı: ${out.trim().split('\n').pop()}`);
  waitForDevice();
}

export function launchActivity(pkg) {
  const out = tryShell('cmd', 'package', 'resolve-activity', '--brief', pkg).trim().split(/\r?\n/).pop()?.trim() || '';
  return out.includes('/') ? out : null;
}

export function launch(pkg, { clear = false } = {}) {
  collapseShade();
  tryShell('am', 'force-stop', pkg);
  if (clear) tryShell('pm', 'clear', pkg);
  const act = launchActivity(pkg);
  if (act) { shell('am', 'start', '-n', act); return; }
  shell('monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1');
}

export function coldStartMs(pkg) {
  const act = launchActivity(pkg);
  if (!act) return null;
  tryShell('am', 'force-stop', pkg);
  const out = tryShell('am', 'start', '-W', '-n', act);
  const m = out.match(/TotalTime:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

export function setAnimations(mode = 'off') {
  const v = mode === 'on' ? '1' : '0';
  for (const k of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) {
    shell('settings', 'put', 'global', k, v);
  }
}

const demo = (...extra) => tryShell('am', 'broadcast', '-a', 'com.android.systemui.demo', ...extra);

export function stabilize() {
  const keys = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'];
  const prevAnim = keys.map((k) => [k, tryShell('settings', 'get', 'global', k).trim()]);
  const prevDemo = tryShell('settings', 'get', 'global', 'sysui_demo_allowed').trim();
  setAnimations('off');
  tryShell('settings', 'put', 'global', 'sysui_demo_allowed', '1');
  demo('-e', 'command', 'enter');
  demo('-e', 'command', 'clock', '-e', 'hhmm', '1200');
  demo('-e', 'command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false');
  demo('-e', 'command', 'network', '-e', 'wifi', 'show', '-e', 'level', '4');
  demo('-e', 'command', 'notifications', '-e', 'visible', 'false');
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    demo('-e', 'command', 'exit');
    if (prevDemo && prevDemo !== 'null') tryShell('settings', 'put', 'global', 'sysui_demo_allowed', prevDemo);
    for (const [k, v] of prevAnim) if (v && v !== 'null') tryShell('settings', 'put', 'global', k, v);
  };
}

export function resetApp(pkg) {
  tryShell('am', 'force-stop', pkg);
  tryShell('pm', 'clear', pkg);
}

export function clearLogcat() {
  try { adb(['logcat', '-c']); } catch {}
  try { adb(['logcat', '-b', 'crash', '-c']); } catch {}
}

export function dumpLogcat() {
  try { return adbStr(['logcat', '-d', '-v', 'threadtime', '-b', 'main', '-b', 'system', '-b', 'crash'], { timeout: 60000 }); }
  catch { return null; }
}

export function runMonkey(pkg, { events = 3000, seed = 42, throttle = 50 } = {}) {
  try {
    return adbStr(['shell', 'monkey', '-p', pkg, '-s', String(seed), '--throttle', String(throttle),
      '--pct-syskeys', '0', '--pct-appswitch', '0', '--ignore-timeouts', '-v', String(events)], { timeout: 1800000 });
  } catch (e) {
    return (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
  }
}

export function reverse(ports = []) {
  for (const p of ports) {
    try { adb(['reverse', `tcp:${p}`, `tcp:${p}`]); } catch {}
  }
}

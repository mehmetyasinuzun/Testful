import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

function resolveAdb() {
  for (const cand of [process.env.ADB, 'adb', join(process.env.LOCALAPPDATA || '', 'Android/Sdk/platform-tools/adb.exe')]) {
    if (!cand) continue;
    try { execFileSync(cand, ['version'], { stdio: 'ignore' }); return cand; } catch {}
  }
  throw new Error('adb bulunamadı (PATH ya da %LOCALAPPDATA%\\Android\\Sdk\\platform-tools)');
}

export const ADB = resolveAdb();
export const adb = (...a) => execFileSync(ADB, a, { maxBuffer: 64e6 });
export const adbStr = (...a) => adb(...a).toString('utf8');

export function requireDevice() {
  const lines = adbStr('devices').trim().split('\n').slice(1).filter(Boolean);
  const dev = lines.find((l) => l.endsWith('\tdevice'));
  if (!dev) throw new Error('bağlı cihaz yok (emülatör başlat: emulator -avd testful -snapshot temiz)');
  return dev.split('\t')[0];
}

export function dumpTree() {
  for (let i = 0; i < 3; i++) {
    try {
      const out = adbStr('exec-out', 'uiautomator', 'dump', '/dev/tty');
      const xml = out.slice(out.indexOf('<?xml'), out.lastIndexOf('>') + 1);
      if (xml.includes('<hierarchy')) return xml;
    } catch {}
    try { adb('shell', 'sleep', '0.6'); } catch {}
  }
  throw new Error('uiautomator dump 3 denemede başarısız');
}

export const screenshot = () => adb('exec-out', 'screencap', '-p');
export const tap = (x, y) => adb('shell', 'input', 'tap', String(x), String(y));
export const typeText = (s) => adb('shell', 'input', 'text', s.replace(/ /g, '%s'));
export const back = () => adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
export const hideKb = () => adb('shell', 'input', 'keyevent', '111');
export const sleepOnDevice = (sec) => adb('shell', 'sleep', String(sec));

export function launch(pkg, { clear = false } = {}) {
  adb('shell', 'am', 'force-stop', pkg);
  if (clear) adb('shell', 'pm', 'clear', pkg);
  try {
    const act = adbStr('shell', 'cmd', 'package', 'resolve-activity', '--brief', pkg).trim().split('\n').pop().trim();
    if (act.includes('/')) { adb('shell', 'am', 'start', '-n', act); return; }
  } catch {}
  adb('shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1');
}

export function setAnimations(mode = 'off') {
  const v = mode === 'on' ? '1' : '0';
  adb('shell', 'settings', 'put', 'global', 'window_animation_scale', v);
  adb('shell', 'settings', 'put', 'global', 'transition_animation_scale', v);
  adb('shell', 'settings', 'put', 'global', 'animator_duration_scale', v);
}

export function resetApp(pkg) {
  adb('shell', 'am', 'force-stop', pkg);
  adb('shell', 'pm', 'clear', pkg);
}

export function runMonkey(pkg, n = 3000, seed = 42, logcatFile) {
  try { adb('logcat', '-c'); } catch {}
  try {
    adb('shell', 'monkey', '-p', pkg, '-s', String(seed), '--throttle', '50', '--pct-syskeys', '0', '--ignore-timeouts', '-v', String(n));
  } catch {}
  const log = adb('logcat', '-d');
  writeFileSync(logcatFile, log);
}

export function scanLogcat(logcatFile) {
  if (!existsSync(logcatFile)) return { clean: true, hits: [] };
  const content = readFileSync(logcatFile, 'utf8');
  const patterns = [
    /FATAL EXCEPTION/i,
    /ANR in /i,
    /Force finishing activity/i,
    /E\/flutter/i,
    /RenderFlex overflowed/i,
    /OutOfMemoryError/i,
    /native crash/i,
    /CRASH/i
  ];
  const lines = content.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (patterns.some(p => p.test(line))) {
      hits.push({ lineNum: i + 1, content: line.trim() });
    }
  }
  return { clean: hits.length === 0, hits };
}

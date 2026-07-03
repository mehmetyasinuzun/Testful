import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

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

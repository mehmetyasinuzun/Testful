// Platform katmanı: araç yolları (adb, emulator, sdkmanager, maestro, patrol) ve
// disk ölçümü Windows / macOS / Linux için tek yerde çözülür. Diğer modüller
// platforma göre dallanmaz; yalnız buradaki fonksiyonları çağırır.
import { existsSync, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

/** Android SDK kök adayları, öncelik sırasıyla (env > platform varsayılanı). */
export function sdkRoots(env = process.env, platform = process.platform, home = homedir()) {
  const roots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT];
  if (platform === 'win32') roots.push(join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Android', 'Sdk'));
  else if (platform === 'darwin') roots.push(join(home, 'Library', 'Android', 'sdk'));
  else roots.push(join(home, 'Android', 'Sdk'));
  return [...new Set(roots.filter(Boolean))];
}

/** Windows'ta çalıştırılabilir uzantı adayları. */
function exeNames(name, platform = process.platform) {
  if (platform !== 'win32' || /\.[a-z]+$/i.test(name)) return [name];
  return [`${name}.exe`, `${name}.bat`, `${name}.cmd`, name];
}

/** PATH üzerinde komutu arar; tam yolunu ya da null döndürür (alt süreç açmadan). */
export function findOnPath(cmd, env = process.env, platform = process.platform) {
  const dirs = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const n of exeNames(cmd, platform)) {
      const p = join(dir, n);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** SDK içindeki bir aracı bulur, örn. sdkTool('platform-tools/adb'). */
export function sdkTool(rel, env = process.env, platform = process.platform) {
  for (const root of sdkRoots(env, platform)) {
    for (const n of exeNames(join(root, rel), platform)) if (existsSync(n)) return n;
  }
  return null;
}

/** İlk bulunan aday: PATH → bilinen kurulum yerleri. */
function firstExisting(cmd, fallbacks) {
  return findOnPath(cmd) || fallbacks.find((p) => p && existsSync(p)) || null;
}

export const resolveAdb = () => process.env.ADB || findOnPath('adb') || sdkTool('platform-tools/adb');
export const resolveEmulator = () => findOnPath('emulator') || sdkTool('emulator/emulator');
export const resolveSdkManager = () => sdkTool('cmdline-tools/latest/bin/sdkmanager') || findOnPath('sdkmanager');
export const resolveAvdManager = () => sdkTool('cmdline-tools/latest/bin/avdmanager') || findOnPath('avdmanager');

export function resolveMaestro() {
  return firstExisting('maestro', IS_WIN
    ? ['C:\\dev\\maestro\\bin\\maestro.bat', join(homedir(), '.maestro', 'bin', 'maestro.bat')]
    : [join(homedir(), '.maestro', 'bin', 'maestro')]);
}

export function resolvePatrol() {
  return firstExisting('patrol', IS_WIN
    ? [join(process.env.LOCALAPPDATA || '', 'Pub', 'Cache', 'bin', 'patrol.bat')]
    : [join(homedir(), '.pub-cache', 'bin', 'patrol')]);
}

/** Verilen yoldaki diskte boş alan (GB), ölçülemezse null. */
export function freeDiskGb(path = process.cwd()) {
  try {
    const s = statfsSync(path);
    return Math.round((s.bavail * s.bsize) / 1024 ** 3);
  } catch {
    return null;
  }
}

/**
 * Windows .bat/.cmd dosyaları yalnız shell üzerinden çalışır (Node ≥18.20.2 güvenlik
 * kısıtı). Bu durumda argümanları shell'e güvenli geçirmek için tırnakla.
 */
export function spawnArgs(cmd, args, platform = process.platform) {
  const needsShell = platform === 'win32' && /\.(bat|cmd)$/i.test(cmd);
  if (!needsShell) return { cmd, args, shell: false };
  const q = (s) => (/[\s"&|<>^%]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);
  return { cmd: q(cmd), args: args.map(q), shell: true };
}

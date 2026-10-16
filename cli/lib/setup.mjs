import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { qlog } from './log.mjs';
import { sdkTool, resolveAdb } from './device.mjs';
import { resolveMaestro } from './maestro.mjs';
import { javaMajor } from './doctor.mjs';

const IS_WIN = process.platform === 'win32';

function runTool(path, args, { input } = {}) {
  if (IS_WIN && /\.(bat|cmd)$/i.test(path)) {
    const line = [path, ...args].map((a) => `"${String(a).replace(/"/g, '')}"`).join(' ');
    return execFileSync(line, { shell: true, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 600000 });
  }
  return execFileSync(path, args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 600000 });
}

function ensureAvd(avd) {
  const sdkmanager = sdkTool('cmdline-tools/latest/bin/sdkmanager');
  const avdmanager = sdkTool('cmdline-tools/latest/bin/avdmanager');
  if (!existsSync(avdmanager)) {
    qlog('[EKSİK] Android cmdline-tools yok → Android Studio > SDK Manager > "Android SDK Command-line Tools" kur');
    return false;
  }
  let avds = '';
  try { avds = runTool(avdmanager, ['list', 'avd']); } catch {}
  if (avds.includes(`Name: ${avd}`)) { qlog(`[TAMAM] AVD "${avd}" mevcut`); return true; }

  let images = [];
  try {
    images = runTool(sdkmanager, ['--list_installed']).split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/)[0]).filter((l) => l.startsWith('system-images;'));
  } catch {}
  const arch = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  const img = images.find((i) => i.includes('google_apis') && i.endsWith(arch)) || images.find((i) => i.endsWith(arch));
  if (!img) {
    qlog('[EKSİK] uygun sistem imajı yok. İnternet varken kur:');
    qlog(`  "${sdkmanager}" "system-images;android-35;google_apis;${arch}"`);
    return false;
  }
  qlog(`[..] AVD "${avd}" oluşturuluyor (${img})`);
  try {
    runTool(avdmanager, ['create', 'avd', '-n', avd, '-k', img, '-d', 'pixel_7'], { input: 'no\n' });
    qlog(`[TAMAM] AVD "${avd}" oluşturuldu`);
    return true;
  } catch (e) {
    qlog(`[HATA] AVD oluşturulamadı: ${(e.stderr || e.message).toString().trim().split('\n').pop()}`);
    return false;
  }
}

function installMaestroWindows() {
  const tmp = mkdtempSync(join(tmpdir(), 'testful-maestro-'));
  const zip = join(tmp, 'maestro.zip');
  try {
    qlog('[..] Maestro indiriliyor (github.com/mobile-dev-inc/maestro releases)');
    execFileSync('powershell', ['-NoProfile', '-Command',
      `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/mobile-dev-inc/maestro/releases/latest/download/maestro.zip' -OutFile '${zip}'`], { stdio: 'inherit', timeout: 600000 });
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${tmp}' -Force`], { stdio: 'inherit', timeout: 600000 });
    const src = readdirSync(tmp).map((d) => join(tmp, d)).find((d) => existsSync(join(d, 'bin', 'maestro.bat')));
    if (!src) throw new Error('arşivde maestro/bin bulunamadı');
    cpSync(src, join(homedir(), '.maestro'), { recursive: true });
    qlog(`[TAMAM] Maestro kuruldu → ${join(homedir(), '.maestro', 'bin')} (testful bu konumu otomatik bulur)`);
    return true;
  } catch (e) {
    qlog(`[HATA] Maestro kurulamadı: ${e.message}`);
    return false;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function setup({ avd = 'testful' } = {}) {
  qlog('=== testful setup ===');
  let ok = true;
  if (!resolveAdb({ optional: true })) {
    qlog('[EKSİK] adb yok → Android Studio ya da "platform-tools" kur, ANDROID_HOME ayarla');
    ok = false;
  } else qlog('[TAMAM] adb');

  ok = ensureAvd(avd) && ok;

  const jm = javaMajor();
  if (jm && jm >= 17) qlog(`[TAMAM] Java ${jm}`);
  else { qlog('[EKSİK] JDK 17+ gerekli (Maestro) → https://adoptium.net'); ok = false; }

  if (resolveMaestro({ optional: true })) qlog(`[TAMAM] Maestro: ${resolveMaestro()}`);
  else if (IS_WIN) ok = installMaestroWindows() && ok;
  else {
    qlog('[EKSİK] Maestro yok → resmi kurulum: curl -fsSL "https://get.maestro.mobile.dev" | bash');
    ok = false;
  }

  qlog('');
  qlog(`Emülatörü başlat:  "${sdkTool('emulator/emulator')}" -avd ${avd} -no-boot-anim`);
  qlog('Sonra:             testful doctor');
  return ok;
}

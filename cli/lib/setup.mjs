import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { qlog } from './log.mjs';
import { IS_WIN, resolveAvdManager, resolveEmulator, resolveMaestro, resolvePatrol, resolveSdkManager, spawnArgs } from './platform.mjs';

/** SDK aracını çalıştırır (Windows .bat için shell + tırnaklama platform katmanında). */
function sdk(tool, args, opts = {}) {
  const s = spawnArgs(tool, args);
  return execFileSync(s.cmd, s.args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: s.shell, ...opts });
}

/** Kurulu Java ana sürümü (8, 17, 21…) ya da null. */
export function javaVersion() {
  const r = spawnSync('java', ['-version'], { encoding: 'utf8' });
  return parseJavaVersion(`${r.stderr || ''}${r.stdout || ''}`);
}

/** `java -version` çıktısından ana sürüm: "1.8.0_x" → 8, "17.0.2" → 17. */
export function parseJavaVersion(text) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text || '');
  if (!m) return null;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]);
}

export function setup({ avd = 'testful' } = {}) {
  qlog('=== testful setup ===');

  const sdkmanager = resolveSdkManager();
  const avdmanager = resolveAvdManager();
  if (!sdkmanager || !avdmanager) {
    qlog('[EKSİK] Android SDK cmdline-tools bulunamadı (sdkmanager/avdmanager).');
    qlog('  Android Studio → SDK Manager → "Android SDK Command-line Tools" kur, ya da ANDROID_HOME ayarla.');
    return false;
  }

  // 1) sistem imajı var mı?
  let installed = [];
  try {
    installed = sdk(sdkmanager, ['--list_installed'])
      .split('\n').filter((l) => l.includes('system-images;')).map((l) => l.trim().split(/\s+/)[0]);
  } catch {}
  // Host mimarisine uygun imaj: Apple Silicon → arm64-v8a, diğerleri → x86_64
  const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  const img = installed.find((i) => new RegExp(`google_apis(_playstore)?;${abi}`).test(i)) || installed[0];
  if (!img) {
    qlog('[EKSİK] Android sistem imajı yok. İnternetin varken:');
    qlog(`  "${sdkmanager}" "system-images;android-35;google_apis;${abi}"`);
    return false;
  }
  qlog(`[TAMAM] sistem imajı: ${img}`);

  // 2) AVD var mı? yoksa oluştur (bedava, imajdan)
  let avds = '';
  try { avds = sdk(avdmanager, ['list', 'avd']); } catch {}
  if (avds.includes(`Name: ${avd}`)) {
    qlog(`[TAMAM] AVD "${avd}" zaten var`);
  } else {
    qlog(`[..] AVD "${avd}" oluşturuluyor (${img})`);
    try {
      // "Do you wish to create a custom hardware profile?" sorusuna stdin'den 'no'
      sdk(avdmanager, ['create', 'avd', '-n', avd, '-k', img, '-d', 'pixel_7'], { input: 'no\n', stdio: ['pipe', 'inherit', 'inherit'] });
      qlog(`[TAMAM] AVD "${avd}" oluşturuldu`);
    } catch (e) {
      qlog(`[HATA] AVD oluşturulamadı: ${e.message}`);
      return false;
    }
  }

  // 3) Java 17+ kontrolü (java -version çıktısını stderr'e yazar)
  const javaVer = javaVersion();
  if (javaVer === null) qlog('[EKSİK] Java bulunamadı. Maestro için JDK 17+ zorunludur.');
  else if (javaVer < 17) qlog(`[EKSİK] Java ${javaVer} kurulu; Maestro için JDK 17+ gerekli.`);
  else qlog(`[TAMAM] Java ${javaVer}`);

  // 4) Maestro CLI kontrolü ve otomatik kurulumu
  const maestro = resolveMaestro();
  if (maestro) {
    qlog(`[TAMAM] Maestro zaten yüklü (${maestro}).`);
  } else if (!IS_WIN) {
    // macOS/Linux: Maestro'nun resmi kurulum betiği (~/.maestro/bin)
    qlog('[..] Maestro kuruluyor (resmi betik: get.maestro.mobile.dev)...');
    try {
      execSync('curl -fsSL "https://get.maestro.mobile.dev" | bash', { stdio: 'inherit', shell: '/bin/bash' });
      qlog('[TAMAM] Maestro kuruldu (~/.maestro/bin). Yeni terminalde PATH aktif olur.');
    } catch (e) {
      qlog(`[UYARI] Maestro otomatik kurulamadı: ${e.message} → https://docs.maestro.dev`);
    }
  } else {
    qlog('[..] Maestro kurulu değil. Otomatik kurulum başlatılıyor...');
    try {
      if (!existsSync('C:\\dev')) mkdirSync('C:\\dev', { recursive: true });
      
      qlog('[..] Maestro zip indiriliyor (GitHub releases)...');
      execSync(`powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/mobile-dev-inc/maestro/releases/latest/download/maestro.zip' -OutFile 'C:\\dev\\maestro.zip'"`, { stdio: 'inherit' });
      
      qlog('[..] Arşiv dışarı aktarılıyor...');
      execSync(`powershell -Command "Expand-Archive -Path 'C:\\dev\\maestro.zip' -DestinationPath 'C:\\dev' -Force"`, { stdio: 'inherit' });
      
      qlog('[..] Geçici dosyalar temizleniyor...');
      execSync(`powershell -Command "Remove-Item -Path 'C:\\dev\\maestro.zip' -Force"`, { stdio: 'inherit' });
      
      qlog('[..] PATH ayarlanıyor (User Environment Variable)...');
      execSync(`powershell -Command "$old = [Environment]::GetEnvironmentVariable('PATH', 'User'); if ($old -notlike '*C:\\dev\\maestro\\bin*') { [Environment]::SetEnvironmentVariable('PATH', $old + ';C:\\dev\\maestro\\bin', 'User') }"`, { stdio: 'inherit' });
      
      qlog('[TAMAM] Maestro başarıyla kuruldu (C:\\dev\\maestro\\bin).');
      qlog('[NOT] Yeni terminal açtığınızda "maestro" komutu PATH üzerinden aktif olacaktır.');
    } catch (e) {
      qlog(`[UYARI] Maestro otomatik kurulamadı: ${e.message}`);
      qlog('Lütfen elle kurun: https://github.com/mobile-dev-inc/maestro/releases adresinden maestro.zip indirip C:\\dev\\maestro klasörüne açın.');
    }
  }

  // 5) Patrol CLI kontrolü
  if (resolvePatrol()) {
    qlog('[TAMAM] Patrol CLI kurulu.');
  } else {
    qlog('[EKSİK] Patrol CLI kurulu değil (Flutter derin mod için gerekebilir).');
    qlog('Kurmak için: dart pub global activate patrol_cli');
  }

  qlog('');
  qlog('Kurulum adımları tamamlandı.');
  qlog('Ayrı bir terminalde emülatörü başlatın:');
  qlog(`  "${resolveEmulator() || 'emulator'}" -avd ${avd} -no-boot-anim`);
  qlog('Ardından sağlık kontrolü yapın:');
  qlog('  node cli/testful.mjs doctor');
  
  return true;
}

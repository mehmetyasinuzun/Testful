import { execFileSync, execSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { qlog } from './log.mjs';

const SDK = join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const bin = (p) => join(SDK, p);
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function checkCommand(cmd) {
  try {
    execSync(cmd + ' --version', { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execSync(cmd + ' version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

export function setup({ avd = 'testful' } = {}) {
  qlog('=== testful setup ===');

  // 1) sistem imajı var mı?
  let images = [];
  try {
    images = run(bin('cmdline-tools/latest/bin/avdmanager.bat'), ['list', 'device'])
      .length ? runList() : [];
  } catch {}
  function runList() {
    try {
      const out = run(bin('cmdline-tools/latest/bin/sdkmanager.bat'), ['--list_installed']);
      return out.split('\n').filter((l) => l.includes('system-images;')).map((l) => l.trim().split(/\s+/)[0]);
    } catch { return []; }
  }
  const installed = runList();
  const img = installed.find((i) => /google_apis(_playstore)?;x86_64/.test(i)) || installed[0];
  if (!img) {
    qlog('[EKSİK] Android sistem imajı yok. İnternetin varken:');
    qlog(`  ${bin('cmdline-tools/latest/bin/sdkmanager.bat')} "system-images;android-35;google_apis;x86_64"`);
    return false;
  }
  qlog(`[TAMAM] sistem imajı: ${img}`);

  // 2) AVD var mı? yoksa oluştur (bedava, imajdan)
  let avds = '';
  try { avds = run(bin('cmdline-tools/latest/bin/avdmanager.bat'), ['list', 'avd']); } catch {}
  if (avds.includes(`Name: ${avd}`)) {
    qlog(`[TAMAM] AVD "${avd}" zaten var`);
  } else {
    qlog(`[..] AVD "${avd}" oluşturuluyor (${img})`);
    try {
      execSync(`echo no | "${bin('cmdline-tools/latest/bin/avdmanager.bat')}" create avd -n ${avd} -k "${img}" -d pixel_7`, { stdio: 'inherit', shell: true });
      qlog(`[TAMAM] AVD "${avd}" oluşturuldu`);
    } catch (e) {
      qlog(`[HATA] AVD oluşturulamadı: ${e.message}`);
      return false;
    }
  }

  // 3) Java 17+ kontrolü
  let javaOk = false;
  try {
    const javaVer = execSync('java -version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    javaOk = /version "(1[789]|2[0123])/.test(javaVer) || / (1[789]|2[0123])\./.test(javaVer);
    qlog(`[TAMAM] Java kurulu: ${javaVer.split('\n')[0].trim()}`);
  } catch {
    qlog('[EKSİK] Java 17+ bulunamadı. Java Maestro için zorunludur.');
  }

  // 4) Maestro CLI kontrolü ve otomatik kurulumu
  let maestroOk = checkCommand('maestro');
  const localMaestroBin = 'C:\\dev\\maestro\\bin\\maestro';
  if (!maestroOk && existsSync(localMaestroBin)) {
    maestroOk = true;
    qlog(`[TAMAM] Maestro bulundu: ${localMaestroBin}`);
  }

  if (maestroOk) {
    qlog('[TAMAM] Maestro zaten yüklü.');
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
  let patrolOk = checkCommand('patrol');
  if (patrolOk) {
    qlog('[TAMAM] Patrol CLI kurulu.');
  } else {
    qlog('[EKSİK] Patrol CLI kurulu değil (Flutter derin mod için gerekebilir).');
    qlog('Kurmak için: dart pub global activate patrol_cli');
  }

  qlog('');
  qlog('Kurulum adımları tamamlandı.');
  qlog('Ayrı bir terminalde emülatörü başlatın:');
  qlog(`  ${bin('emulator/emulator.exe')} -avd ${avd} -no-boot-anim`);
  qlog('Ardından sağlık kontrolü yapın:');
  qlog('  node cli/testful.mjs doctor');
  
  return true;
}

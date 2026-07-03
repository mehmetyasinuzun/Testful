import { execFileSync, execSync } from 'node:child_process';
import { join } from 'node:path';
import { qlog } from './log.mjs';

// testful setup — YEREL ve BEDAVA kurulum adımlarını otomatikleştirir:
// mevcut sistem imajından AVD oluşturur ve snapshot'lı başlatır.
// İndirme gerektiren adımları (SDK/Maestro imaj) YAPMAZ; net talimat verir.
const SDK = join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const bin = (p) => join(SDK, p);
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function setup({ avd = 'testful' } = {}) {
  qlog('=== testful setup (yerel, indirmesiz) ===');

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

  qlog('');
  qlog('Sıradaki — emülatörü başlat (ayrı terminalde):');
  qlog(`  ${bin('emulator/emulator.exe')} -avd ${avd} -no-boot-anim`);
  qlog('Sonra:  node cli/testful.mjs doctor   (6/6 yeşil olmalı)');
  qlog('İlk snapshot için (temiz durum):');
  qlog(`  ${bin('platform-tools/adb.exe')} emu avd snapshot save temiz`);
  return true;
}

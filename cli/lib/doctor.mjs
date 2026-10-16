import { execFileSync } from 'node:child_process';
import { qlog } from './log.mjs';
import { ADB } from './device.mjs';
import { findOnPath, freeDiskGb, resolveMaestro, resolvePatrol, spawnArgs } from './platform.mjs';

/** Komut çalışıyor mu? (--version / version dener; shell gerektirmeyen yol tercih edilir) */
function runs(cmd) {
  for (const flag of ['--version', 'version']) {
    try {
      const s = spawnArgs(cmd, [flag]);
      execFileSync(s.cmd, s.args, { stdio: 'ignore', shell: s.shell, timeout: 20000 });
      return true;
    } catch {}
  }
  return false;
}

/**
 * Ortam sağlık kontrolü. Zorunlu eksik varsa false döner.
 * flutter/patrol yalnız Flutter hedefleri için gerekir → uyarı, hata değil.
 */
export function doctor() {
  qlog('=== Testful doctor ===');
  let ok = 0, bad = 0, warn = 0;
  const pass = (msg) => { qlog(`[TAMAM] ${msg}`); ok++; };
  const fail = (msg, action) => { qlog(`[EKSİK] ${msg} -> ${action}`); bad++; };
  const note = (msg, action) => { qlog(`[UYARI] ${msg} -> ${action}`); warn++; };

  // 1) adb + cihaz
  if (!ADB) {
    fail('adb', 'Android SDK platform-tools kur; PATH ya da ANDROID_HOME ayarla');
  } else {
    pass(`adb (${ADB})`);
    try {
      const lines = execFileSync(ADB, ['devices'], { encoding: 'utf8' }).trim().split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean);
      const devices = lines.filter((l) => l.endsWith('\tdevice')).map((l) => l.split('\t')[0]);
      const unauthorized = lines.filter((l) => l.endsWith('\tunauthorized')).map((l) => l.split('\t')[0]);
      if (devices.length) pass(`cihaz: ${devices.join(' ')}`);
      else if (unauthorized.length) fail(`cihaz yetkisiz: ${unauthorized.join(' ')}`, "telefonda 'USB hata ayıklamaya izin ver' diyaloğunu onayla");
      else fail('bağlı cihaz yok', 'emülatör başlat ya da USB ile cihaz bağla');
    } catch (e) {
      fail('cihaz sorgulanamadı', e.message);
    }
  }

  // 2) disk (her platformda statfs)
  const gb = freeDiskGb();
  if (gb === null) note('disk: boş alan ölçülemedi', 'en az 8GB boş alan önerilir');
  else if (gb < 8) fail(`disk: ${gb}GB boş`, 'en az 8GB önerilir — emülatör boot etmeyebilir (gradle cache, flutter clean)');
  else pass(`disk: ${gb}GB boş`);

  // 3) java (Maestro + Gradle)
  if (findOnPath('java') && runs('java')) pass('java');
  else fail('java', 'JDK 17+ gerekli (Maestro için)');

  // 4) maestro
  const maestro = resolveMaestro();
  if (maestro) pass(`maestro (${maestro})`);
  else fail('maestro', 'node cli/testful.mjs setup (ya da https://docs.maestro.dev)');

  // 5) flutter + patrol: yalnız Flutter hedefleri için
  if (findOnPath('flutter')) pass('flutter');
  else note('flutter yok', 'yalnız Flutter uygulamaları için gerekli');
  const patrol = resolvePatrol();
  if (patrol) pass(`patrol_cli (${patrol})`);
  else note('patrol_cli yok', 'Flutter derin mod için: dart pub global activate patrol_cli');

  qlog(`=== sonuç: ${ok} tamam, ${bad} eksik, ${warn} uyarı ===`);
  return bad === 0;
}

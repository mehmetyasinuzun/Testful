import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { qlog } from './log.mjs';
import { ADB } from './device.mjs';

function checkCmd(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execSync(`${cmd} version`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

export function doctor() {
  qlog('=== Testful doctor ===');
  let ok = 0;
  let bad = 0;

  const pass = (msg) => { qlog(`[TAMAM] ${msg}`); ok++; };
  const fail = (msg, action) => { qlog(`[EKSİK] ${msg} -> ${action}`); bad++; };

  // 1) adb
  if (ADB) {
    pass(`adb (${ADB})`);
  } else {
    fail('adb', 'Android SDK platform-tools kur ya da PATH\'e ekle');
  }

  // 2) devices
  if (ADB) {
    try {
      const out = execSync(`"${ADB}" devices`, { encoding: 'utf8' }).trim().split('\n');
      const lines = out.slice(1).map(l => l.trim()).filter(Boolean);
      const devices = lines.filter(l => l.endsWith('\tdevice')).map(l => l.split('\t')[0]);
      const unauthorized = lines.filter(l => l.endsWith('\tunauthorized')).map(l => l.split('\t')[0]);

      if (devices.length > 0) {
        pass(`cihaz: ${devices.join(' ')}`);
      } else if (unauthorized.length > 0) {
        fail(`cihaz yetkisiz: ${unauthorized.join(' ')}`, "telefonda 'USB hata ayıklamaya izin ver' diyaloğunu onayla (bu bilgisayara her zaman izin ver)");
      } else {
        fail('bağlı cihaz yok', 'emülatör başlat ya da USB ile cihaz bağla');
      }
    } catch (e) {
      fail('cihaz sorgulanamadı', `Hata: ${e.message}`);
    }
  }

  // 3) disk space
  try {
    const freeGbStr = execSync('powershell -Command "[Math]::Round(((Get-Volume -DriveLetter C).SizeRemaining) / 1GB)"', { encoding: 'utf8' }).trim();
    const freeGb = parseInt(freeGbStr, 10);
    if (!isNaN(freeGb) && freeGb < 8) {
      fail(`disk: ${freeGb}GB boş`, 'en az 8GB önerilir — emülatör boot etmeyebilir (TEMP maestro*, flutter clean, gradle cache)');
    } else {
      pass(`disk: ${freeGbStr}GB boş`);
    }
  } catch {
    pass('disk: boş alan doğrulanamadı (wmic/powershell hatası)');
  }

  // 4) flutter
  if (checkCmd('flutter')) {
    pass('flutter');
  } else {
    fail('flutter', 'Flutter SDK PATH\'te değil');
  }

  // 5) java
  if (checkCmd('java')) {
    pass('java');
  } else {
    fail('java', 'JDK 17+ gerekli (Maestro için)');
  }

  // 6) maestro
  let maestroPath = '';
  if (checkCmd('maestro')) {
    maestroPath = 'maestro';
  } else if (existsSync('C:\\dev\\maestro\\bin\\maestro')) {
    maestroPath = 'C:\\dev\\maestro\\bin\\maestro';
  } else if (existsSync('C:\\dev\\maestro\\bin\\maestro.bat')) {
    maestroPath = 'C:\\dev\\maestro\\bin\\maestro.bat';
  }

  if (maestroPath) {
    pass(`maestro (${maestroPath})`);
  } else {
    fail('maestro', 'kurulum: node cli/testful.mjs setup (ya da manual references/engines.md)');
  }

  // 7) patrol
  let patrolPath = '';
  const localPatrol = join(process.env.LOCALAPPDATA || '', 'Pub/Cache/bin/patrol.bat');
  if (checkCmd('patrol')) {
    patrolPath = 'patrol';
  } else if (existsSync(localPatrol)) {
    patrolPath = localPatrol;
  }

  if (patrolPath) {
    pass(`patrol_cli (${patrolPath})`);
  } else {
    fail('patrol_cli', 'dart pub global activate patrol_cli');
  }

  qlog(`=== sonuç: ${ok} tamam, ${bad} eksik ===`);
  return bad === 0;
}
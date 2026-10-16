import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDotenv, readJson } from './util.mjs';
import { UsageError } from './errors.mjs';

export const DEFAULTS = { package: null, apk: null, reverse: [], flowTimeoutSec: 300, retries: 2 };

export function loadConfig(appDir = '.') {
  const dir = resolve(appDir);
  const file = join(dir, '.qa', 'testful.json');
  let cfg = {};
  if (existsSync(file)) {
    cfg = readJson(file);
    if (!cfg || typeof cfg !== 'object') throw new UsageError(`geçersiz JSON: ${file}`);
  }
  const merged = { ...DEFAULTS, ...cfg, appDir: dir };
  merged.reverse = (merged.reverse || []).map(Number).filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
  if (merged.apk) merged.apk = resolve(dir, merged.apk);
  return merged;
}

export function loadSecrets(appDir = '.') {
  const file = join(resolve(appDir), '.qa', 'env.local');
  // CI'da sırlar ortamdan gelir (GitHub Secrets → MAESTRO_EMAIL, MAESTRO_PASSWORD…);
  // yerelde .qa/env.local. İkisi de varsa dosya önceliklidir.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => /^MAESTRO_/.test(k) && !/^MAESTRO_CLI_/.test(k) && v));
  if (!existsSync(file)) return env;
  for (const [k, v] of Object.entries(parseDotenv(readFileSync(file, 'utf8')))) {
    env[k.startsWith('MAESTRO_') ? k : `MAESTRO_${k}`] = v;
  }
  return env;
}

export function detectPackage(appDir) {
  const dir = resolve(appDir);
  const gradleFiles = ['android/app/build.gradle', 'android/app/build.gradle.kts', 'app/build.gradle', 'app/build.gradle.kts'];
  for (const g of gradleFiles) {
    const p = join(dir, g);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/applicationId\s*=?\s*["']([\w.]+)["']/);
    if (m) return m[1];
  }
  const appJson = readJson(join(dir, 'app.json'));
  if (appJson?.expo?.android?.package) return appJson.expo.android.package;
  for (const mf of ['android/app/src/main/AndroidManifest.xml', 'app/src/main/AndroidManifest.xml']) {
    const p = join(dir, mf);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/<manifest[^>]*\spackage="([\w.]+)"/);
    if (m) return m[1];
  }
  return null;
}

export function detectFramework(appDir) {
  const dir = resolve(appDir);
  if (existsSync(join(dir, 'pubspec.yaml'))) return 'flutter';
  const pkg = readJson(join(dir, 'package.json'));
  if (pkg && (pkg.dependencies?.['react-native'] || pkg.dependencies?.expo)) return 'react-native';
  if (['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some((f) => existsSync(join(dir, f)))) return 'android-native';
  return 'unknown';
}

export function detectApk(appDir) {
  const dir = resolve(appDir);
  const cands = [
    'build/app/outputs/flutter-apk/app-debug.apk',
    'build/app/outputs/flutter-apk/app-release.apk',
    'android/app/build/outputs/apk/debug/app-debug.apk',
    'app/build/outputs/apk/debug/app-debug.apk',
  ];
  return cands.map((c) => join(dir, c)).find((p) => existsSync(p)) || null;
}

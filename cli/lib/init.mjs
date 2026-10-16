import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, cpSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPackage, detectFramework, detectApk } from './config.mjs';
import { qlog } from './log.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL_SRC = join(TOOL_ROOT, '.claude', 'skills', 'mobile-ux-test');
const IGNORE = ['.qa/results/', '.qa/logs/', '.qa/map/', '.qa/observe/', '.qa/env.local'];

export function init({ appDir = '.', skill = true }) {
  const dir = resolve(appDir);
  const qa = join(dir, '.qa');
  mkdirSync(join(qa, 'scenarios'), { recursive: true });

  const cfgPath = join(qa, 'testful.json');
  if (!existsSync(cfgPath)) {
    const apk = detectApk(dir);
    const cfg = {
      package: detectPackage(dir),
      apk: apk ? relative(dir, apk).replace(/\\/g, '/') : null,
      reverse: [],
      flowTimeoutSec: 300,
      retries: 2,
    };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    qlog(`[INIT] ${relative(dir, cfgPath)} yazıldı (paket: ${cfg.package || 'BULUNAMADI — elle doldur'}, çatı: ${detectFramework(dir)})`);
  } else qlog('[INIT] .qa/testful.json zaten var — dokunulmadı');

  const envEx = join(qa, 'env.local.example');
  if (!existsSync(envEx)) {
    writeFileSync(envEx, '# .qa/env.local olarak kopyala (gitignore\'lu). Flow içinde ${MAESTRO_EMAIL} şeklinde kullan.\nEMAIL=test@example.com\nPASSWORD=degistir\n');
  }

  const gi = join(dir, '.gitignore');
  const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const add = IGNORE.filter((l) => !cur.split(/\r?\n/).includes(l));
  if (add.length) {
    appendFileSync(gi, `${cur && !cur.endsWith('\n') ? '\n' : ''}# testful\n${add.join('\n')}\n`);
    qlog(`[INIT] .gitignore'a eklendi: ${add.join(' ')}`);
  }

  if (skill && existsSync(SKILL_SRC) && resolve(SKILL_SRC) !== resolve(join(dir, '.claude', 'skills', 'mobile-ux-test'))) {
    const dst = join(dir, '.claude', 'skills', 'mobile-ux-test');
    cpSync(SKILL_SRC, dst, { recursive: true });
    const cli = join(TOOL_ROOT, 'cli', 'testful.mjs').replace(/\\/g, '/');
    writeFileSync(join(dst, 'scripts', 'testful.sh'),
      `#!/usr/bin/env bash\nif command -v testful >/dev/null 2>&1; then exec testful "$@"; fi\nexec node "${cli}" "$@"\n`);
    qlog(`[INIT] Claude Code skill'i kopyalandı → ${relative(dir, dst)}`);
  }
  qlog('[INIT] hazır. Sıradaki: testful smoke  →  testful map  →  testful author --from-map  →  testful run');
}

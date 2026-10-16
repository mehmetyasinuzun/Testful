import { mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

let dir = process.env.TESTFUL_LOG_DIR || null;
let toStderr = false;

export function configureLog({ appDir, stderr } = {}) {
  if (appDir && !process.env.TESTFUL_LOG_DIR) dir = join(resolve(appDir), '.qa', 'logs');
  if (stderr !== undefined) toStderr = stderr;
}

export function qlog(msg) {
  (toStderr ? console.error : console.log)(msg);
  try {
    const d = dir || join(process.cwd(), '.qa', 'logs');
    mkdirSync(d, { recursive: true });
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();
    appendFileSync(join(d, `${local.slice(0, 10)}.log`), `${local.slice(0, 19)} ${msg}\n`);
  } catch {}
}

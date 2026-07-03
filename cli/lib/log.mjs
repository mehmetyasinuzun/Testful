import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.TESTFUL_LOG_DIR || '.qa/logs';
let ready = false;
export function qlog(msg) {
  console.log(msg);
  try {
    if (!ready) { mkdirSync(dir, { recursive: true }); ready = true; }
    appendFileSync(join(dir, `${new Date().toISOString().slice(0, 10)}.log`), `${new Date().toISOString().slice(0, 19)} ${msg}\n`);
  } catch {}
}

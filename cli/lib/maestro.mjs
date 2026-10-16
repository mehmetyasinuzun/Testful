import { spawn, execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { which, stripAnsi } from './util.mjs';
import { EnvError } from './errors.mjs';

const IS_WIN = process.platform === 'win32';

export function resolveMaestro({ optional = false } = {}) {
  const home = join(homedir(), '.maestro', 'bin', IS_WIN ? 'maestro.bat' : 'maestro');
  const cands = [process.env.MAESTRO, which('maestro'), home, IS_WIN && 'C:\\dev\\maestro\\bin\\maestro.bat'].filter(Boolean);
  const found = cands.find((p) => existsSync(p));
  if (found || optional) return found || null;
  throw new EnvError('Maestro CLI bulunamadı — "testful setup" çalıştır ya da MAESTRO ortam değişkenine yolunu ver');
}

const quoteWin = (s) => {
  if (/["\r\n]/.test(s)) throw new EnvError(`desteklenmeyen karakter içeren yol: ${s}`);
  return `"${s}"`;
};

const ENV_PATTERNS = [
  /device offline/i, /no (connected )?devices? (found|connected)/i, /unable to (launch|connect)/i,
  /dadb/i, /DEADLINE_EXCEEDED/, /io\.grpc\.StatusRuntimeException: UNAVAILABLE/, /Connection refused/i,
  /Failed to (connect|start) (to )?(the )?driver/i, /Android driver (did not|unreachable)/i,
  /MaestroDriverStartupException/i, /No space left|ENOSPC|yeterli yer yok|not enough space on the disk/i,
  /UnsatisfiedLinkError|ExceptionInInitializerError|java.lang.OutOfMemoryError: Java heap/,
];

export function classifyOutput(out) {
  const text = stripAnsi(out);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const envHit = ENV_PATTERNS.find((re) => re.test(text));
  const reasonLine = lines.find((l) => /FAILED|Element not found|Assertion is false|not visible|is not visible/i.test(l))
    || lines.reverse().find((l) => /error|exception|failed/i.test(l));
  return { envError: !!envHit, reason: reasonLine ? reasonLine.slice(0, 300) : null };
}

/** Maskelenecek sır değerleri: MAESTRO_* içinden şifre/OTP/token/anahtar olanlar. */
export function secretValues(env = {}) {
  return Object.entries(env)
    .filter(([k, v]) => /^MAESTRO_/.test(k) && /PASS|OTP|TOKEN|SECRET|KEY|PIN/i.test(k) && v && String(v).length >= 3)
    .map(([, v]) => String(v))
    .sort((a, b) => b.length - a.length);
}

/** Log/artifact metninden sırları maskeler (Maestro inputText değerini log'a basar). */
export function redact(text, secrets) {
  let out = String(text);
  for (const v of secrets) out = out.split(v).join('***');
  return out;
}

/** Maestro --debug-output klasöründeki metin dosyalarını yerinde maskeler. */
export function redactDir(dir, secrets) {
  if (!secrets.length || !existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    try {
      if (statSync(p).isDirectory()) { redactDir(p, secrets); continue; }
      if (!/\.(json|log|txt|yaml|html)$/i.test(f)) continue;
      const t = readFileSync(p, 'utf8');
      const r = redact(t, secrets);
      if (r !== t) writeFileSync(p, r);
    } catch {}
  }
}

export function runFlow({ flowPath, cwd, debugDir, logPath, serial, env = {}, timeoutSec = 300 }) {
  const maestro = resolveMaestro();
  mkdirSync(debugDir, { recursive: true });
  const args = ['--no-ansi', 'test', flowPath, '--debug-output', debugDir, '--flatten-debug-output'];
  if (serial) args.push('--udid', serial);
  const childEnv = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true', ...env };
  const useShell = IS_WIN && /\.(bat|cmd)$/i.test(maestro);
  const started = Date.now();

  return new Promise((resolveP) => {
    let out = '';
    let timedOut = false;
    const child = useShell
      ? spawn([maestro, ...args].map(quoteWin).join(' '), { cwd, env: childEnv, shell: true, windowsHide: true })
      : spawn(maestro, args, { cwd, env: childEnv });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (IS_WIN) execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
        else child.kill('SIGKILL');
      } catch {}
    }, timeoutSec * 1000);
    let done = false;
    const finish = (code, spawnErr) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (spawnErr) out += `\n[testful] maestro başlatılamadı: ${spawnErr.message}`;
      if (timedOut) out += `\n[testful] zaman aşımı: ${timeoutSec}s`;
      const secrets = secretValues(childEnv);
      writeFileSync(logPath, redact(stripAnsi(out), secrets));
      redactDir(debugDir, secrets);
      const cls = classifyOutput(out);
      resolveP({
        ok: code === 0 && !timedOut && !spawnErr,
        code,
        timedOut,
        envError: !!spawnErr || (code !== 0 && cls.envError),
        reason: timedOut ? `zaman aşımı (${timeoutSec}s)` : cls.reason,
        durationMs: Date.now() - started,
      });
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
  });
}

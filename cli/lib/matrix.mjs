import { shell, tryShell } from './device.mjs';
import { qlog } from './log.mjs';
import { UsageError } from './errors.mjs';

const get = (ns, key) => {
  const v = tryShell('settings', 'get', ns, key).trim();
  return v && v !== 'null' ? v : null;
};
const put = (ns, key, v) => (v === null ? tryShell('settings', 'delete', ns, key) : shell('settings', 'put', ns, key, v));

const STATES = {
  dark() {
    const prev = (tryShell('cmd', 'uimode', 'night').match(/Night mode:\s*(\w+)/) || [])[1] || 'no';
    shell('cmd', 'uimode', 'night', 'yes');
    return () => tryShell('cmd', 'uimode', 'night', prev === 'yes' ? 'yes' : prev === 'auto' ? 'auto' : 'no');
  },
  'large-font'() {
    const prev = get('system', 'font_scale');
    put('system', 'font_scale', '1.3');
    return () => put('system', 'font_scale', prev ?? '1.0');
  },
  landscape() {
    const acc = get('system', 'accelerometer_rotation');
    const rot = get('system', 'user_rotation');
    put('system', 'accelerometer_rotation', '0');
    put('system', 'user_rotation', '1');
    return () => { put('system', 'user_rotation', rot ?? '0'); put('system', 'accelerometer_rotation', acc ?? '0'); };
  },
  offline() {
    shell('svc', 'wifi', 'disable');
    shell('svc', 'data', 'disable');
    return () => { tryShell('svc', 'wifi', 'enable'); tryShell('svc', 'data', 'enable'); };
  },
};

export const MATRIX_STATES = Object.keys(STATES);

export function validateMatrix(list) {
  const bad = list.filter((s) => !STATES[s]);
  if (bad.length) throw new UsageError(`bilinmeyen matris durumu: ${bad.join(', ')} (geçerli: ${MATRIX_STATES.join(', ')})`);
  return list;
}

const pending = new Set();
let hooked = false;

function hookExit() {
  if (hooked) return;
  hooked = true;
  const restoreAll = () => { for (const r of pending) { try { r(); } catch {} } pending.clear(); };
  process.on('exit', restoreAll);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130); });
}

export function applyMatrixState(state) {
  validateMatrix([state]);
  hookExit();
  qlog(`[MATRİS] ${state} uygulanıyor`);
  const undo = STATES[state]();
  const restore = () => {
    if (!pending.has(restore)) return;
    pending.delete(restore);
    qlog(`[MATRİS] ${state} geri alındı`);
    try { undo(); } catch {}
  };
  pending.add(restore);
  return restore;
}

// Sahte Android cihaz + uygulama simülatörü: map() keşif döngüsünü emülatörsüz
// test etmek için. uiautomator benzeri XML üretir; dokunma, geri, kaydırma,
// metin girişi ve basit bir oturum durumunu (login) modeller.
//
// Uygulama tanımı:
//   { pkg, start, screens: { ad: { title, items: [öğe], viewport?: n } } }
//   öğe: { text?, desc?, id?, field?: true, password?: true,
//          to?: 'ekran' | (state) => 'ekran', exit?: true, onTap?: (state) => void }

const W = 1080, ROW = 150, TOP = 200;

export function fakeDevice(app, { log = false } = {}) {
  const state = { stack: [], inApp: false, offset: {}, focus: null, typed: {}, loggedIn: false, taps: [], relaunches: 0, backs: 0 };
  const screen = () => app.screens[state.stack[state.stack.length - 1]];
  const name = () => state.stack[state.stack.length - 1];

  /** O an görünen öğeler (+ ekran koordinatları). */
  function visible() {
    const s = screen();
    const off = state.offset[name()] || 0;
    const items = s.viewport ? s.items.slice(off, off + s.viewport) : s.items;
    return items.map((it, i) => {
      const y1 = TOP + i * ROW;
      return { ...it, bounds: { x1: 40, y1, x2: W - 40, y2: y1 + ROW - 20 } };
    });
  }

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function xml() {
    if (!state.inApp) {
      return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.launcher3" content-desc="" clickable="false" password="false" scrollable="false" bounds="[0,0][${W},2400]" /></hierarchy>`;
    }
    const s = screen();
    const nodes = [];
    nodes.push(`<node index="0" text="${esc(s.title)}" resource-id="" class="android.widget.TextView" package="${app.pkg}" content-desc="" clickable="false" password="false" scrollable="false" bounds="[40,60][${W - 40},180]" />`);
    if (s.viewport) nodes.push(`<node index="1" text="" resource-id="${app.pkg}:id/list" class="androidx.recyclerview.widget.RecyclerView" package="${app.pkg}" content-desc="" clickable="false" password="false" scrollable="true" bounds="[0,${TOP}][${W},${TOP + s.viewport * ROW}]" />`);
    for (const it of visible()) {
      const key = it.id || it.text || it.desc;
      const typed = it.field ? state.typed[`${name()}/${key}`] : undefined;
      const cls = it.field ? 'android.widget.EditText' : 'android.widget.Button';
      const text = it.field ? (typed ? (it.password ? '•'.repeat(typed.length) : typed) : it.text || '') : it.text || '';
      const b = it.bounds;
      nodes.push(`<node index="2" text="${esc(text)}" resource-id="${it.id ? `${app.pkg}:id/${it.id}` : ''}" class="${cls}" package="${app.pkg}" content-desc="${esc(it.desc)}" clickable="true" password="${it.password ? 'true' : 'false'}" scrollable="false" bounds="[${b.x1},${b.y1}][${b.x2},${b.y2}]" />`);
    }
    return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" class="android.widget.FrameLayout" package="${app.pkg}" content-desc="" clickable="false" password="false" scrollable="false" bounds="[0,0][${W},2400]">${nodes.join('')}</node></hierarchy>`;
  }

  const fieldVal = (screenName, key) => state.typed[`${screenName}/${key}`] || '';

  const dev = {
    state,
    requireDevice: () => 'fake-5554',
    dumpTree: () => xml(),
    screenshot: () => Buffer.from('PNG'),
    sleepOnDevice: () => {},
    sleep: async () => {},
    hideKb: () => {},
    launch: (pkg, { clear = false } = {}) => {
      if (clear) { state.typed = {}; state.loggedIn = false; state.offset = {}; }
      state.stack = [typeof app.start === 'function' ? app.start(state) : app.start];
      state.inApp = true;
      state.relaunches++;
    },
    back: () => {
      state.backs++;
      if (!state.inApp) return;
      if (state.stack.length > 1) state.stack.pop();
      else state.inApp = false; // kökten geri → başlatıcıya
    },
    tap: (x, y) => {
      if (!state.inApp) return;
      const it = visible().find((v) => x >= v.bounds.x1 && x <= v.bounds.x2 && y >= v.bounds.y1 && y <= v.bounds.y2);
      if (!it) return;
      state.taps.push(it.text || it.desc || it.id || '?');
      if (it.field) { state.focus = `${name()}/${it.id || it.text || it.desc}`; return; }
      if (it.onTap) it.onTap(state, fieldVal);
      if (it.exit) { state.inApp = false; return; }
      const to = typeof it.to === 'function' ? it.to(state, fieldVal) : it.to;
      if (to && to !== name()) state.stack.push(to);
    },
    clearField: () => { if (state.focus) state.typed[state.focus] = ''; },
    typeText: (t) => { if (state.focus) state.typed[state.focus] = (state.typed[state.focus] || '') + t; },
    swipe: (x1, y1, x2, y2) => {
      const s = state.inApp && screen();
      if (!s?.viewport || y2 >= y1) return;
      const max = Math.max(0, s.items.length - s.viewport);
      state.offset[name()] = Math.min(max, (state.offset[name()] || 0) + Math.max(1, s.viewport - 1));
    },
  };
  return dev;
}

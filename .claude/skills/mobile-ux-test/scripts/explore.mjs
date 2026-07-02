// Testful Explorer v0 — AI'sız keşif crawler'ı (ölçüm çekirdeği).
// APK'yı kurulu varsayar; uygulamayı otonom gezer, her benzersiz ekran için
// screenshot + a11y ağacı toplar, ekran-geçiş grafiğini (graph.json) çıkarır.
// Sürüş tamamen adb iledir (input tap/keyevent, uiautomator dump, screencap).
// Kullanım: node explore.mjs <package> <run_dir> [maxActions=80]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const [pkg, runDir, maxActionsArg] = process.argv.slice(2);
if (!pkg || !runDir) { console.error('kullanım: explore.mjs <package> <run_dir> [maxActions]'); process.exit(2); }
const MAX_ACTIONS = Number(maxActionsArg || 80);
const NO_NEW_LIMIT = 20;
const ADB = process.env.ADB || join(process.env.LOCALAPPDATA || '', 'Android/Sdk/platform-tools/adb.exe');

const screensDir = join(runDir, 'screens');
const treesDir = join(runDir, 'trees');
for (const d of [runDir, screensDir, treesDir]) mkdirSync(d, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync(ADB, a, { maxBuffer: 32e6 });
const adbStr = (...a) => adb(...a).toString('utf8');

const AVOID = /delete|remove|uninstall|log ?out|sign ?out|sil|çıkış|kaldır/i;

function dumpTree() {
  for (let i = 0; i < 3; i++) {
    try {
      const out = adbStr('exec-out', 'uiautomator', 'dump', '/dev/tty');
      const xml = out.slice(out.indexOf('<?xml'), out.lastIndexOf('>') + 1);
      if (xml.includes('<hierarchy')) return xml;
    } catch {}
    execFileSync(ADB, ['shell', 'sleep', '0.6']);
  }
  return '';
}

function parseNodes(xml) {
  const nodes = [];
  const re = /<node ([^>]+?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = m[1];
    const attr = (k) => (a.match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || '';
    const b = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    nodes.push({
      pkg: attr('package'),
      cls: attr('class'),
      desc: attr('content-desc').replace(/&#10;/g, '\n'),
      text: attr('text'),
      clickable: attr('clickable') === 'true',
      password: attr('password') === 'true',
      scrollable: attr('scrollable') === 'true',
      bounds: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null,
    });
  }
  return nodes;
}

const norm = (s) => s.replace(/\d/g, '#').slice(0, 40);
function signature(nodes) {
  const own = nodes.filter((n) => n.pkg === pkg);
  const feats = own.map((n) => norm(n.desc || n.text)).filter(Boolean).sort();
  const clickables = own.filter((n) => n.clickable).length;
  return createHash('sha1').update(feats.join('|') + '::' + clickables).digest('hex').slice(0, 10);
}

function clickablesOf(nodes) {
  return nodes
    .filter((n) => n.pkg === pkg && n.clickable && n.bounds)
    .filter((n) => n.bounds.x2 - n.bounds.x1 > 20 && n.bounds.y2 - n.bounds.y1 > 20)
    .map((n, i) => ({
      label: (n.desc || n.text || `${n.cls.split('.').pop()}#${i}`).split('\n')[0].slice(0, 50),
      cx: Math.floor((n.bounds.x1 + n.bounds.x2) / 2),
      cy: Math.floor((n.bounds.y1 + n.bounds.y2) / 2),
      risky: AVOID.test(n.desc + ' ' + n.text),
    }));
}

function screenshot(file) {
  writeFileSync(file, adb('exec-out', 'screencap', '-p'));
}

const reverse = () => { try { adb('reverse', 'tcp:8080', 'tcp:8080'); } catch {} };

let LAUNCH_ACT = '';
try { LAUNCH_ACT = adbStr('shell', 'cmd', 'package', 'resolve-activity', '--brief', pkg).trim().split('\n').pop().trim(); } catch {}
const relaunch = () => {
  try {
    if (LAUNCH_ACT.includes('/')) adb('shell', 'am', 'start', '-n', LAUNCH_ACT);
    else adb('shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1');
  } catch {}
};

// ANR/sistem dialog'u varsa kapat (uygulamayı canlı tut = "Wait")
function dismissSystemDialog(xml) {
  if (/isn't responding|yanıt vermiyor|Application Not Responding/i.test(xml)) {
    const nodes = parseNodes(xml);
    const wait = nodes.find((n) => /^Wait$|^Bekle$/i.test(n.text || n.desc) && n.bounds);
    if (wait) { adb('shell', 'input', 'tap', String((wait.bounds.x1 + wait.bounds.x2) / 2 | 0), String((wait.bounds.y1 + wait.bounds.y2) / 2 | 0)); return true; }
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); return true;
  }
  return false;
}

async function waitForApp(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const xml = dumpTree();
    if (dismissSystemDialog(xml)) { await sleep(1500); continue; }
    if (parseNodes(xml).some((n) => n.pkg === pkg)) return true;
    await sleep(1200);
  }
  return false;
}

const graph = { nodes: {}, edges: [], stats: { actions: 0, relaunches: 0, backs: 0 } };
const tried = {}; // sig -> Set(label)

async function observe() {
  const xml = dumpTree();
  const nodes = parseNodes(xml);
  const own = nodes.filter((n) => n.pkg === pkg);
  if (!own.length) return { sig: null, nodes };
  const sig = signature(nodes);
  if (!graph.nodes[sig]) {
    const shot = join(screensDir, `${sig}.png`);
    screenshot(shot);
    writeFileSync(join(treesDir, `${sig}.xml`), xml);
    graph.nodes[sig] = {
      sig,
      screenshot: `screens/${sig}.png`,
      descs: [...new Set(own.map((n) => (n.desc || n.text).split('\n')[0]).filter(Boolean))].slice(0, 12),
      clickableCount: own.filter((n) => n.clickable).length,
      blockers: own.some((n) => n.password) ? ['login'] : [],
      order: Object.keys(graph.nodes).length + 1,
    };
    tried[sig] = new Set();
    console.log(`[EKRAN ${graph.nodes[sig].order}] ${sig} — ${graph.nodes[sig].descs.slice(0, 4).join(' · ')}`);
  }
  return { sig, nodes };
}

let lastNewAt = 0;
async function main() {
  reverse();
  adb('shell', 'am', 'force-stop', pkg);
  adb('shell', 'pm', 'clear', pkg);
  await sleep(1000);
  reverse();
  relaunch();
  if (!(await waitForApp(25000))) { console.log('HATA: uygulama açılmadı (ANR/kurulum?)'); writeFileSync(join(runDir, 'graph.json'), JSON.stringify(graph)); return; }
  await sleep(1500);

  let cur = await observe();
  let prevCount = 1;

  for (let act = 1; act <= MAX_ACTIONS; act++) {
    if (!cur.sig) { // uygulama dışına düştük
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      graph.stats.backs++;
      await sleep(900);
      cur = await observe();
      if (!cur.sig) { relaunch(); graph.stats.relaunches++; reverse(); await sleep(3500); cur = await observe(); }
      if (!cur.sig) break;
      continue;
    }
    const sig = cur.sig;
    const cands = clickablesOf(cur.nodes).filter((c) => !tried[sig].has(c.label) && !c.risky);
    if (!cands.length) {
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      graph.stats.backs++;
      await sleep(900);
      const nxt = await observe();
      if (nxt.sig === sig) break; // geri de çıkaramıyor → bitti
      cur = nxt;
      continue;
    }
    const el = cands[0];
    tried[sig].add(el.label);
    adb('shell', 'input', 'tap', String(el.cx), String(el.cy));
    graph.stats.actions++;
    await sleep(1300);
    const nxt = await observe();
    if (nxt.sig && nxt.sig !== sig) {
      graph.edges.push({ from: sig, to: nxt.sig, via: el.label });
      console.log(`  ${sig} --[${el.label}]--> ${nxt.sig}`);
    }
    const count = Object.keys(graph.nodes).length;
    if (count > prevCount) { prevCount = count; lastNewAt = act; }
    if (act - lastNewAt >= NO_NEW_LIMIT) { console.log(`(son ${NO_NEW_LIMIT} eylemde yeni ekran yok — duruyorum)`); break; }
    cur = nxt.sig ? nxt : cur;
  }

  graph.stats.screens = Object.keys(graph.nodes).length;
  graph.stats.edges = graph.edges.length;
  writeFileSync(join(runDir, 'graph.json'), JSON.stringify(graph, null, 2));
  console.log(`\nkeşif bitti: ${graph.stats.screens} ekran, ${graph.stats.edges} geçiş, ${graph.stats.actions} dokunuş`);
  console.log(`graph: ${join(runDir, 'graph.json')}`);
}

await main();

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dumpTree, screenshot, tap, typeText, clearField, back, hideKb, launch, requireDevice, isInstalled, clearLogcat, dumpLogcat, stabilize, collapseShade, reverse,
} from './device.mjs';
import { parseNodes, interactives, screenSignature, elementKey } from './tree.mjs';
import { scanLogcat } from './logcat.mjs';
import { qlog } from './log.mjs';
import { sleep } from './util.mjs';
import { EnvError } from './errors.mjs';

export const RISKY = /delete|remove|uninstall|log ?out|sign ?out|deactivate|purchase|buy|pay\b|subscribe|\bsil\b|sil$|çıkış|kaldır|sıfırla|reset|satın|öde|abone/i;

function dismissSystemDialog(nodes) {
  const alert = nodes.find((n) => /isn't responding|yanıt vermiyor|keeps stopping|durduruldu/i.test(n.text + n.desc));
  if (!alert) return false;
  const btn = nodes.find((n) => /^(Wait|Bekle|Close app|Uygulamayı kapat|OK|Tamam)$/i.test((n.text || n.desc).trim()) && n.bounds);
  if (btn) tap((btn.bounds.x1 + btn.bounds.x2) / 2, (btn.bounds.y1 + btn.bounds.y2) / 2);
  else back();
  return true;
}

export function fieldPlan(field, secrets = {}) {
  const hay = `${field.full_text || ''} ${field.resource_id || ''}`;
  const secretVar = field.password ? 'MAESTRO_PASSWORD' : /mail|e-?posta|@/i.test(hay) ? 'MAESTRO_EMAIL' : null;
  if (secretVar && secrets[secretVar]) return { type: secrets[secretVar], record: { secretVar } };
  if (field.value) return { type: null, record: { kept: true } };
  const text = field.password ? 'Test1234!' : secretVar ? 'test@example.com' : 'Test';
  return { type: text, record: { text } };
}

const mmEsc = (s) => String(s || '').replace(/["\[\]{}()|<>#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

export function renderMermaid(graph) {
  const id = (sig) => `S${graph.nodes[sig]?.order ?? sig}`;
  const L = ['flowchart TD'];
  for (const n of Object.values(graph.nodes)) {
    const title = n.interactives.filter((e) => e.label).slice(0, 2).map((e) => e.label).join(' · ') || n.sig;
    L.push(`  ${id(n.sig)}["${n.order}. ${mmEsc(title)}<br/>${n.tried}/${n.total} denendi"]`);
  }
  for (const e of graph.edges) L.push(`  ${id(e.from)} -->|"${mmEsc(e.via)}"| ${id(e.to)}`);
  if (graph.start) L.push(`  style ${id(graph.start)} stroke-width:3px`);
  return L.join('\n');
}

export async function map({ pkg, out, maxActions = 80, clear = true, reversePorts = [], secrets = {} }) {
  requireDevice();
  reverse(reversePorts);
  if (!isInstalled(pkg)) throw new EnvError(`${pkg} cihazda kurulu değil`);
  const screensDir = join(out, 'screens');
  mkdirSync(screensDir, { recursive: true });
  const unstabilize = stabilize();

  const graph = { schema: 'testful/graph@1', package: pkg, start: null, nodes: {}, edges: [], stats: { actions: 0, backs: 0, relaunches: 0, typed: 0, risky_skipped: 0 } };
  const tried = {};
  const typedOn = {};
  const riskySeen = new Set();
  const edgeSeen = new Set();
  const candidates = (sig) => {
    const n = graph.nodes[sig];
    if (!n) return [];
    const open = n.interactives.filter((e) => e.kind !== 'field' && !tried[sig].has(elementKey(e)) && !(e.label && RISKY.test(e.full_text || e.label)));
    return [...open.filter((e) => e.label), ...open.filter((e) => !e.label)];
  };

  const observeHere = () => {
    let xml;
    try { xml = dumpTree(); } catch { return { sig: null, transient: true }; }
    const nodes = parseNodes(xml);
    if (dismissSystemDialog(nodes)) return { sig: null, dialog: true };
    if (!nodes.some((n) => n.pkg === pkg)) {
      if (nodes.some((n) => n.pkg === 'com.android.systemui')) collapseShade();
      return { sig: null, foreign: true };
    }
    const sig = screenSignature(nodes, pkg);
    if (!graph.screen) {
      const w = Math.max(...nodes.map((n) => n.bounds?.x2 || 0));
      const h = Math.max(...nodes.map((n) => n.bounds?.y2 || 0));
      if (w > 0 && h > 0) graph.screen = { w, h };
    }
    if (!graph.nodes[sig]) {
      writeFileSync(join(screensDir, `${sig}.png`), screenshot());
      writeFileSync(join(screensDir, `${sig}.xml`), xml);
      const els = interactives(nodes, pkg);
      graph.nodes[sig] = {
        sig,
        order: Object.keys(graph.nodes).length + 1,
        screenshot: `screens/${sig}.png`,
        anchor: els.find((e) => e.selector && e.kind !== 'tab' && e.kind !== 'field') || els.find((e) => e.selector) || null,
        interactives: els,
        total: els.filter((e) => e.kind !== 'field').length,
        tried: 0,
      };
      tried[sig] = new Set();
      typedOn[sig] = [];
      qlog(`[EKRAN ${graph.nodes[sig].order}] ${sig} — ${els.filter((e) => e.label).slice(0, 4).map((e) => e.label).join(' · ') || '(etiketsiz)'}`);
    }
    return { sig };
  };

  clearLogcat();
  launch(pkg, { clear });
  await sleep(5000);
  let cur = observeHere();
  for (let i = 0; !cur.sig && i < 8; i++) { await sleep(1500); cur = observeHere(); }
  if (!cur.sig) unstabilize();
  if (!cur.sig) throw new EnvError('uygulama açılmadı ya da ön plana gelmedi');
  graph.start = cur.sig;

  let stop = 'eylem bütçesi doldu';
  let lastNewAt = 0;
  let screenCount = 1;
  for (let act = 1; act <= maxActions; act++) {
    if (!cur.sig) {
      if (cur.transient) { await sleep(1500); cur = observeHere(); if (cur.sig) continue; }
      if (!cur.dialog) { back(); graph.stats.backs++; }
      await sleep(1000);
      cur = observeHere();
      if (!cur.sig) { launch(pkg); graph.stats.relaunches++; await sleep(4000); cur = observeHere(); }
      if (!cur.sig) { if (cur.transient) continue; stop = 'uygulamaya geri dönülemedi'; break; }
      continue;
    }
    const sig = cur.sig;
    const node = graph.nodes[sig];
    for (const e of node.interactives) {
      if (e.label && RISKY.test(e.full_text || e.label) && !riskySeen.has(`${sig}:${elementKey(e)}`)) {
        riskySeen.add(`${sig}:${elementKey(e)}`);
        graph.stats.risky_skipped++;
      }
    }
    const cands = candidates(sig);

    if (!cands.length) {
      const field = node.interactives.find((e) => e.kind === 'field' && !typedOn[sig].some((t) => t.y === e.center.y));
      if (field) {
        const plan = fieldPlan(field, secrets);
        typedOn[sig].push({ x: field.center.x, y: field.center.y, selector: field.selector || null, match: field.match || null, ...plan.record });
        if (plan.type !== null) {
          tap(field.center.x, field.center.y);
          await sleep(500);
          clearField((field.value || '').length);
          typeText(plan.type);
          hideKb();
          graph.stats.typed++;
          for (const e of node.interactives) if (e.kind !== 'field') tried[sig].delete(elementKey(e));
          await sleep(700);
          cur = observeHere();
        }
        continue;
      }
      const hop = graph.edges.find((e) => e.from === sig && e.to !== sig && candidates(e.to).length > 0);
      if (hop) {
        tap(hop.tap.center.x, hop.tap.center.y);
        graph.stats.actions++;
        await sleep(1300);
        cur = observeHere();
        continue;
      }
      back();
      graph.stats.backs++;
      await sleep(1000);
      const nxt = observeHere();
      if (nxt.sig === sig) { stop = 'takılı ekran: geri tuşu etkisiz ve denenmemiş öğe yok'; break; }
      cur = nxt;
      continue;
    }

    const el = cands[0];
    const key = elementKey(el);
    tried[sig].add(key);
    tap(el.center.x, el.center.y);
    graph.stats.actions++;
    await sleep(1300);
    const nxt = observeHere();
    if (nxt.sig && nxt.sig !== sig) {
      const ek = `${sig}>${nxt.sig}>${key}`;
      if (!edgeSeen.has(ek)) {
        edgeSeen.add(ek);
        graph.edges.push({
          from: sig, to: nxt.sig, via: el.label || key,
          tap: { selector: el.selector || null, match: el.match || null, center: el.center },
          inputs: typedOn[sig].filter((t) => !t.kept).map((t) => ({ ...t })),
        });
        qlog(`  ${sig} --[${el.label || key}]--> ${nxt.sig}`);
      }
    }
    const count = Object.keys(graph.nodes).length;
    if (count > screenCount) { screenCount = count; lastNewAt = act; }
    if (act - lastNewAt >= 20) { stop = '20 eylemdir yeni ekran yok'; break; }
    cur = nxt;
  }

  unstabilize();
  graph.stats.stop_reason = stop;
  qlog(`(durdu: ${stop})`);
  let triedTotal = 0;
  let allTotal = 0;
  for (const sig of Object.keys(graph.nodes)) {
    const n = graph.nodes[sig];
    n.tried = Math.min(tried[sig].size, n.total);
    triedTotal += n.tried;
    allTotal += n.total;
  }
  const crashes = scanLogcat(dumpLogcat(), { pkg }).hits;
  graph.crashes = crashes.map((h) => ({ type: h.type, title: h.title, stack: h.stack, count: h.count }));
  graph.stats.screens = Object.keys(graph.nodes).length;
  graph.stats.edges = graph.edges.length;
  graph.stats.coverage_pct = allTotal ? Math.round((100 * triedTotal) / allTotal) : 0;
  writeFileSync(join(out, 'graph.json'), JSON.stringify(graph, null, 2));
  writeFileSync(join(out, 'map.md'), `# Uygulama haritası — ${pkg}\n\n${graph.stats.screens} ekran · ${graph.stats.edges} geçiş · kapsama ~%${graph.stats.coverage_pct} · riskli atlanan ${graph.stats.risky_skipped}\n\n\`\`\`mermaid\n${renderMermaid(graph)}\n\`\`\`\n`);
  qlog(`harita: ${graph.stats.screens} ekran · ${graph.stats.edges} geçiş · ${graph.stats.actions} dokunuş · kapsama ~%${graph.stats.coverage_pct}`);
  if (crashes.length) qlog(`[UYARI] keşif sırasında ${crashes.length} hata imzası: ${crashes.map((c) => c.title).join(' · ')}`);
  qlog(`graph.json + map.md → ${out}`);
  return graph;
}

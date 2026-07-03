import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dumpTree, screenshot, tap, typeText, back, hideKb, launch, requireDevice, sleepOnDevice } from './device.mjs';
import { parseNodes, interactives, screenSignature } from './tree.mjs';
import { qlog } from './log.mjs';

const AVOID = /delete|remove|uninstall|log ?out|sign ?out|sil\b|çıkış|kaldır|sıfırla|reset/i;

function dismissSystemDialog(nodes) {
  const alert = nodes.find((n) => /isn't responding|yanıt vermiyor/i.test(n.text + n.desc));
  if (!alert) return false;
  const wait = nodes.find((n) => /^(Wait|Bekle)$/i.test((n.text || n.desc).trim()) && n.bounds);
  if (wait) tap((wait.bounds.x1 + wait.bounds.x2) >> 1, (wait.bounds.y1 + wait.bounds.y2) >> 1);
  else back();
  return true;
}

export async function map({ pkg, out, maxActions = 80, clear = true }) {
  requireDevice();
  const screensDir = join(out, 'screens');
  mkdirSync(screensDir, { recursive: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const graph = { package: pkg, nodes: {}, edges: [], stats: { actions: 0, backs: 0, relaunches: 0, typed: 0, risky_skipped: 0 } };
  const tried = {};

  const observeHere = () => {
    let xml;
    try { xml = dumpTree(); } catch { return { sig: null, nodes: [], transient: true }; }
    const nodes = parseNodes(xml);
    if (dismissSystemDialog(nodes)) return { sig: null, nodes, dialog: true };
    if (!nodes.some((n) => n.pkg === pkg)) return { sig: null, nodes };
    const sig = screenSignature(nodes, pkg);
    if (!graph.nodes[sig]) {
      writeFileSync(join(screensDir, `${sig}.png`), screenshot());
      writeFileSync(join(screensDir, `${sig}.xml`), xml);
      const els = interactives(nodes, pkg);
      graph.nodes[sig] = {
        sig,
        order: Object.keys(graph.nodes).length + 1,
        screenshot: `screens/${sig}.png`,
        anchor: els.find((e) => e.label && e.kind !== 'tab')?.selector || els.find((e) => e.label)?.selector || null,
        interactives: els,
        total: els.length,
      };
      tried[sig] = new Set();
      qlog(`[EKRAN ${graph.nodes[sig].order}] ${sig} — ${els.filter((e) => e.label).slice(0, 4).map((e) => e.label).join(' · ')}`);
    }
    return { sig, nodes };
  };

  launch(pkg, { clear });
  sleepOnDevice(6);
  let cur = observeHere();
  for (let i = 0; !cur.sig && i < 8; i++) { await sleep(1500); cur = observeHere(); }
  if (!cur.sig) throw new Error('uygulama açılmadı');

  let lastNewAt = 0, screenCount = 1;
  for (let act = 1; act <= maxActions; act++) {
    if (!cur.sig) {
      if (cur.transient) { await sleep(1500); cur = observeHere(); if (cur.sig) continue; }
      if (!cur.dialog) { back(); graph.stats.backs++; }
      await sleep(1000);
      cur = observeHere();
      if (!cur.sig) { launch(pkg, { clear: false }); graph.stats.relaunches++; sleepOnDevice(4); cur = observeHere(); }
      if (!cur.sig) { if (cur.transient) continue; break; }
      continue;
    }
    const sig = cur.sig;
    const node = graph.nodes[sig];
    const risky = node.interactives.filter((e) => e.label && AVOID.test(e.full_text || e.label));
    graph.stats.risky_skipped += risky.filter((e) => !tried[sig].has(e.label)).length ? 0 : 0;
    const cands = node.interactives.filter((e) => e.kind !== 'field' && !tried[sig].has(e.label || `${e.class}@${e.center.x},${e.center.y}`) && !(e.label && AVOID.test(e.full_text || e.label)));

    if (!cands.length) {
      // engel sezgisi: buton kalmadıysa ve ekranda alan varsa doldurup yeniden dene
      const field = node.interactives.find((e) => e.kind === 'field' && !tried[sig].has(`typed:${e.center.y}`));
      if (field) {
        tap(field.center.x, field.center.y);
        await sleep(600);
        typeText('Test');
        hideKb();
        graph.stats.typed++;
        tried[sig].add(`typed:${field.center.y}`);
        node.interactives.forEach((e) => { if (e.kind !== 'field') tried[sig].delete(e.label || `${e.class}@${e.center.x},${e.center.y}`); });
        await sleep(800);
        cur = observeHere();
        continue;
      }
      back();
      graph.stats.backs++;
      await sleep(1000);
      const nxt = observeHere();
      if (nxt.sig === sig) break;
      cur = nxt;
      continue;
    }

    const el = cands[0];
    const key = el.label || `${el.class}@${el.center.x},${el.center.y}`;
    tried[sig].add(key);
    tap(el.center.x, el.center.y);
    graph.stats.actions++;
    await sleep(1400);
    const nxt = observeHere();
    if (nxt.sig && nxt.sig !== sig) {
      graph.edges.push({ from: sig, to: nxt.sig, via: el.label || key, via_selector: el.selector || null });
      qlog(`  ${sig} --[${el.label || key}]--> ${nxt.sig}`);
    }
    const count = Object.keys(graph.nodes).length;
    if (count > screenCount) { screenCount = count; lastNewAt = act; }
    if (act - lastNewAt >= 20) { qlog('(20 eylemdir yeni ekran yok — duruyorum)'); break; }
    cur = nxt.sig ? nxt : cur;
  }

  let triedTotal = 0, allTotal = 0;
  for (const sig of Object.keys(graph.nodes)) {
    const t = [...tried[sig]].filter((k) => !k.startsWith('typed:')).length;
    graph.nodes[sig].tried = t;
    triedTotal += Math.min(t, graph.nodes[sig].total);
    allTotal += graph.nodes[sig].total;
  }
  graph.stats.screens = Object.keys(graph.nodes).length;
  graph.stats.edges = graph.edges.length;
  graph.stats.coverage_pct = allTotal ? Math.round((100 * triedTotal) / allTotal) : 0;
  writeFileSync(join(out, 'graph.json'), JSON.stringify(graph, null, 2));
  qlog(`harita: ${graph.stats.screens} ekran · ${graph.stats.edges} geçiş · ${graph.stats.actions} dokunuş · kapsama ~%${graph.stats.coverage_pct}`);
  qlog(`graph.json → ${join(out, 'graph.json')}`);
  return graph;
}

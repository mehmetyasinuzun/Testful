import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { qlog } from './log.mjs';
import { readJson } from './util.mjs';
import { yamlSingle } from './tree.mjs';
import { UsageError } from './errors.mjs';

const pct = (v, total) => `${Math.max(1, Math.min(99, Math.round((100 * v) / total)))}%`;

function pointOf(el, screen) {
  if (screen) return `"${pct(el.center.x, screen.w)},${pct(el.center.y, screen.h)}"`;
  return `"${el.center.x},${el.center.y}"`;
}

export function selectorBlock(cmd, el, screen, indent = '') {
  if (el?.match === 'id') return [`${indent}- ${cmd}:`, `${indent}    ${el.selector}`];
  if (el?.selector && !el.ambiguous) return [`${indent}- ${cmd}: ${el.selector}`];
  if (cmd === 'tapOn' && el?.center) return [`${indent}- tapOn:`, `${indent}    point: ${pointOf(el, screen)}`];
  return [];
}

function waitBlock(el, timeout) {
  if (!el?.selector || el.ambiguous) return [];
  if (el.match === 'id') return ['- extendedWaitUntil:', '    visible:', `      ${el.selector}`, `    timeout: ${timeout}`];
  return ['- extendedWaitUntil:', `    visible: ${el.selector}`, `    timeout: ${timeout}`];
}

export function shortestPaths(graph) {
  const adj = {};
  for (const e of graph.edges) (adj[e.from] ||= []).push(e);
  const prev = { [graph.start]: null };
  const queue = [graph.start];
  while (queue.length) {
    const s = queue.shift();
    for (const e of adj[s] || []) {
      if (e.to in prev) continue;
      prev[e.to] = e;
      queue.push(e.to);
    }
  }
  const paths = {};
  for (const sig of Object.keys(prev)) {
    const path = [];
    for (let e = prev[sig]; e; e = prev[e.from]) path.unshift(e);
    paths[sig] = path;
  }
  return paths;
}

function screenTitle(node) {
  return node?.interactives?.filter((e) => e.label && e.kind !== 'field').slice(0, 2).map((e) => e.label).join(' · ') || node?.sig || '?';
}

function writePair(out, id, oracle, flow, force) {
  const flowPath = join(out, `${id}.flow.yaml`);
  if (existsSync(flowPath) && !force) return false;
  writeFileSync(join(out, `${id}.yaml`), oracle);
  writeFileSync(flowPath, flow);
  return true;
}

export function flowFromPath({ id, pkg, graph, path, target }) {
  const screen = graph.screen;
  const startNode = graph.nodes[graph.start];
  const L = [`appId: ${pkg}`, 'tags:', '  - testful-auto', '---', '- clearState', '- launchApp:', '    stopApp: false'];
  L.push(...waitBlock(startNode?.anchor, 20000));
  const steps = [];
  for (const e of path) {
    for (const inp of e.inputs || []) {
      L.push(...selectorBlock('tapOn', { selector: inp.selector, match: inp.match, center: { x: inp.x, y: inp.y } }, screen));
      const value = inp.secretVar ? `\${${inp.secretVar}}` : yamlSingle(inp.text || '');
      L.push('- eraseText: 200', `- inputText: ${value}`, '- hideKeyboard');
      steps.push({ do: `alana ${inp.secretVar || `"${inp.text}"`} yaz`, expect: 'metin alana girilir' });
    }
    L.push(...selectorBlock('tapOn', { ...e.tap, center: e.tap?.center }, screen));
    steps.push({ do: `"${e.via}" dokun`, expect: `${screenTitle(graph.nodes[e.to])} ekranı açılır` });
  }
  L.push(...waitBlock(target?.anchor, 10000));
  if (target?.anchor?.selector && !target.anchor.ambiguous) L.push(...selectorBlock('assertVisible', target.anchor, screen));
  L.push(`- takeScreenshot: ${id}-${target?.sig || 'son'}`);
  return { flow: L.join('\n') + '\n', steps };
}

function oracleYaml({ id, title, pkg, steps, source }) {
  const L = [`id: ${id}`, `title: ${yamlSingle(title)}`, 'archetype: navigation', 'tier: core', 'engine: maestro', `package: ${pkg}`, `source: ${source}`, 'preconditions:', '  - reset-app', 'steps:'];
  L.push('  - do: launch', "    expect: 'uygulama çökmeden açılır'");
  for (const s of steps) L.push(`  - do: ${yamlSingle(s.do)}`, `    expect: ${yamlSingle(s.expect)}`);
  L.push('    shot: true');
  return L.join('\n') + '\n';
}

export function authorFromMap({ mapDir, out, force = false }) {
  const graph = readJson(join(mapDir, 'graph.json'));
  if (!graph?.start) throw new UsageError(`geçerli graph.json yok: ${mapDir} — önce "testful map --pkg <paket>"`);
  mkdirSync(out, { recursive: true });
  const pkg = graph.package;
  const paths = shortestPaths(graph);
  let written = 0;
  let skipped = 0;
  for (const [sig, path] of Object.entries(paths)) {
    const target = graph.nodes[sig];
    const id = path.length ? `NAV-${sig}` : 'LAUNCH-00';
    const title = path.length ? `${screenTitle(target)} ekranına ulaş (${path.length} adım)` : 'Uygulama açılır ve ilk ekran görünür';
    const { flow, steps } = flowFromPath({ id, pkg, graph, path, target });
    if (writePair(out, id, oracleYaml({ id, title, pkg, steps, source: 'testful-author/map' }), flow, force)) {
      written++;
      qlog(`[AUTHOR] ${id} — ${title}`);
    } else skipped++;
  }
  const unreachable = Object.keys(graph.nodes).filter((s) => !(s in paths));
  qlog(`[AUTHOR] ${written} senaryo yazıldı, ${skipped} mevcut olduğu için atlandı${unreachable.length ? `, ${unreachable.length} ekrana yol yok` : ''} → ${out}`);
  return { written, skipped, unreachable };
}

export function authorFromObserve({ dir, out, pkg, force = false }) {
  if (!existsSync(dir)) throw new UsageError(`girdi klasörü yok: ${dir}`);
  mkdirSync(out, { recursive: true });
  let written = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    let data;
    try { data = JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { continue; }
    if (!data?.sig || !Array.isArray(data.interactives)) continue;
    if (pkg && data.package !== pkg) continue;
    const appId = data.package || pkg;
    if (!appId) continue;
    const anchor = data.interactives.find((e) => e.selector && e.kind !== 'field' && !e.ambiguous) || data.interactives.find((e) => e.selector && !e.ambiguous);
    const id = `SCR-${data.sig}`;
    const L = [`appId: ${appId}`, 'tags:', '  - testful-auto', '---', '- clearState', '- launchApp:', '    stopApp: false',
      '# TODO: bu ekrana ulaşan adımları ekle (selectors için observe çıktısına bak)'];
    L.push(...waitBlock(anchor, 15000));
    if (anchor) L.push(...selectorBlock('assertVisible', anchor));
    L.push(`- takeScreenshot: ${id}`);
    const title = `${anchor?.label || data.sig} ekranı görünür`;
    const oracle = oracleYaml({ id, title, pkg: appId, steps: [], source: 'testful-author/observe' });
    if (writePair(out, id, oracle, L.join('\n') + '\n', force)) { written++; qlog(`[AUTHOR] ${id} — ${title}`); }
  }
  qlog(`[AUTHOR] ${written} iskelet yazıldı → ${out}`);
  return { written };
}

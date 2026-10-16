import { createHash } from 'node:crypto';

const decode = (s) => s
  .replace(/&#10;/g, '\n').replace(/&#13;/g, '\r').replace(/&#9;/g, '\t')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

export function parseNodes(xml) {
  const nodes = [];
  const re = /<node\s([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
    const b = (attrs.bounds || '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    nodes.push({
      pkg: attrs.package || '',
      cls: attrs.class || '',
      id: attrs['resource-id'] || '',
      desc: attrs['content-desc'] || '',
      text: attrs.text || '',
      hint: attrs.hint || '',
      clickable: attrs.clickable === 'true' || attrs['long-clickable'] === 'true',
      checkable: attrs.checkable === 'true',
      enabled: attrs.enabled !== 'false',
      password: attrs.password === 'true',
      scrollable: attrs.scrollable === 'true',
      bounds: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null,
    });
  }
  return nodes;
}

const isFieldClass = (cls) => /EditText|TextField|TextInput/.test(cls);
const normDigits = (s) => s.replace(/\d/g, '#').slice(0, 40);

export function screenSignature(nodes, pkg) {
  const own = pkg ? nodes.filter((n) => n.pkg === pkg) : nodes;
  const feats = own.map((n) => (isFieldClass(n.cls) ? `field:${n.id || n.hint || n.desc}` : normDigits(n.desc || n.text || n.id))).filter(Boolean).sort();
  const clickables = own.filter((n) => n.clickable).length;
  return createHash('sha1').update(feats.join('|') + '::' + clickables).digest('hex').slice(0, 10);
}

export const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const yamlSingle = (s) => `'${s.replace(/'/g, "''")}'`;

function suggestSelector(node, label, allLabels, idCounts) {
  const shortId = node.id.includes(':id/') ? node.id.split(':id/')[1] : node.id;
  if (node.id && idCounts[node.id] === 1) {
    return { selector: `id: ${yamlSingle(reEscape(shortId))}`, match: 'id' };
  }
  if (!label) return {};
  const first = label.split('\n')[0].trim();
  if (label.includes('\n')) {
    return { selector: yamlSingle(`${reEscape(first)}[\\s\\S]*`), match: 'regex' };
  }
  const dup = allLabels.filter((o) => o === label).length > 1;
  return { selector: yamlSingle(reEscape(label)), match: 'exact', ambiguous: dup || undefined };
}

export function interactives(nodes, pkg) {
  const own = pkg ? nodes.filter((n) => n.pkg === pkg) : nodes;
  const els = own.filter((n) => n.bounds && n.enabled && (n.clickable || n.checkable || isFieldClass(n.cls))
    && n.bounds.x2 > n.bounds.x1 && n.bounds.y2 > n.bounds.y1);
  const labelOf = (n) => (n.desc || n.text || n.hint || '').trim();
  const labels = els.map(labelOf).filter(Boolean);
  const idCounts = {};
  for (const n of els) if (n.id) idCounts[n.id] = (idCounts[n.id] || 0) + 1;
  return els.map((n) => {
    const label = labelOf(n);
    const isField = isFieldClass(n.cls);
    const isTab = /\n(Sekme|Tab) \d/.test(label) || /Tab$/.test(n.cls);
    const w = n.bounds.x2 - n.bounds.x1;
    const h = n.bounds.y2 - n.bounds.y1;
    const base = {
      kind: isField ? 'field' : isTab ? 'tab' : 'button',
      label: label ? label.split('\n')[0].slice(0, 60) : null,
      full_text: label || null,
      value: isField && n.text ? n.text : undefined,
      resource_id: n.id || undefined,
      a11y_missing: !label || undefined,
      password: n.password || undefined,
      center: { x: (n.bounds.x1 + n.bounds.x2) >> 1, y: (n.bounds.y1 + n.bounds.y2) >> 1 },
      size: { w, h },
      bounds: n.bounds,
      class: n.cls.split('.').pop(),
    };
    return { ...base, ...suggestSelector(n, label, labels, idCounts) };
  });
}

export function elementKey(e) {
  return e.label ? `${e.kind}:${e.label}` : e.resource_id ? `id:${e.resource_id}` : `${e.class}@${e.center.x},${e.center.y}`;
}

export function a11yIssues(els, { density = 2.625 } = {}) {
  const minPx = Math.round(48 * density) - 2;
  const issues = [];
  for (const e of els) {
    if (e.a11y_missing && e.kind !== 'field') {
      issues.push({ kind: 'label-missing', element: `${e.class}@${e.center.x},${e.center.y}`, detail: 'erişilebilirlik etiketi yok (TalkBack okuyamaz, test seçicisi yok)' });
    }
    if (e.kind !== 'field' && (e.size.w < minPx || e.size.h < minPx) && e.size.w > 0) {
      issues.push({ kind: 'small-target', element: e.label || `${e.class}@${e.center.x},${e.center.y}`, detail: `dokunma hedefi ${e.size.w}x${e.size.h}px < 48dp (~${minPx}px)` });
    }
  }
  return issues;
}

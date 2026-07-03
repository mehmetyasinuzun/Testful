import { createHash } from 'node:crypto';

export function parseNodes(xml) {
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
      desc: attr('content-desc').replace(/&#10;/g, '\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
      text: attr('text').replace(/&#10;/g, '\n').replace(/&amp;/g, '&'),
      clickable: attr('clickable') === 'true',
      password: attr('password') === 'true',
      scrollable: attr('scrollable') === 'true',
      bounds: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null,
    });
  }
  return nodes;
}

const normDigits = (s) => s.replace(/\d/g, '#').slice(0, 40);

export function screenSignature(nodes, pkg) {
  const own = pkg ? nodes.filter((n) => n.pkg === pkg) : nodes;
  const feats = own.map((n) => normDigits(n.desc || n.text)).filter(Boolean).sort();
  const clickables = own.filter((n) => n.clickable).length;
  return createHash('sha1').update(feats.join('|') + '::' + clickables).digest('hex').slice(0, 10);
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Maestro seçici önerisi: çok-satır düğüm → 'ilkSatır[\s\S]*' regex; tek satır → tam eşleşme.
// YAML notu: regex TEK tırnak ister; içteki ' YAML'da '' olarak yazılır.
function suggestSelector(label, allLabels) {
  const first = label.split('\n')[0].trim();
  if (label.includes('\n')) {
    return { selector: `'${reEscape(first).replace(/'/g, "''")}[\\s\\S]*'`, match: 'regex' };
  }
  const clash = allLabels.filter((o) => o !== label && (o.startsWith(label) || label.startsWith(o))).length > 0;
  return { selector: `"${label}"`, match: 'exact', ambiguous: clash || undefined };
}

export function interactives(nodes, pkg) {
  const own = pkg ? nodes.filter((n) => n.pkg === pkg) : nodes;
  const els = own.filter((n) => n.bounds && (n.clickable || n.cls.endsWith('EditText')));
  const labels = els.map((n) => n.desc || n.text).filter(Boolean);
  return els.map((n) => {
    const label = n.desc || n.text;
    const isField = n.cls.endsWith('EditText');
    const isTab = /\n(Sekme|Tab) \d/.test(label);
    const base = {
      kind: isField ? 'field' : isTab ? 'tab' : 'button',
      label: label ? label.split('\n')[0].slice(0, 60) : null,
      full_text: label || null,
      a11y_missing: !label || undefined,
      password: n.password || undefined,
      center: { x: (n.bounds.x1 + n.bounds.x2) >> 1, y: (n.bounds.y1 + n.bounds.y2) >> 1 },
      bounds: n.bounds,
      class: n.cls.split('.').pop(),
    };
    return label ? { ...base, ...suggestSelector(label, labels) } : base;
  });
}

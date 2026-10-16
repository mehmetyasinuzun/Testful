import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dumpTree, screenshot, requireDevice, collapseShade } from './device.mjs';
import { parseNodes, interactives, screenSignature, a11yIssues } from './tree.mjs';
import { deviceDensity } from './smoke.mjs';
import { EnvError } from './errors.mjs';

export function observe({ pkg, out }) {
  requireDevice();
  let xml = dumpTree();
  let nodes = parseNodes(xml);
  if (pkg && !nodes.some((n) => n.pkg === pkg) && nodes.some((n) => n.pkg === 'com.android.systemui')) {
    collapseShade();
    xml = dumpTree();
    nodes = parseNodes(xml);
  }
  if (pkg && !nodes.some((n) => n.pkg === pkg)) {
    const seen = [...new Set(nodes.map((n) => n.pkg).filter(Boolean))].join(', ');
    throw new EnvError(`ön planda ${pkg} yok (görünen paketler: ${seen || '-'})`);
  }
  const sig = screenSignature(nodes, pkg);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${sig}.xml`), xml);
  writeFileSync(join(out, `${sig}.png`), screenshot());
  const els = interactives(nodes, pkg);
  const bundle = {
    sig,
    package: pkg || null,
    captured_at: new Date().toISOString(),
    screenshot: `${sig}.png`,
    tree: `${sig}.xml`,
    interactive_count: els.length,
    a11y_missing_count: els.filter((e) => e.a11y_missing).length,
    a11y_issues: a11yIssues(els, { density: deviceDensity() }),
    interactives: els,
  };
  writeFileSync(join(out, `${sig}.json`), JSON.stringify(bundle, null, 2));
  return bundle;
}

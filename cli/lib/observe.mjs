import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dumpTree, screenshot, requireDevice } from './device.mjs';
import { parseNodes, interactives, screenSignature } from './tree.mjs';

export function observe({ pkg, out }) {
  requireDevice();
  const xml = dumpTree();
  const nodes = parseNodes(xml);
  if (pkg && !nodes.some((n) => n.pkg === pkg)) {
    const seen = [...new Set(nodes.map((n) => n.pkg).filter(Boolean))].join(', ');
    throw new Error(`ön planda ${pkg} yok (görünen paketler: ${seen})`);
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
    interactives: els,
  };
  writeFileSync(join(out, `${sig}.json`), JSON.stringify(bundle, null, 2));
  return bundle;
}

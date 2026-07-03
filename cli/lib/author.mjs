import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { qlog } from './log.mjs';

export function author({ pkg, dir, out = '.qa/scenarios' }) {
  if (!existsSync(dir)) {
    throw new Error(`Girdi klasörü bulunamadı: ${dir}`);
  }
  mkdirSync(out, { recursive: true });

  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    qlog(`[UYARI] Klasörde .json bulunamadı: ${dir}`);
    return;
  }

  let count = 0;
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    if (pkg && data.package !== pkg) continue;

    const sig = data.sig;
    const currentPkg = data.package || pkg || 'com.example.app';
    const id = `CORE-${String(count + 1).padStart(2, '0')}`;
    
    // Generate oracle YAML
    const oraclePath = join(out, `${id}.yaml`);
    const mainElement = data.interactives.find(e => e.label) || { label: 'Element', selector: '"Element"' };
    const label = mainElement.label || 'Uygulama Ekranı';
    
    const oracleContent = `id: ${id}
title: ${label} ekranı kontrolü (${sig})
archetype: universal
tier: core
engine: maestro
package: ${currentPkg}
preconditions:
  - reset-app
steps:
  - do: launch
    expect: "uygulama çökmeden açılır ve ${label} görünür"
    shot: true
`;
    writeFileSync(oraclePath, oracleContent);

    // Generate Maestro flow YAML
    const flowPath = join(out, `${id}.flow.yaml`);
    const selector = mainElement.selector || `"${label}"`;
    const cleanSelector = selector.startsWith("'") || selector.startsWith('"') ? selector : `"${selector}"`;
    
    const flowContent = `appId: ${currentPkg}
---
- clearState
- launchApp:
    stopApp: false
- extendedWaitUntil:
    visible: ${cleanSelector}
    timeout: 15000
- takeScreenshot: ${id}-1-${sig}
- assertVisible: ${cleanSelector}
`;
    writeFileSync(flowPath, flowContent);
    qlog(`[AUTHOR] Senaryo üretildi: ${id} (${sig}) -> ${out}/`);
    count++;
  }
  qlog(`[AUTHOR] Toplam ${count} senaryo iskeleti üretildi.`);
}
const SIGNATURES = [
  { type: 'crash', severity: 'kritik', re: /FATAL EXCEPTION/, title: 'Uygulama çöktü (Java/Kotlin istisnası)' },
  { type: 'crash', severity: 'kritik', re: /\*\*\* \*\*\* \*\*\* \*\*\* \*\*\*|Fatal signal \d+/, title: 'Native çökme (SIGSEGV/SIGABRT)' },
  { type: 'anr', severity: 'kritik', re: /ANR in /, title: 'Uygulama yanıt vermiyor (ANR)' },
  { type: 'oom', severity: 'kritik', re: /java\.lang\.OutOfMemoryError/, title: 'Bellek tükendi (OutOfMemoryError)' },
  { type: 'flutter-error', severity: 'yüksek', re: /\sE flutter\s*:|E\/flutter|Unhandled Exception:|EXCEPTION CAUGHT BY (?!RENDERING)/, title: 'Flutter yakalanmamış hata' },
  { type: 'overflow', severity: 'orta', re: /RenderFlex overflowed|A RenderFlex overflowed/, title: 'Flutter yerleşim taşması (RenderFlex overflow)' },
  { type: 'rn-error', severity: 'yüksek', re: /ReactNativeJS.*(Error|Exception)|com\.facebook\.react\.common\.JavascriptException/, title: 'React Native JS hatası' },
];

function belongsTo(lines, i, pkg) {
  if (!pkg) return true;
  const win = lines.slice(Math.max(0, i - 2), i + 6).join('\n');
  return win.includes(pkg);
}

export function scanLogcat(text, { pkg, pid } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const sig of SIGNATURES) {
      if (!sig.re.test(line)) continue;
      const pidMatch = pid && new RegExp(`\\s${pid}\\s`).test(line);
      const isAppScoped = sig.type === 'flutter-error' || sig.type === 'overflow' || sig.type === 'rn-error';
      if (!pidMatch && !isAppScoped && !belongsTo(lines, i, pkg)) continue;
      const stack = lines.slice(i, i + 8).map((l) => l.replace(/^\S+\s+\S+\s+\d+\s+\d+\s+\w\s+/, '').trim()).filter(Boolean);
      hits.push({ type: sig.type, severity: sig.severity, title: sig.title, line: i + 1, text: line.trim(), stack, key: signatureKey(sig.type, stack) });
      break;
    }
  }
  return { clean: hits.length === 0, hits: dedupe(hits) };
}

function signatureKey(type, stack) {
  const frame = stack.find((l) => /^\s*at\s|Exception|Error/.test(l)) || stack[0] || '';
  return `${type}:${frame.replace(/\d+/g, '#').slice(0, 120)}`;
}

function dedupe(hits) {
  const seen = new Map();
  for (const h of hits) {
    if (seen.has(h.key)) seen.get(h.key).count++;
    else seen.set(h.key, { ...h, count: 1 });
  }
  return [...seen.values()];
}

export function hitsToFindings(hits, { source, evidence }) {
  return hits.map((h) => ({
    type: h.type,
    severity: h.severity,
    confidence: h.count >= 2 || h.type === 'crash' || h.type === 'anr' ? 'kesin' : 'muhtemel',
    title: h.title,
    detail: h.stack.slice(0, 6).join('\n'),
    source,
    evidence,
    key: h.key,
    count: h.count,
  }));
}

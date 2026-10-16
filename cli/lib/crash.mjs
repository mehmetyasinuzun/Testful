// Logcat'te yalnız HEDEF PAKETE ait çökme imzaları. Sistem/diğer uygulama gürültüsü
// sayılmaz — güven-öncelikli ilke: yanlış alarm, kaçırılan bulgudan pahalıdır.
// "Sert" türler (çökme, ANR, native çökme) CI'da fail-on=crash ile kırmızı yapar.

export const HARD_KINDS = new Set(['çökme', 'ANR', 'native çökme']);

export function crashHits(text, pkg, source) {
  const lines = text.split('\n');
  const hits = [];
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anr = new RegExp(`ANR in ${esc}\\b`);
  const native = new RegExp(`>>> ${esc} <<<`);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let kind = null;
    if (/FATAL EXCEPTION/.test(l) && lines.slice(i + 1, i + 3).some((n) => n.includes(`Process: ${pkg},`))) kind = 'çökme';
    else if (anr.test(l)) kind = 'ANR';
    else if (native.test(l)) kind = 'native çökme';
    else if (/E\/flutter|E flutter/.test(l)) kind = 'flutter hatası';
    else if (/RenderFlex overflowed/.test(l)) kind = 'taşma (overflow)';
    if (kind) {
      // çökme: aynı AndroidRuntime bloğunun ilk satırları (yığın izinin başı)
      let end = i + 1;
      if (kind === 'çökme') while (end < lines.length && end < i + 8 && /AndroidRuntime/.test(lines[end])) end++;
      const ctx = lines.slice(i, end).map((s) => s.trim()).join('\n');
      hits.push({ kind, source, line: i + 1, text: ctx });
    }
  }
  return hits;
}


import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as realDevice from './device.mjs';
import { parseNodes, interactives, screenSignature, elementKey } from './tree.mjs';
import { RISKY, FALLBACK, SECRET_FOR, classifyField, formKind, isRisky, isSubmit, mainScrollable, orderCandidates, shortestPath } from './explore.mjs';
import { scanLogcat } from './logcat.mjs';
import { qlog } from './log.mjs';
import { sleep as realSleep } from './util.mjs';
import { EnvError } from './errors.mjs';

export { RISKY };

const MAX_SCROLLS_PER_VISIT = 4;

function dismissSystemDialog(nodes, { tap, back }) {
  const alert = nodes.find((n) => /isn't responding|yanıt vermiyor|keeps stopping|durduruldu/i.test(n.text + n.desc));
  if (!alert) return false;
  const btn = nodes.find((n) => /^(Wait|Bekle|Close app|Uygulamayı kapat|OK|Tamam)$/i.test((n.text || n.desc).trim()) && n.bounds);
  if (btn) tap((btn.bounds.x1 + btn.bounds.x2) / 2, (btn.bounds.y1 + btn.bounds.y2) / 2);
  else back();
  return true;
}

/**
 * Bir metin alanına ne yazılacağı. Alan türü (şifre/e-posta/OTP/telefon) etiketten,
 * resource-id'den ve password bayrağından çıkarılır (Türkçe/İngilizce).
 * Sır varsa dolu alanın üzerine yazılır (test hesabıyla giriş); sır yoksa dolu alan
 * korunur, boşsa biçimi geçerli sahte değer yazılır. Flow'a değer değil ${MAESTRO_*}
 * referansı kaydedilir.
 */
export function fieldPlan(field, secrets = {}) {
  const kind = classifyField(field);
  const secretVar = SECRET_FOR[kind] || null;
  if (secretVar && secrets[secretVar]) return { type: secrets[secretVar], record: { secretVar } };
  if (field.value) return { type: null, record: { kept: true } };
  const text = FALLBACK[kind];
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

const visibleText = (nodes, pkg) => nodes.filter((n) => n.pkg === pkg).map((n) => `${n.text}|${n.desc}`).join('\n');

/**
 * Otonom keşif (model tabanlı tarayıcı).
 *
 * Her ekranda sırasıyla: (1) giriş/OTP formu ise doldur + gönder, (2) denenmemiş
 * öğeye dokun (etiketliler önce, gönder butonları sona), (3) kaydırılabilir içerikte
 * aşağı kaydır (yeni öğeler aynı ekrana eklenir), (4) metin alanlarını doldur.
 * Ekranda iş kalmayınca bilinen geçişlerle (BFS) işi kalan en yakın ekrana gider;
 * yol bir form gönderimi içeriyorsa formu yeniden doldurur (oturum düşmüşse yeniden
 * giriş). Hiçbir ekrana ulaşılamıyorsa ya da süre/eylem bütçesi dolarsa durur.
 *
 * `device` enjekte edilebilir: testlerde sahte uygulama simülatörü kullanılır.
 */
export async function map({ pkg, out, maxActions = 80, maxMinutes = 10, clear = true, reversePorts = [], secrets = {}, device = realDevice, sleep = realSleep }) {
  const { dumpTree, screenshot, tap, typeText, clearField, back, hideKb, launch, requireDevice, isInstalled, clearLogcat, dumpLogcat, stabilize, collapseShade, reverse, swipe } = device;
  requireDevice();
  reverse(reversePorts);
  if (!isInstalled(pkg)) throw new EnvError(`${pkg} cihazda kurulu değil`);
  const screensDir = join(out, 'screens');
  mkdirSync(screensDir, { recursive: true });
  const unstabilize = stabilize();
  const deadline = Date.now() + maxMinutes * 60_000;

  const graph = {
    schema: 'testful/graph@1', package: pkg, start: null, nodes: {}, edges: [],
    stats: { actions: 0, backs: 0, relaunches: 0, typed: 0, scrolls: 0, forms_submitted: 0, navigations: 0, risky_skipped: 0 },
  };
  const tried = {};
  const typedOn = {};
  const riskySeen = new Set();
  const edgeSeen = new Set();
  const alias = {};          // kaydırılmış görünümün ham imzası → ekranın asıl imzası
  const formDone = new Set();
  const unreachable = new Set();

  /** Bir ekranın denenmemiş adayları; canlı öğeler verilirse (konumlar güncel) onlardan. */
  const candidates = (sig, live) => {
    const n = graph.nodes[sig];
    if (!n) return [];
    return orderCandidates(live || n.interactives, tried[sig]);
  };
  const hasWork = (sig) => candidates(sig).length > 0 && !unreachable.has(sig);

  /** Ekranı kaydet ya da (kaydırmayla görünen) yeni öğeleri ekle; eklenen öğe sayısını döndürür. */
  const register = (sig, xml, els) => {
    const n = graph.nodes[sig];
    if (n) {
      const known = new Set(n.interactives.map(elementKey));
      const added = els.filter((e) => !known.has(elementKey(e)));
      n.interactives.push(...added);
      n.total = n.interactives.filter((e) => e.kind !== 'field').length;
      return added.length;
    }
    writeFileSync(join(screensDir, `${sig}.png`), screenshot());
    writeFileSync(join(screensDir, `${sig}.xml`), xml);
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
    return els.length;
  };

  /** Ekranı oku → { sig (asıl), raw, nodes, els (canlı) } ya da sig:null. */
  const observeHere = () => {
    let xml;
    try { xml = dumpTree(); } catch { return { sig: null, transient: true }; }
    const nodes = parseNodes(xml);
    if (dismissSystemDialog(nodes, device)) return { sig: null, dialog: true };
    if (!nodes.some((n) => n.pkg === pkg)) {
      if (nodes.some((n) => n.pkg === 'com.android.systemui')) collapseShade();
      return { sig: null, foreign: true };
    }
    const raw = screenSignature(nodes, pkg);
    const sig = alias[raw] || raw;
    if (!graph.screen) {
      const w = Math.max(...nodes.map((n) => n.bounds?.x2 || 0));
      const h = Math.max(...nodes.map((n) => n.bounds?.y2 || 0));
      if (w > 0 && h > 0) graph.screen = { w, h };
    }
    const els = interactives(nodes, pkg);
    register(sig, xml, els);
    return { sig, raw, nodes, els };
  };

  const addEdge = (from, to, el) => {
    if (!to || to === from) return;
    const key = elementKey(el);
    const ek = `${from}>${to}>${key}`;
    if (edgeSeen.has(ek)) return;
    edgeSeen.add(ek);
    graph.edges.push({
      from, to, via: el.label || key, key,
      tap: { selector: el.selector || null, match: el.match || null, center: el.center },
      inputs: typedOn[from].filter((t) => !t.kept).map((t) => ({ ...t })),
    });
    qlog(`  ${from} --[${el.label || key}]--> ${to}`);
  };

  const fill = async (sig, field) => {
    const plan = fieldPlan(field, secrets);
    typedOn[sig] = typedOn[sig].filter((t) => t.y !== field.center.y);
    typedOn[sig].push({ x: field.center.x, y: field.center.y, selector: field.selector || null, match: field.match || null, ...plan.record });
    if (plan.type === null) return false;
    tap(field.center.x, field.center.y);
    await sleep(500);
    clearField((field.value || '').length);
    typeText(plan.type);
    hideKb();
    graph.stats.typed++;
    await sleep(500);
    return true;
  };

  /** Bir geçişin kaydettiği alan girişlerini yeniden yaz (oturum düşmüşse yeniden giriş). */
  const replayInputs = async (edge) => {
    for (const inp of edge.inputs || []) {
      const value = inp.secretVar ? secrets[inp.secretVar] : inp.text;
      if (value === undefined || value === null) continue;
      tap(inp.x, inp.y);
      await sleep(400);
      clearField(64);
      typeText(value);
      hideKb();
      await sleep(300);
    }
  };

  const relaunch = async () => {
    launch(pkg);
    graph.stats.relaunches++;
    await sleep(4000);
    let c = observeHere();
    for (let i = 0; !c.sig && c.transient && i < 4; i++) { await sleep(1200); c = observeHere(); }
    return c;
  };

  /** Bilinen yoldan işi kalan en yakın ekrana git; ulaşılamazsa null. */
  const navigate = async (cur) => {
    for (let attempt = 0; attempt < 3 && cur.sig; attempt++) {
      const path = shortestPath(graph.edges, cur.sig, (s) => s !== cur.sig && hasWork(s));
      if (!path) return null;
      graph.stats.navigations++;
      let here = cur;
      let ok = true;
      for (const e of path) {
        if (e.inputs?.length) await replayInputs(e);
        const live = here.els?.find((x) => elementKey(x) === e.key);
        const at = live ? live.center : e.tap.center;
        tap(at.x, at.y);
        graph.stats.actions++;
        await sleep(1300);
        const after = observeHere();
        if (after.sig !== e.to) {
          unreachable.add(path[path.length - 1].to); // bu turda ulaşılamaz; başka hedef dene
          here = after.sig ? after : await relaunch();
          ok = false;
          break;
        }
        here = after;
      }
      if (ok) return here;
      cur = here;
    }
    return null;
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
  let lastNewAt = 0; // son ilerleme (yeni ekran ya da kaydırmayla yeni öğe) anındaki dokunuş sayısı
  let screenCount = 1;
  let scrollsThisVisit = 0;
  let lastSig = null;
  // Döngü güvencesi: dokunuş olmayan adımlar (kaydırma, yazma, geri) da sınırlı kalsın
  for (let guard = 0; graph.stats.actions < maxActions && guard < maxActions * 6; guard++) {
    if (Date.now() > deadline) { stop = `süre sınırı (${maxMinutes} dk)`; break; }
    if (!cur.sig) {
      if (cur.transient) { await sleep(1500); cur = observeHere(); if (cur.sig) continue; }
      if (!cur.dialog) { back(); graph.stats.backs++; }
      await sleep(1000);
      cur = observeHere();
      if (!cur.sig) cur = await relaunch();
      if (!cur.sig) { if (cur.transient) continue; stop = 'uygulamaya geri dönülemedi'; break; }
      continue;
    }
    const sig = cur.sig;
    if (sig !== lastSig) { scrollsThisVisit = 0; lastSig = sig; }
    const node = graph.nodes[sig];
    for (const e of node.interactives) {
      if (isRisky(e) && !riskySeen.has(`${sig}:${elementKey(e)}`)) {
        riskySeen.add(`${sig}:${elementKey(e)}`);
        graph.stats.risky_skipped++;
      }
    }

    // (1) Giriş/OTP formu: bir kez doldur ve gönder (geçiş girişleriyle kaydedilir)
    const form = formKind(cur.els);
    if (form && !formDone.has(sig)) {
      formDone.add(sig);
      for (const f of cur.els.filter((e) => e.kind === 'field')) await fill(sig, f);
      const fresh = observeHere();
      const submit = (fresh.sig === sig ? fresh.els : cur.els).find(isSubmit);
      if (submit) {
        tried[sig].add(elementKey(submit));
        tap(submit.center.x, submit.center.y);
        graph.stats.actions++;
        graph.stats.forms_submitted++;
        qlog(`  [FORM] ${form} formu dolduruldu → "${submit.label}"`);
        await sleep(2500);
        const nxt = observeHere();
        addEdge(sig, nxt.sig, submit);
        cur = nxt.sig || !nxt.transient ? nxt : cur;
      } else {
        cur = fresh.sig ? fresh : cur;
      }
      continue;
    }

    // (2) Denenmemiş öğeye dokun (canlı konumlarla)
    const el = candidates(sig, cur.els)[0];
    if (el) {
      tried[sig].add(elementKey(el));
      tap(el.center.x, el.center.y);
      graph.stats.actions++;
      await sleep(1300);
      const nxt = observeHere();
      addEdge(sig, nxt.sig, el);
      const count = Object.keys(graph.nodes).length;
      if (count > screenCount) { screenCount = count; lastNewAt = graph.stats.actions; }
      if (graph.stats.actions - lastNewAt >= 20) { stop = '20 eylemdir yeni ekran yok'; break; }
      cur = nxt.sig || !nxt.transient ? nxt : cur;
      continue;
    }

    // (3) Kaydır: aynı ekranın görünmeyen kısmı
    const sc = mainScrollable(cur.nodes, pkg);
    if (sc && scrollsThisVisit < MAX_SCROLLS_PER_VISIT) {
      scrollsThisVisit++;
      const b = sc.bounds;
      const x = (b.x1 + b.x2) / 2;
      const h = b.y2 - b.y1;
      swipe(x, b.y1 + h * 0.8, x, b.y1 + h * 0.2);
      graph.stats.scrolls++;
      await sleep(900);
      let xml;
      try { xml = dumpTree(); } catch { continue; }
      const nodes = parseNodes(xml);
      // Liste sonu: görünür içerik birebir aynı (imza rakamları normalleştirdiği için
      // "Ürün 5"/"Ürün 9" gibi numaralı listelerde imza karşılaştırması yanıltır)
      if (visibleText(nodes, pkg) === visibleText(cur.nodes, pkg)) { scrollsThisVisit = MAX_SCROLLS_PER_VISIT; continue; }
      const raw = screenSignature(nodes, pkg);
      if (raw !== sig) alias[raw] = sig;
      const els = interactives(nodes, pkg);
      // Kaydırmanın getirdiği yeni öğeler de ilerlemedir: "20 eylemdir yeni ekran yok"
      // sınırı uzun listeleri (sonu ancak kaydırınca görünen) yarıda kesmesin
      if (register(sig, xml, els) > 0) lastNewAt = graph.stats.actions;
      cur = { sig, raw, nodes, els };
      continue;
    }

    // (4) Alanları doldur → butonlar yeni durumda yeniden denensin
    const field = cur.els.find((e) => e.kind === 'field' && !typedOn[sig].some((t) => t.y === e.center.y));
    if (field) {
      if (await fill(sig, field)) {
        for (const e of node.interactives) if (e.kind !== 'field' && !isSubmit(e)) tried[sig].delete(elementKey(e));
        cur = observeHere();
      }
      continue;
    }

    // (5) Burada iş kalmadı → işi kalan en yakın ekrana bilinen yoldan git
    const nxt = await navigate(cur);
    if (nxt) { cur = nxt; continue; }
    // Başlangıç ekranından da yol yoksa kalan işler ulaşılamaz: geri/yeniden başlat döngüsüne girme
    if (sig === graph.start || !Object.keys(graph.nodes).some(hasWork)) { stop = 'keşfedilecek ulaşılabilir ekran kalmadı'; break; }
    back();
    graph.stats.backs++;
    await sleep(1000);
    const after = observeHere();
    if (after.sig === sig) { stop = 'takılı ekran: geri tuşu etkisiz ve denenmemiş öğe yok'; break; }
    cur = after;
  }

  unstabilize();
  graph.stats.stop_reason = stop;
  qlog(`(durdu: ${stop})`);
  let triedTotal = 0;
  let allTotal = 0;
  for (const sig of Object.keys(graph.nodes)) {
    const n = graph.nodes[sig];
    // Kapsama: riskli öğeler bilerek atlanır → paydada değil, ayrı raporlanır
    const keys = new Set(n.interactives.filter((e) => e.kind !== 'field' && !isRisky(e)).map(elementKey));
    n.tried = [...tried[sig]].filter((k) => keys.has(k)).length;
    triedTotal += n.tried;
    allTotal += keys.size;
  }
  const crashes = scanLogcat(dumpLogcat(), { pkg }).hits;
  graph.crashes = crashes.map((h) => ({ type: h.type, title: h.title, stack: h.stack, count: h.count }));
  graph.stats.screens = Object.keys(graph.nodes).length;
  graph.stats.edges = graph.edges.length;
  graph.stats.coverage_pct = allTotal ? Math.round((100 * triedTotal) / allTotal) : 0;
  writeFileSync(join(out, 'graph.json'), JSON.stringify(graph, null, 2));
  writeFileSync(join(out, 'map.md'), `# Uygulama haritası — ${pkg}\n\n${graph.stats.screens} ekran · ${graph.stats.edges} geçiş · kapsama ~%${graph.stats.coverage_pct} · riskli atlanan ${graph.stats.risky_skipped}\n\n\`\`\`mermaid\n${renderMermaid(graph)}\n\`\`\`\n`);
  qlog(`harita: ${graph.stats.screens} ekran · ${graph.stats.edges} geçiş · ${graph.stats.actions} dokunuş · ${graph.stats.scrolls} kaydırma · kapsama ~%${graph.stats.coverage_pct}`);
  if (crashes.length) qlog(`[UYARI] keşif sırasında ${crashes.length} hata imzası: ${crashes.map((c) => c.title).join(' · ')}`);
  qlog(`graph.json + map.md → ${out}`);
  return graph;
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as realDevice from './device.mjs';
import { parseNodes, interactives, screenSignature } from './tree.mjs';
import { classifyField, elKey, formKind, isRisky, isSubmit, mainScrollable, pickCandidate, shortestPath, valueFor } from './explore.mjs';
import { qlog } from './log.mjs';

const MAX_SCROLLS_PER_VISIT = 4;

const visibleText = (nodes, pkg) => nodes.filter((n) => n.pkg === pkg).map((n) => `${n.text}|${n.desc}`).join('\n');

function dismissSystemDialog(nodes, { tap, back }) {
  const alert = nodes.find((n) => /isn't responding|yanıt vermiyor/i.test(n.text + n.desc));
  if (!alert) return false;
  const wait = nodes.find((n) => /^(Wait|Bekle)$/i.test((n.text || n.desc).trim()) && n.bounds);
  if (wait) tap((wait.bounds.x1 + wait.bounds.x2) >> 1, (wait.bounds.y1 + wait.bounds.y2) >> 1);
  else back();
  return true;
}

/**
 * Otonom keşif (model tabanlı tarayıcı).
 *
 * Her ekranda sırasıyla: (1) giriş/OTP formu ise doldur + gönder, (2) denenmemiş
 * öğeye dokun, (3) kaydırılabilir içerikte aşağı kaydır (yeni öğeler aynı ekrana
 * eklenir), (4) boş metin alanlarını doldur. Ekranda yapacak iş kalmayınca
 * bilinen geçişler üzerinden işi kalan en yakın ekrana gider; hiçbirine
 * ulaşılamıyorsa durur. Kör geri/yeniden başlatma döngüsü yoktur.
 *
 * Giriş bilgisi: TESTFUL_LOGIN_USER / _PASSWORD / _OTP / _PHONE (CI'da Secrets).
 */
export async function map({ pkg, out, maxActions = 80, maxMinutes = 10, clear = true, device = realDevice }) {
  // Cihaz enjekte edilebilir: testlerde sahte uygulama simülatörü kullanılır.
  const { dumpTree, screenshot, tap, typeText, clearField, back, hideKb, launch, requireDevice, sleepOnDevice, swipe } = device;
  requireDevice();
  const screensDir = join(out, 'screens');
  mkdirSync(screensDir, { recursive: true });
  const sleep = device.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + maxMinutes * 60_000;

  const graph = {
    package: pkg, device: { density: device.density ? device.density() : null }, nodes: {}, edges: [],
    stats: { actions: 0, backs: 0, relaunches: 0, typed: 0, scrolls: 0, forms_submitted: 0, risky_skipped: 0, navigations: 0 },
  };
  const tried = {};        // sig → Set(öğe anahtarı)
  const done = new Set();  // yapacak işi kalmamış ekranlar
  const unreachable = new Set();
  const alias = {};        // kaydırma sonrası ham imza → ekranın asıl imzası
  const formDone = new Set();
  const filled = {};       // sig → Set(alan anahtarı)

  const register = (sig, xml, els) => {
    if (graph.nodes[sig]) {
      // Kaydırmayla görünen yeni öğeleri ekrana ekle
      const known = new Set(graph.nodes[sig].interactives.map(elKey));
      for (const e of els) if (!known.has(elKey(e))) graph.nodes[sig].interactives.push(e);
      graph.nodes[sig].total = graph.nodes[sig].interactives.length;
      return;
    }
    writeFileSync(join(screensDir, `${sig}.png`), screenshot());
    writeFileSync(join(screensDir, `${sig}.xml`), xml);
    graph.nodes[sig] = {
      sig,
      order: Object.keys(graph.nodes).length + 1,
      screenshot: `screens/${sig}.png`,
      anchor: els.find((e) => e.label && e.kind !== 'tab')?.selector || els.find((e) => e.label)?.selector || null,
      interactives: els,
      total: els.length,
    };
    tried[sig] = new Set();
    filled[sig] = new Set();
    qlog(`[EKRAN ${graph.nodes[sig].order}] ${sig} — ${els.filter((e) => e.label).slice(0, 4).map((e) => e.label).join(' · ')}`);
  };

  /** Ekranı oku. sig: ekranın asıl imzası (alias çözülmüş), raw: ham imza. */
  const observe = () => {
    let xml;
    try { xml = dumpTree(); } catch { return { sig: null, transient: true }; }
    const nodes = parseNodes(xml);
    if (dismissSystemDialog(nodes, device)) return { sig: null, dialog: true };
    if (!nodes.some((n) => n.pkg === pkg)) return { sig: null, outside: true };
    const raw = screenSignature(nodes, pkg);
    const sig = alias[raw] || raw;
    const els = interactives(nodes, pkg);
    register(sig, xml, els);
    return { sig, raw, nodes, els };
  };

  const edge = (from, to, el, { form = false } = {}) => {
    if (!to || from === to) return;
    if (graph.edges.some((e) => e.from === from && e.to === to && e.key === elKey(el))) return;
    // form: bu geçiş ancak form doldurulunca çalışır (örn. giriş) → gezinme yeniden doldurur
    graph.edges.push({ from, to, via: el.label || elKey(el), key: elKey(el), via_selector: el.selector || null, at: el.center, ...(form ? { form: true } : {}) });
    qlog(`  ${from} --[${el.label || elKey(el)}]--> ${to}`);
  };

  const relaunch = async () => {
    launch(pkg, { clear: false });
    graph.stats.relaunches++;
    sleepOnDevice(3);
    let cur = observe();
    for (let i = 0; !cur.sig && cur.transient && i < 4; i++) { await sleep(1200); cur = observe(); }
    return cur;
  };

  /** Bilinen geçişlerle işi kalan en yakın ekrana git. */
  const navigate = async (cur, launchSig) => {
    const hasWork = (s) => !done.has(s) && !unreachable.has(s);
    // Ucuz yol: bir kez geri
    back(); graph.stats.backs++;
    await sleep(900);
    let nxt = observe();
    if (nxt.sig && hasWork(nxt.sig)) return nxt;
    // Yoksa bulunduğun yerden (ya da uygulama başından) bilinen yolu izle
    if (!nxt.sig) nxt = await relaunch();
    for (let attempt = 0; attempt < 3 && nxt.sig; attempt++) {
      const path = shortestPath(graph.edges, nxt.sig, hasWork);
      if (!path) {
        if (attempt === 0 && nxt.sig !== launchSig) { nxt = await relaunch(); continue; }
        return null;
      }
      if (!path.length) return nxt;
      graph.stats.navigations++;
      let ok = true;
      for (const e of path) {
        if (e.form) {
          // Yeniden açılışta oturum düşmüş olabilir: formu tekrar doldur, sonra gönder
          for (const f of nxt.els.filter((x) => x.kind === 'field')) await fillField(f, classifyField(f));
          const fresh = observe();
          if (fresh.sig) nxt = fresh;
        }
        const live = nxt.els.find((x) => elKey(x) === e.key);
        const at = live ? live.center : e.at;
        tap(at.x, at.y);
        await sleep(1200);
        const after = observe();
        if (after.sig !== e.to) {
          // Yol tutmadı: hedefi bu turda ulaşılamaz say, yeni konumdan tekrar dene
          unreachable.add(path[path.length - 1].to);
          nxt = after.sig ? after : await relaunch();
          ok = false;
          break;
        }
        nxt = after;
      }
      if (ok) return nxt;
    }
    return null;
  };

  const fillField = async (el, kind) => {
    tap(el.center.x, el.center.y);
    await sleep(500);
    clearField(); // aynı alana tekrar tekrar eklenip "TestTest…" sahte ekranları üretmesin
    typeText(valueFor(kind));
    hideKb();
    graph.stats.typed++;
    await sleep(300);
  };

  let cur = await relaunchFresh();
  async function relaunchFresh() {
    launch(pkg, { clear });
    sleepOnDevice(5);
    let c = observe();
    for (let i = 0; !c.sig && i < 8; i++) { await sleep(1500); c = observe(); }
    if (!c.sig) throw new Error('uygulama açılmadı');
    return c;
  }
  const launchSig = cur.sig;
  let scrollsThisVisit = 0;
  let lastSig = null;

  while (graph.stats.actions < maxActions && Date.now() < deadline) {
    if (!cur.sig) {
      if (cur.transient) { await sleep(1500); cur = observe(); if (cur.sig) continue; }
      // Uygulama dışına çıktık (paylaş/harici link vb.) → geri, olmazsa yeniden başlat
      if (!cur.dialog) { back(); graph.stats.backs++; }
      await sleep(1000);
      cur = observe();
      if (!cur.sig) cur = await relaunch();
      if (!cur.sig) break;
      continue;
    }
    const sig = cur.sig;
    if (sig !== lastSig) { scrollsThisVisit = 0; lastSig = sig; }

    // (1) Giriş / OTP formu: bir kez doldur ve gönder
    const form = formKind(cur.els);
    if (form && !formDone.has(sig)) {
      formDone.add(sig);
      for (const f of cur.els.filter((e) => e.kind === 'field')) {
        await fillField(f, classifyField(f));
        filled[sig].add(elKey(f));
      }
      const fresh = observe();
      const submit = (fresh.els || cur.els).find(isSubmit);
      if (submit) {
        tried[sig].add(elKey(submit));
        tap(submit.center.x, submit.center.y);
        graph.stats.actions++;
        graph.stats.forms_submitted++;
        qlog(`  [FORM] ${form} formu dolduruldu → "${submit.label}"`);
        await sleep(2500);
        const nxt = observe();
        edge(sig, nxt.sig, submit, { form: true });
        cur = nxt.sig ? nxt : cur;
      } else {
        cur = fresh.sig ? fresh : cur;
      }
      continue;
    }

    // (2) Denenmemiş öğeye dokun
    const el = pickCandidate(cur.els, tried[sig]);
    if (el) {
      tried[sig].add(elKey(el));
      tap(el.center.x, el.center.y);
      graph.stats.actions++;
      await sleep(1300);
      const nxt = observe();
      edge(sig, nxt.sig, el);
      cur = nxt.sig || !nxt.transient ? nxt : cur;
      continue;
    }

    // (3) Kaydır: aynı ekranın görünmeyen kısmı
    const sc = mainScrollable(cur.nodes, pkg);
    if (sc && scrollsThisVisit < MAX_SCROLLS_PER_VISIT) {
      scrollsThisVisit++;
      const b = sc.bounds, x = (b.x1 + b.x2) >> 1, h = b.y2 - b.y1;
      swipe(x, b.y1 + Math.round(h * 0.8), x, b.y1 + Math.round(h * 0.2));
      graph.stats.scrolls++;
      await sleep(900);
      let xml;
      try { xml = dumpTree(); } catch { continue; }
      const nodes = parseNodes(xml);
      const raw = screenSignature(nodes, pkg);
      // Listenin sonu: görünür içerik birebir aynı (imza rakamları normalleştirdiği için
      // "Ürün 5"/"Ürün 9" gibi numaralı listelerde imza karşılaştırması yanıltır)
      if (visibleText(nodes, pkg) === visibleText(cur.nodes, pkg)) { scrollsThisVisit = MAX_SCROLLS_PER_VISIT; continue; }
      alias[raw] = sig; // kaydırılmış görünüm = aynı ekran
      const els = interactives(nodes, pkg);
      register(sig, xml, els);
      cur = { sig, raw, nodes, els };
      continue;
    }

    // (4) Boş alanları doldur → butonlar yeni durumda yeniden denensin
    const field = cur.els.find((e) => e.kind === 'field' && !filled[sig].has(elKey(e)));
    if (field) {
      filled[sig].add(elKey(field));
      await fillField(field, classifyField(field));
      for (const e of cur.els) if (e.kind !== 'field' && !isSubmit(e)) tried[sig].delete(elKey(e));
      cur = observe();
      continue;
    }

    // (5) Bu ekranda iş kalmadı → işi kalan en yakın ekrana git
    done.add(sig);
    const nxt = await navigate(cur, launchSig);
    if (!nxt) { qlog('(keşfedilecek başka ulaşılabilir ekran kalmadı)'); break; }
    cur = nxt;
  }
  if (Date.now() >= deadline) qlog(`(süre sınırı: ${maxMinutes} dk)`);

  // Kapsama: riskli öğeler bilerek atlanır → paydada değil, ayrı raporlanır
  let triedTotal = 0, allTotal = 0;
  for (const sig of Object.keys(graph.nodes)) {
    const node = graph.nodes[sig];
    const buttons = node.interactives.filter((e) => e.kind !== 'field');
    const keys = new Set(buttons.filter((e) => !isRisky(e)).map(elKey));
    graph.stats.risky_skipped += new Set(buttons.filter(isRisky).map(elKey)).size;
    node.tried = [...tried[sig]].filter((k) => keys.has(k)).length;
    triedTotal += node.tried;
    allTotal += keys.size;
  }
  graph.stats.screens = Object.keys(graph.nodes).length;
  graph.stats.edges = graph.edges.length;
  graph.stats.coverage_pct = allTotal ? Math.round((100 * triedTotal) / allTotal) : 0;
  writeFileSync(join(out, 'graph.json'), JSON.stringify(graph, null, 2));
  qlog(`harita: ${graph.stats.screens} ekran · ${graph.stats.edges} geçiş · ${graph.stats.actions} dokunuş · ${graph.stats.scrolls} kaydırma · kapsama ~%${graph.stats.coverage_pct}`);
  qlog(`graph.json → ${join(out, 'graph.json')}`);
  return graph;
}

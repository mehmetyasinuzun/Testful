// Görsel hakem: keşif haritasındaki her BENZERSİZ ekranı bir kez, durumsuz olarak
// Claude'a gösterir ve yapılandırılmış (JSON şemalı) UX/UI bulguları alır.
//
// Güven hiyerarşisinde en alt kanıttır (logcat > assert > vision): bulgular rapora
// "muhtemel/zayıf" güvenle girer, CI'ı varsayılan olarak kırmızı yapmaz.
// Deterministik kontroller (dokunma hedefi boyutu, etiketsiz öğe) AI'sız yapılır.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { qlog } from './log.mjs';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const MIN_TOUCH_DP = 48; // Material / WCAG 2.5.8 önerisi

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['screen_summary', 'findings'],
  properties: {
    screen_summary: { type: 'string', description: 'Ekranın ne olduğu, tek cümle.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'severity', 'confidence', 'title', 'detail', 'location'],
        properties: {
          category: { type: 'string', enum: ['taşma', 'kesilme', 'üst üste binme', 'kontrast', 'hizalama', 'boşluk', 'boş durum', 'hata durumu', 'metin', 'erişilebilirlik', 'tutarlılık', 'diğer'] },
          severity: { type: 'string', enum: ['kritik', 'yüksek', 'orta', 'düşük'] },
          confidence: { type: 'string', enum: ['muhtemel', 'zayıf'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          location: { type: 'string', description: 'Ekranda nerede (örn. "üst bar, sağdaki ikon").' },
        },
      },
    },
  },
};

const SYSTEM = `Sen titiz bir mobil UX/UI denetçisisin. Sana bir Android uygulamasının TEK bir ekran görüntüsü ve ekrandaki etkileşimli öğelerin listesi verilir.

Görevin: yalnız bu görüntüde GÖRÜNEN, kullanıcıyı gerçekten etkileyen sorunları bulmak — metin taşması/kesilmesi, üst üste binen öğeler, okunaksız kontrast, bozuk hizalama, tutarsız boşluk, anlamsız/boş durumlar, hatalı ya da İngilizce-Türkçe karışık metin, erişilebilirlik sorunları.

Kurallar:
- Görmediğin şeyi varsayma. Emin değilsen bulgu yazma ya da güvenini "zayıf" işaretle.
- Statik görüntü kaydırmayı göstermez: kaydırılabilir bir listenin alt kenarda kesilmesi hata DEĞİLDİR.
- Durum çubuğu, sistem gezinme çubuğu ve emülatör kaynaklı öğeler uygulamanın sorunu değildir.
- Zevk tercihlerini (renk seçimi, yazı tipi beğenisi) bulgu yapma; somut kullanılabilirlik etkisi olmalı.
- Sorun yoksa boş bulgu listesi döndür. Az ve doğru bulgu, çok ve şüpheli bulgudan iyidir.
- Tüm metinleri Türkçe yaz.`;

/** dp → px: dokunma hedefi kontrolü için cihaz yoğunluğu (dpi / 160). */
export function touchTargetFindings(node, density) {
  if (!density) return [];
  const minPx = Math.round((MIN_TOUCH_DP * density) / 160);
  return (node.interactives || [])
    .filter((e) => e.kind !== 'field' && e.bounds)
    .filter((e) => Math.min(e.bounds.x2 - e.bounds.x1, e.bounds.y2 - e.bounds.y1) < minPx)
    .map((e) => ({
      category: 'erişilebilirlik', severity: 'orta', confidence: 'kesin', source: 'deterministik',
      title: `Dokunma hedefi küçük: ${e.label || e.class}`,
      detail: `${e.bounds.x2 - e.bounds.x1}×${e.bounds.y2 - e.bounds.y1} px < ${minPx} px (${MIN_TOUCH_DP} dp). Parmakla isabet zorlaşır.`,
      location: `${e.center.x},${e.center.y}`,
    }));
}

function describeElements(node) {
  return (node.interactives || []).slice(0, 40).map((e) =>
    `- [${e.kind}] ${e.label ? JSON.stringify(e.label) : '(ETİKETSİZ — ekran okuyucu okuyamaz)'} @ ${e.center.x},${e.center.y}`).join('\n') || '(etkileşimli öğe yok)';
}

/**
 * Tek ekranı değerlendirir. `client` enjekte edilebilir (testte sahte istemci).
 * Hata/ret durumunda istisna atmaz; { error } döndürür — bir ekranın hatası
 * koşunun geri kalanını durdurmamalı.
 */
export async function judgeScreen({ client, model, effort, png, node }) {
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort, format: { type: 'json_schema', schema: FINDINGS_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
          { type: 'text', text: `Ekrandaki etkileşimli öğeler (erişilebilirlik ağacından):\n${describeElements(node)}\n\nBu ekranı değerlendir.` },
        ],
      }],
    });
    const usage = { input_tokens: response.usage?.input_tokens || 0, output_tokens: response.usage?.output_tokens || 0 };
    if (response.stop_reason === 'refusal') return { error: `model reddetti (${response.stop_details?.category || 'bilinmiyor'})`, usage };
    if (response.stop_reason === 'max_tokens') return { error: 'yanıt max_tokens sınırında kesildi', usage };
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text);
    return { summary: parsed.screen_summary, findings: parsed.findings.map((f) => ({ ...f, source: 'vision' })), usage };
  } catch (e) {
    // SDK 429/5xx/bağlantı hatalarını zaten 2 kez yeniden dener. Kimlik/izin hatası
    // tüm ekranlar için aynıdır → koşuyu durdur; diğerleri bu ekranla sınırlı kalsın.
    if (e?.status === 401 || e?.status === 403) throw new Error(`Anthropic API kimlik doğrulaması başarısız (HTTP ${e.status}) — ANTHROPIC_API_KEY'i kontrol et`);
    const status = e?.status ? `HTTP ${e.status}: ` : '';
    return { error: `${status}${e?.message || e}` };
  }
}

/**
 * Haritadaki ekranları değerlendirir → judge.json.
 * maxScreens: maliyet sınırı (ekran sırasına göre ilk N).
 */
export async function judge({ mapDir, out, model = DEFAULT_MODEL, effort = 'medium', maxScreens = 12, client } = {}) {
  const graphPath = join(mapDir, 'graph.json');
  if (!existsSync(graphPath)) throw new Error(`graph.json yok: ${graphPath} (önce: testful map)`);
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const density = graph.device?.density || null;

  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new Error('ANTHROPIC_API_KEY yok — görsel hakem için gerekli (CI: repo Secrets)');
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic();
  }

  const nodes = Object.values(graph.nodes).sort((a, b) => a.order - b.order);
  const screens = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  for (const node of nodes.slice(0, maxScreens)) {
    const pngPath = join(mapDir, node.screenshot);
    const deterministic = touchTargetFindings(node, density);
    if (!existsSync(pngPath)) { screens.push({ sig: node.sig, order: node.order, findings: deterministic, error: 'ekran görüntüsü yok' }); continue; }
    qlog(`[JUDGE] ekran ${node.order} (${node.sig})`);
    const r = await judgeScreen({ client, model, effort, png: readFileSync(pngPath), node });
    if (r.usage) { usage.input_tokens += r.usage.input_tokens; usage.output_tokens += r.usage.output_tokens; }
    if (r.error) qlog(`  [UYARI] ${r.error}`);
    screens.push({ sig: node.sig, order: node.order, summary: r.summary || null, findings: [...deterministic, ...(r.findings || [])], error: r.error || null });
  }
  const skipped = Math.max(0, nodes.length - maxScreens);
  const result = { model, effort, judged: screens.length, skipped, usage, screens };
  if (out) writeFileSync(out, JSON.stringify(result, null, 2));
  const total = screens.reduce((n, s) => n + s.findings.length, 0);
  qlog(`[JUDGE] ${screens.length} ekran · ${total} bulgu · ${usage.input_tokens}+${usage.output_tokens} token${skipped ? ` · ${skipped} ekran sınır nedeniyle atlandı` : ''}`);
  return result;
}

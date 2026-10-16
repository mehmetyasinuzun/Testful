// Keşif kararlarının saf (cihazsız, test edilebilir) kısmı: alan sınıflandırma,
// riskli/gönder öğe tanıma, aday sırası, gezinme yolu, kaydırma kapsayıcısı.
// Cihazla konuşan döngü map.mjs'tedir.
import { elementKey } from './tree.mjs';

/**
 * Türkçe-güvenli büyük/küçük harf katlama. Android butonları cihaz diline göre büyük
 * harfe çevirir ("Giriş" → İngilizce cihazda "GIRIŞ", Türkçe cihazda "GİRİŞ"); JS'in
 * /i bayrağı ı/İ/I'yı eşlemez. Etiket ve desen aynı biçime indirilip karşılaştırılır.
 */
export const fold = (s) => String(s).replace(/[İIı]/g, 'i').toLowerCase().normalize('NFC');
const trRegex = (re) => new RegExp(fold(re.source), 'i');

/** Dokunulmaması gerekenler: veri silen, oturumu kapatan, para harcayan öğeler. */
export const RISKY = /delete|remove|uninstall|log ?out|sign ?out|deactivate|\bsil\b|sil$|çıkış|kaldır|sıfırla|reset|satın|buy|purchase|ödeme yap|öde\b|\bpay\b|subscribe|abone/i;

/** Formu gönderen buton etiketleri (TR/EN). */
export const SUBMIT = /^(giriş|giriş yap|oturum aç|login|log in|sign in|devam|devam et|continue|ileri|next|gönder|submit|doğrula|verify|onayla|confirm|kaydol|kayıt ol|sign up|register|tamam|ok)$/i;

const OTP_SRC = /otp|doğrulama kodu|onay kodu|verification|one.?time|\bkod\b|\bcode\b|\bpin\b/i;
const EMAIL_SRC = /e-?posta|e-?mail|mail|@|kullanıcı adı|username|user name|kullanıcı/i;
const PHONE_SRC = /telefon|phone|gsm|cep|mobile/i;
const PASSWORD_SRC = /şifre|parola|password|passcode/i;

const [RISKY_F, SUBMIT_F, OTP_RE, EMAIL_RE, PHONE_RE, PASSWORD_RE] =
  [RISKY, SUBMIT, OTP_SRC, EMAIL_SRC, PHONE_SRC, PASSWORD_SRC].map(trRegex);

export const isRisky = (el) => Boolean(el.label && RISKY_F.test(fold(el.full_text || el.label)));
export const isSubmit = (el) => el.kind !== 'field' && Boolean(el.label && SUBMIT_F.test(fold(el.label.trim())));

/** Bir metin alanının türü: password | otp | email | phone | text. */
export function classifyField(el) {
  const hay = fold(`${el.full_text || el.label || ''} ${el.resource_id || ''}`);
  if (el.password || PASSWORD_RE.test(hay)) return 'password';
  if (OTP_RE.test(hay)) return 'otp';
  if (PHONE_RE.test(hay)) return 'phone';
  if (EMAIL_RE.test(hay)) return 'email';
  return 'text';
}

/** Alan türü → gizli değişken (.qa/env.local ya da CI Secrets, MAESTRO_ önekli). */
export const SECRET_FOR = { password: 'MAESTRO_PASSWORD', email: 'MAESTRO_EMAIL', otp: 'MAESTRO_OTP', phone: 'MAESTRO_PHONE' };
/** Gizli değer yoksa yazılacak, biçimi geçerli sahte değerler (doğrulama ekranları da keşfedilsin). */
export const FALLBACK = { password: 'Test1234!', email: 'test@example.com', otp: '123456', phone: '5551234567', text: 'Test' };

/** Ekran bir giriş/OTP formu mu? (şifre alanı ya da OTP alanı/kutucukları içeriyor) */
export function formKind(els) {
  const fields = els.filter((e) => e.kind === 'field');
  if (!fields.length) return null;
  const kinds = fields.map(classifyField);
  if (kinds.includes('password')) return 'login';
  if (kinds.includes('otp') || (fields.length >= 4 && fields.every((f) => !f.label || f.label.length <= 1))) return 'otp';
  return null;
}

/**
 * Sıradaki dokunulacak öğe: denenmemiş, riskli olmayan, alan olmayan.
 * Sıra: etiketliler → etiketsizler → gönder butonları (önce ekranın geri kalanı keşfedilir).
 */
export function orderCandidates(els, tried) {
  const open = els.filter((e) => e.kind !== 'field' && !tried.has(elementKey(e)) && !isRisky(e));
  const sub = open.filter(isSubmit);
  const rest = open.filter((e) => !isSubmit(e));
  return [...rest.filter((e) => e.label), ...rest.filter((e) => !e.label), ...sub];
}

/** Bilinen geçişler üzerinden from → (pred'i sağlayan ilk düğüm) en kısa yol (BFS). */
export function shortestPath(edges, from, pred) {
  if (pred(from)) return [];
  const adj = new Map();
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e);
  }
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of adj.get(cur) || []) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, e);
      if (pred(e.to)) {
        const path = [];
        for (let x = e; x; x = prev.get(x.from)) path.unshift(x);
        return path;
      }
      queue.push(e.to);
    }
  }
  return null;
}

/** Kaydırılabilir kapsayıcı (en büyüğü) — kaydırma hareketinin sınırları. */
export function mainScrollable(nodes, pkg) {
  const own = nodes.filter((n) => n.scrollable && n.bounds && (!pkg || n.pkg === pkg));
  const area = (b) => (b.x2 - b.x1) * (b.y2 - b.y1);
  return own.sort((a, b) => area(b.bounds) - area(a.bounds))[0] || null;
}

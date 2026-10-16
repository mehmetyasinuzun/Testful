// Keşif kararlarının saf (cihazsız, test edilebilir) kısmı: alan sınıflandırma,
// giriş bilgisi seçimi, riskli öğe filtresi, aday seçimi, gezinme yolu.
// Cihazla konuşan döngü map.mjs'tedir.

/**
 * Türkçe-güvenli büyük/küçük harf katlama. Android butonları cihaz diline göre büyük
 * harfe çevirir ("Giriş" → İngilizce cihazda "GIRIŞ", Türkçe cihazda "GİRİŞ"); JS'in
 * /i bayrağı ı/İ/I'yı eşlemez. Etiket ve desen aynı biçime indirilip karşılaştırılır.
 */
export const fold = (s) => String(s).replace(/[İIı]/g, 'i').toLowerCase().normalize('NFC');
const trRegex = (re) => new RegExp(fold(re.source), 'i');

/** Dokunulmaması gerekenler: veri silen, oturumu kapatan, para harcayan öğeler. */
export const RISKY = /delete|remove|uninstall|log ?out|sign ?out|\bsil\b|sil$|çıkış|kaldır|sıfırla|reset|satın al|buy|purchase|ödeme yap|öde\b|\bpay\b|subscribe|abone ol/i;

/** Formu gönderen buton etiketleri (TR/EN). */
export const SUBMIT = /^(giriş|giriş yap|oturum aç|login|log in|sign in|devam|devam et|continue|ileri|next|gönder|submit|doğrula|verify|onayla|confirm|kaydol|kayıt ol|sign up|register|tamam|ok)$/i;

const OTP_RE_SRC = /otp|doğrulama kodu|onay kodu|verification|one.?time|\bkod\b|\bcode\b|\bpin\b/i;
const EMAIL_RE_SRC = /e-?posta|e-?mail|mail|kullanıcı adı|username|user name|kullanıcı/i;
const PHONE_RE_SRC = /telefon|phone|gsm|cep|mobile/i;
const PASSWORD_RE_SRC = /şifre|parola|password|passcode/i;

const [RISKY_F, SUBMIT_F, OTP_RE, EMAIL_RE, PHONE_RE, PASSWORD_RE] =
  [RISKY, SUBMIT, OTP_RE_SRC, EMAIL_RE_SRC, PHONE_RE_SRC, PASSWORD_RE_SRC].map(trRegex);

export const isRisky = (el) => Boolean(el.label && RISKY_F.test(fold(el.full_text || el.label)));
export const isSubmit = (el) => el.kind !== 'field' && Boolean(el.label && SUBMIT_F.test(fold(el.label.trim())));

/** Bir metin alanının türü: password | otp | email | phone | text. */
export function classifyField(el) {
  const hay = fold(`${el.label || ''} ${el.id || ''}`);
  if (el.password || PASSWORD_RE.test(hay)) return 'password';
  if (OTP_RE.test(hay)) return 'otp';
  if (PHONE_RE.test(hay)) return 'phone';
  if (EMAIL_RE.test(hay)) return 'email';
  return 'text';
}

/**
 * Alan türüne göre yazılacak değer. Gerçek test hesabı ortam değişkenlerinden gelir
 * (CI'da GitHub Secrets); yoksa biçimi geçerli sahte değerler kullanılır — böylece
 * doğrulama mesajları da keşfedilir.
 */
export function valueFor(kind, env = process.env) {
  switch (kind) {
    case 'password': return env.TESTFUL_LOGIN_PASSWORD || 'Test1234!';
    case 'otp': return env.TESTFUL_LOGIN_OTP || '123456';
    case 'phone': return env.TESTFUL_LOGIN_PHONE || env.TESTFUL_LOGIN_USER || '5551234567';
    case 'email': return env.TESTFUL_LOGIN_USER || 'test@example.com';
    default: return 'Test';
  }
}

/** Ekran bir giriş/OTP formu mu? (şifre alanı ya da OTP alanı içeriyor) */
export function formKind(els) {
  const fields = els.filter((e) => e.kind === 'field');
  if (!fields.length) return null;
  const kinds = fields.map(classifyField);
  if (kinds.includes('password')) return 'login';
  if (kinds.includes('otp') || (fields.length >= 4 && fields.every((f) => !f.label || f.label.length <= 1))) return 'otp';
  return null;
}

/** Öğenin kararlı anahtarı: etiket > kaynak kimliği > sınıf@konum. */
export const elKey = (el) => el.label || (el.id ? `#${el.id}` : `${el.class}@${el.center.x},${el.center.y}`);

/**
 * Sıradaki dokunulacak öğe: denenmemiş, riskli olmayan, alan olmayan.
 * Gönder butonları sona bırakılır (önce ekranın geri kalanı keşfedilir);
 * formu bilerek dolduran yol gönderiyi ayrıca tetikler.
 */
export function pickCandidate(els, tried) {
  const open = els.filter((e) => e.kind !== 'field' && !tried.has(elKey(e)) && !isRisky(e));
  return open.find((e) => !isSubmit(e)) || open[0] || null;
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

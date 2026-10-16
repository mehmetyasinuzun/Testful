#!/usr/bin/env node
// Testful CI: Supabase projesinde onaylı bir TEST kullanıcısı olduğundan emin olur,
// böylece keşif ve senaryolar giriş duvarını geçebilir.
//
// Güvenlik:
// - service_role anahtarı yalnız CI'da (GitHub Secrets) kullanılır; uygulamaya girmez.
// - Betik yalnız KENDİ oluşturduğu kullanıcıya dokunur (user_metadata.testful_test_user).
//   Aynı e-postayla gerçek bir kullanıcı varsa şifresini DEĞİŞTİRMEZ, hata verir.
// - Önerilen: testleri ayrı bir staging Supabase projesine karşı koşmak.
//
// env: SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY MAESTRO_EMAIL MAESTRO_PASSWORD
//      [MAESTRO_PHONE]
// İstemci: resmi supabase-js'in GoTrueAdminApi'si ile aynı REST uçları.

import { pathToFileURL } from 'node:url';

const MARK = 'testful_test_user';

export function adminClient({ url, key, fetchImpl = fetch }) {
  const base = `${url.replace(/\/+$/, '')}/auth/v1/admin/users`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const call = async (method, path = '', body) => {
    const r = await fetchImpl(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { status: r.status, ok: r.ok, json, text };
  };
  return {
    create: (attrs) => call('POST', '', attrs),
    update: (id, attrs) => call('PUT', `/${id}`, attrs),
    list: (page, perPage = 200) => call('GET', `?page=${page}&per_page=${perPage}`),
  };
}

async function findByEmail(api, email) {
  const want = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const r = await api.list(page);
    if (!r.ok) throw new Error(`kullanıcılar listelenemedi: HTTP ${r.status}`);
    const users = r.json?.users || [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === want);
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

/** Test kullanıcısını oluşturur ya da (yalnız Testful'un kullanıcısıysa) şifresini eşitler. */
export async function ensureTestUser({ url, key, email, password, phone, fetchImpl }) {
  const api = adminClient({ url, key, fetchImpl });
  const attrs = {
    email, password, email_confirm: true,
    user_metadata: { [MARK]: true },
    ...(phone ? { phone, phone_confirm: true } : {}),
  };
  const created = await api.create(attrs);
  if (created.ok) return { action: 'created', id: created.json?.id };

  const exists = created.status === 422 || /already|exists|registered/i.test(created.text);
  if (!exists) throw new Error(`test kullanıcısı oluşturulamadı: HTTP ${created.status} ${created.json?.msg || created.json?.message || ''}`.trim());

  const user = await findByEmail(api, email);
  if (!user) throw new Error('kullanıcı var dendi ama listede bulunamadı');
  if (!user.user_metadata?.[MARK]) {
    throw new Error(`${email} Testful tarafından oluşturulmamış (gerçek bir kullanıcı olabilir) — şifresi değiştirilmedi. Ayrı bir test e-postası kullan.`);
  }
  const upd = await api.update(user.id, { password, email_confirm: true, ...(phone ? { phone, phone_confirm: true } : {}) });
  if (!upd.ok) throw new Error(`test kullanıcısı güncellenemedi: HTTP ${upd.status}`);
  return { action: 'updated', id: user.id };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, MAESTRO_EMAIL: email, MAESTRO_PASSWORD: password, MAESTRO_PHONE: phone } = process.env;
  if (!url || !key) {
    console.log('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY yok — test kullanıcısı adımı atlanıyor');
  } else if (!email || !password) {
    console.log('::warning::Supabase anahtarları var ama MAESTRO_EMAIL / MAESTRO_PASSWORD yok — test kullanıcısı hazırlanmadı');
  } else {
    try {
      const r = await ensureTestUser({ url, key, email, password, phone });
      console.log(`Supabase test kullanıcısı hazır (${r.action})`);
    } catch (e) {
      console.log(`::error::Supabase: ${e.message}`);
      process.exit(1);
    }
  }
}

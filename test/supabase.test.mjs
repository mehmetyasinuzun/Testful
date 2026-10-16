import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureTestUser } from '../ci/supabase-test-user.mjs';

/** Bellek içi GoTrue admin API taklidi. */
function fakeGoTrue(initial = []) {
  const users = [...initial];
  const calls = [];
  const fetchImpl = async (url, { method, headers, body }) => {
    const u = new URL(url);
    calls.push({ method, path: u.pathname, auth: headers.Authorization });
    const json = (status, obj) => ({ status, ok: status < 300, text: async () => JSON.stringify(obj) });
    const data = body ? JSON.parse(body) : null;
    if (method === 'POST') {
      if (users.some((x) => x.email === data.email)) return json(422, { code: 'email_exists', msg: 'A user with this email address has already been registered' });
      const user = { id: `id-${users.length + 1}`, email: data.email, user_metadata: data.user_metadata, password: data.password };
      users.push(user);
      return json(200, user);
    }
    if (method === 'GET') return json(200, { users });
    if (method === 'PUT') {
      const id = u.pathname.split('/').pop();
      const user = users.find((x) => x.id === id);
      Object.assign(user, { password: data.password });
      return json(200, user);
    }
    return json(405, {});
  };
  return { users, calls, fetchImpl };
}

const base = { url: 'https://abc.supabase.co/', key: 'service-key', email: 'qa+testful@ornek.com', password: 'G1zli' };

test('supabase: yoksa onaylı test kullanıcısı oluşturur ve işaretler', async () => {
  const gt = fakeGoTrue();
  const r = await ensureTestUser({ ...base, fetchImpl: gt.fetchImpl });
  assert.equal(r.action, 'created');
  assert.equal(gt.users[0].user_metadata.testful_test_user, true);
  assert.equal(gt.calls[0].path, '/auth/v1/admin/users');
  assert.equal(gt.calls[0].auth, 'Bearer service-key');
});

test('supabase: kendi test kullanıcısının şifresini eşitler (idempotent)', async () => {
  const gt = fakeGoTrue([{ id: 'u1', email: base.email, user_metadata: { testful_test_user: true }, password: 'eski' }]);
  const r = await ensureTestUser({ ...base, fetchImpl: gt.fetchImpl });
  assert.equal(r.action, 'updated');
  assert.equal(gt.users[0].password, 'G1zli');
});

test('supabase: gerçek (Testful dışı) kullanıcının şifresine DOKUNMAZ', async () => {
  const gt = fakeGoTrue([{ id: 'u1', email: base.email, user_metadata: {}, password: 'gercek' }]);
  await assert.rejects(ensureTestUser({ ...base, fetchImpl: gt.fetchImpl }), /oluşturulmamış/);
  assert.equal(gt.users[0].password, 'gercek');
  assert.ok(!gt.calls.some((c) => c.method === 'PUT'));
});

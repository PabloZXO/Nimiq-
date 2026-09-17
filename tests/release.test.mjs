import test from 'node:test';
import assert from 'node:assert/strict';
import { RateLimit } from '../server/rate-limit.mjs';
import { Store } from '../server/store.mjs';
import { makeServer } from '../server/index.mjs';
import { api, ApiError } from '../src/api.ts';

test('request quotas expire and cannot grow past their memory budget', () => {
  let now = 0;
  const limits = new RateLimit(2, { capacity: 2, clock: () => now });
  assert.equal(limits.take('a'), 0); assert.equal(limits.take('a'), 0);
  assert.equal(limits.take('a'), 60); assert.equal(limits.take('b'), 0);
  assert.equal(limits.take('c'), 60); assert.equal(limits.entries.size, 2);
  now = 60_000;
  assert.equal(limits.take('c'), 0); assert.equal(limits.take('a'), 0);
});

test('players behind one proxy have independent limits; forged cookies cannot create quotas', async t => {
  const store = new Store(':memory:');
  const server = makeServer({ store, secureCookies: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const alice = store.createSession('Alice'), bob = store.createSession('Bob');
  const get = token => fetch(base + '/api/session', { headers: { Cookie: `nimduel_session=${token}`, 'X-Forwarded-For': crypto.randomUUID() } });
  for (let i = 0; i < 300; i++) assert.equal((await get(alice.token)).status, 200);
  const limited = await get(alice.token);
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await get(bob.token)).status, 200);
  for (let i = 0; i < 1000; i++) assert.equal((await get('fake-' + i)).status, 200);
  assert.equal((await get('another-forged-cookie')).status, 429);
  assert.equal((await get(bob.token)).status, 200);
  assert.equal((await fetch(base + '/%ZZ')).status, 400);
});

test('API recovers from offline and hung connections, preserving explicit cancellation and server errors', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; t.mock.timers.reset(); });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api('/session'), e => e instanceof ApiError && e.message === 'NETWORK_ERROR');
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'SESSION_REQUIRED' }), { status: 401 });
  await assert.rejects(api('/session'), /SESSION_REQUIRED/);
  globalThis.fetch = async () => new Response('<html>Proxy unavailable</html>', { status: 502 });
  await assert.rejects(api('/session'), /NETWORK_ERROR/);
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = assert.rejects(api('/session'), /NETWORK_ERROR/);
  t.mock.timers.tick(15_000); await pending;
  const controller = new AbortController();
  const cancelled = assert.rejects(api('/session', undefined, controller.signal), { name: 'AbortError' });
  controller.abort(); await cancelled;
  globalThis.fetch = async () => new Response(JSON.stringify({ user: null }));
  assert.deepEqual(await api('/session'), { user: null });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { makeServer } from '../server/index.mjs';
import { identify } from './helpers/identity.mjs';

test('game endpoints require both wallet proof and a registered nickname, including direct API calls', async t => {
  const store = new Store(':memory:');
  const server = makeServer({ store, secureCookies: false });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const guest = store.createSession('Guest');
  const verified = identify(store, store.createSession('Verified'), null, base);
  const full = identify(store, store.createSession('Player'), 'onboarded', base);
  const settings = { topic: 'math', difficulty: 'normal', language: 'en', mode: 'friends', capacity: 2 };
  const room = store.create(full.user, settings);
  const call = (token, path, body) => fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: `nimduel_session=${token}`, Origin: base, 'X-Nimduel-Client': '1', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const [session, error] of [[guest, 'VERIFIED_WALLET_REQUIRED'], [verified, 'NICKNAME_REQUIRED']]) {
    for (const [path, body] of [['/rooms', settings], ['/rooms'], ['/progress'], ['/search/start', settings], [`/rooms/${room.code}/join`, {}], [`/rooms/${room.code}/start`, {}], [`/rooms/${room.code}/payment`]]) {
      const r = await call(session.token, path, body); assert.equal(r.status, 403, path); assert.equal((await r.json()).error, error);
    }
    assert.equal(store.history(session.user.id).length, 0);
  }
  assert.equal((await call(verified.token, '/nickname', { nickname: 'onboarded' })).status, 409);
  assert.equal((await call(verified.token, '/nickname', { nickname: 'new_player' })).status, 200);
  const joined = await call(verified.token, `/rooms/${room.code}/join`, {}); assert.equal(joined.status, 200);
  assert.equal((await joined.json()).players.length, 2);
  assert.equal((await call(verified.token, '/session')).status, 200);
  assert.equal((await call(verified.token, `/rooms/${room.code}/leave`, {})).status, 200);
  assert.equal((await call(verified.token, '/logout', {})).status, 200);
  assert.equal((await call(verified.token, '/rooms')).status, 401);
});

test('legacy wallet players can complete mandatory nickname registration without losing an active room', t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const session = identify(store, store.createSession('Legacy'), null);
  const room = store.create(session.user, { topic: 'math', difficulty: 'easy', language: 'en', mode: 'practice' });
  const user = store.claimNickname(session.user, 'legacy_player');
  assert.equal(store.session(session.token).nickname, 'legacy_player');
  assert.equal(store.view(room.code, user.id).me.id, user.id);
  assert.equal(store.history(user.id).length, 1);
});

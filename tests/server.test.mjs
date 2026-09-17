import { identify } from './helpers/identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { Store } from '../server/store.mjs';
import { makeServer } from '../server/index.mjs';

const settings = { topic: 'math', difficulty: 'normal', mode: 'friends', language: 'uk', capacity: 2 };

test('HTTP sessions, room authorization, CSRF, last seat and payment rejection', async t => {
  const store = new Store(':memory:');
  const server = makeServer({ store, secureCookies: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  let counter = 0;
  async function client(name) {
    const response = await fetch(origin + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nimduel-Client': '1', Origin: origin }, body: JSON.stringify({ name }) });
    assert.equal(response.status, 200);
    const guestToken = response.headers.get('set-cookie').split(';')[0].split('=')[1];
    const verified = identify(store, { token: guestToken, user: (await response.json()).user }, 'qa_' + (++counter), origin);
    const cookie = 'nimduel_session=' + verified.token;
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    return async (path, data, headers = {}) => {
      const result = await fetch(origin + '/api' + path, { method: data === undefined ? 'GET' : 'POST',
        headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-Nimduel-Client': '1', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
      return { status: result.status, body: await result.json() };
    };
  }
  const alice = await client('Аліса'); const bob = await client('Богдан'); const carol = await client('Кароліна');
  assert.equal((await alice('/session')).body.user.name, '@qa_1');
  const created = await alice('/rooms', settings); assert.equal(created.status, 201);
  const code = created.body.code;
  assert.equal((await bob(`/rooms/${code}`)).status, 403);
  assert.equal((await alice('/rooms', settings)).body.error, 'ACTIVE_ROOM_EXISTS');
  const seats = await Promise.all([bob(`/rooms/${code}/join`, {}), carol(`/rooms/${code}/join`, {})]);
  assert.deepEqual(seats.map(r => r.status).sort(), [200, 409]);
  const joined = seats[0].status === 200 ? bob : carol;
  const room = (await alice(`/rooms/${code}`)).body;
  assert.equal(room.players.length, 2);
  assert.equal((await alice(`/rooms/${code}/ready`, { rulesVersion: room.rulesVersion }, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await alice(`/rooms/${code}/ready`, { rulesVersion: room.rulesVersion }, { 'X-Nimduel-Client': '' })).status, 403);
  await alice(`/rooms/${code}/ready`, { rulesVersion: room.rulesVersion });
  await joined(`/rooms/${code}/ready`, { rulesVersion: room.rulesVersion });
  const started = (await alice(`/rooms/${code}/start`, {})).body;
  assert.ok(started.question); assert.equal(started.question.answer, undefined);
  const history = await alice('/rooms'); assert.equal(history.body.rooms.length, 1);
  const extra = await client('Данило');
  assert.equal((await extra('/rooms', { ...settings, stake: 10 })).body.error, 'PAYMENTS_UNAVAILABLE');
  assert.equal((await extra('/session', { name: '\u202Efake' })).body.error, 'INVALID_NAME');
  const health = await fetch(origin + '/api/health'); assert.equal(health.status, 200);
});

test('database survives reopen; restart cancels active matches and keeps completed history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nimduel-test-'));
  const path = join(directory, 'game.sqlite'); let now = 100000;
  let store = new Store(path, () => now);
  try {
    const a = store.createSession('Аліса'); const b = store.createSession('Богдан');
    const practice = store.create(a.user, { ...settings, mode: 'practice' });
    now += 1; store.action(practice.code, a.user, 'finish', {});
    const room = store.create(a.user, settings);
    store.action(room.code, b.user, 'join', {});
    const version = store.view(room.code, a.user.id).rulesVersion;
    store.action(room.code, a.user, 'ready', { rulesVersion: version });
    store.action(room.code, b.user, 'ready', { rulesVersion: version });
    store.close(); store = new Store(path, () => now);
    assert.deepEqual(store.session(a.token), a.user);
    store.tick(true);
    assert.equal(store.view(room.code, a.user.id).status, 'void');
    assert.equal(store.view(practice.code, a.user.id).status, 'completed');
    assert.equal(store.history(a.user.id).length, 2);
  } finally {
    store.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('nimduel-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('invalid mutations roll back and never consume a seat', () => {
  const store = new Store(':memory:');
  try {
    const a = store.createSession('A').user; const b = store.createSession('B').user;
    const room = store.create(a, settings); store.create(b, settings);
    assert.throws(() => store.action(room.code, b, 'join', {}), /ACTIVE_ROOM_EXISTS/);
    assert.equal(store.view(room.code, a.id).players.length, 1);
  } finally { store.close(); }
});

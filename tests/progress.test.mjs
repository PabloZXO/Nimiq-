import { identify } from './helpers/identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { questionDeck, publicQuestion } from '../server/questions.mjs';
import { makeServer } from '../server/index.mjs';

const input = { topic: 'mixed', difficulty: 'normal', language: 'uk', mode: 'practice' };
function fixture(t) {
  let now = 100000;
  const store = new Store(':memory:', () => now++);
  const a = store.createSession('A').user, b = store.createSession('B').user, c = store.createSession('C').user;
  t.after(() => store.close());
  return { store, a, b, c, later: ms => { now += ms; } };
}
function answer(store, code, user, value) {
  const p = store.load(code).players.find(p => p.id === user.id), q = p.questions[p.index];
  return store.action(code, user, 'answer', { questionId: q.id, requestId: randomUUID(), value: value === true ? q.answer : value });
}
function start(store, code, users) {
  const rulesVersion = store.view(code, users[0].id).rulesVersion;
  for (const u of users) store.action(code, u, 'ready', { rulesVersion });
  for (const u of users) store.action(code, u, 'start', {});
}

test('mixed decks balance every prefix, all levels and languages; public answers stay hidden', () => {
  for (const lang of ['en', 'es', 'fr', 'de', 'pt', 'uk']) for (const difficulty of ['easy', 'normal', 'hard']) {
    const deck = questionDeck('mixed', difficulty, lang);
    assert.equal(new Set(deck.map(q => q.id)).size, 30);
    deck.forEach((q, i) => {
      assert.equal(q.kind, ['math', 'flags', 'capitals'][i % 3]);
      assert.equal(publicQuestion(q).answer, undefined);
      if (q.kind === 'capitals') assert.notEqual(q.countryCode, 'ZA');
    });
  }
});

test('mistakes are private, survive subsequent rounds, rekey options and clear only after completion', t => {
  const { store, a, b } = fixture(t);
  const first = store.create(a, input);
  answer(store, first.code, a, '9999999');
  answer(store, first.code, a, null);
  answer(store, first.code, a, true);
  assert.equal(store.progress(a.id).games, 0);
  store.action(first.code, a, 'finish', {});
  assert.equal(store.progress(a.id).mistakes, 2);
  assert.equal(store.progress(b.id).mistakes, 0);
  assert.throws(() => store.create(b, { ...input, training: 'mistakes' }), /NO_MISTAKES/);
  const training = store.create(a, { ...input, language: 'fr', training: 'mistakes' });
  assert.equal(training.questionCount, 2); assert.equal(training.training, true);
  assert.equal(training.trainingQuestions, undefined);
  const old = store.load(first.code).players[0].questions;
  const fresh = store.load(training.code).players[0].questions;
  for (const q of fresh) {
    assert.ok(!old.some(o => o.id === q.id));
    for (const option of q.options ?? []) assert.ok(!old.some(o => o.options?.some(x => x.id === option.id)));
  }
  answer(store, training.code, a, true);
  assert.equal(store.progress(a.id).mistakes, 2);
  const done = answer(store, training.code, a, true);
  assert.equal(done.status, 'completed'); assert.equal(store.progress(a.id).mistakes, 0);
  assert.equal(store.progress(a.id).groups.find(g => g.mode === 'mistakes').games, 1);
  assert.throws(() => store.rematch(training.code, a), /REMATCH_UNAVAILABLE/);
  assert.throws(() => store.create(a, { ...input, mode: 'friends', capacity: 2, training: 'mistakes' }), /INVALID_TRAINING/);
  assert.throws(() => store.create(a, { ...input, topic: 'chess', training: 'mistakes' }), /INVALID_TRAINING/);
});

test('group rematch converges on one reserved room, resets readiness and keeps original results', t => {
  const { store, a, b, c } = fixture(t);
  const d = store.createSession('D').user;
  const original = store.create(a, { ...input, mode: 'friends', capacity: 3 });
  store.action(original.code, b, 'join', {}); store.action(original.code, c, 'join', {});
  assert.throws(() => store.rematch(original.code, a), /REMATCH_UNAVAILABLE/);
  start(store, original.code, [a, b, c]);
  for (const u of [a, b, c]) store.action(original.code, u, 'finish', {});
  const next = store.rematch(original.code, b);
  assert.equal(next.capacity, 3); assert.equal(next.topic, 'mixed');
  assert.equal(next.status, 'lobby'); assert.equal(next.players.length, 1);
  assert.equal(store.rematch(original.code, b).code, next.code);
  assert.throws(() => store.rematch(original.code, d), /NOT_A_MEMBER/);
  assert.throws(() => store.action(next.code, d, 'join', {}), /REMATCH_MEMBERS_ONLY/);
  assert.equal(store.rematch(original.code, a).code, next.code);
  assert.equal(store.rematch(original.code, c).code, next.code);
  assert.ok(store.load(next.code).players.every(p => !p.ready && !p.answers.length));
  assert.equal(store.view(original.code, a.id).status, 'completed');
  start(store, next.code, [a, b, c]);
  assert.deepEqual(store.load(next.code).players.map(p => p.questions.map(q => q.kind)),
    Array.from({ length: 3 }, () => Array.from({ length: 30 }, (_, i) => ['math', 'flags', 'capitals'][i % 3])));
});

test('rematch cannot pull a player out of another active room', t => {
  const { store, a, b } = fixture(t);
  const r = store.create(a, { ...input, mode: 'friends', capacity: 2 });
  store.action(r.code, b, 'join', {}); start(store, r.code, [a, b]);
  for (const u of [a, b]) store.action(r.code, u, 'finish', {});
  store.create(b, input); const next = store.rematch(r.code, a);
  assert.throws(() => store.rematch(r.code, b), /ACTIVE_ROOM_EXISTS/);
  assert.equal(store.load(next.code).players.length, 1);
});

test('chess rematches swap humans and bot colors; a white bot starts through the clock', async t => {
  const { store, a, b, later } = fixture(t);
  const r = store.create(a, { ...input, topic: 'chess', mode: 'friends', capacity: 2 });
  store.action(r.code, b, 'join', {}); start(store, r.code, [a, b]);
  const before = store.view(r.code, a.id).chess.myColor;
  store.action(r.code, a, 'resign', {});
  const next = store.rematch(r.code, b); store.rematch(r.code, a); start(store, next.code, [a, b]);
  assert.notEqual(store.view(next.code, a.id).chess.myColor, before);
  store.action(next.code, a, 'resign', {});
  const practice = store.create(a, { ...input, topic: 'chess' });
  store.action(practice.code, a, 'resign', {});
  const bot = store.rematch(practice.code, a);
  assert.equal(bot.chess.myColor, 'b'); assert.equal(bot.chess.legalMoves.length, 0);
  later(500); store.tick(); await store.waitForBots();
  assert.equal(store.view(bot.code, a.id).chess.moves.length, 1);
  store.action(bot.code, a, 'resign', {});
  assert.equal(store.rematch(bot.code, a).chess.myColor, 'w');
});

test('paid rematch preserves the stake but never copies deposits or payment readiness', t => {
  const { store, a, b } = fixture(t);
  a.wallet = { address: 'test-a' }; b.wallet = { address: 'test-b' };
  store.payments = { status: () => ({ ready: true, address: 'test-bank' }) };
  const r = store.create(a, { ...input, mode: 'friends', capacity: 2, stake: 100000 });
  store.action(r.code, b, 'join', {});
  store.markFunded(r.code, [a, b].map(u => ({ playerId: u.id, address: u.wallet.address, amountLuna: 100000, hash: randomUUID() })));
  start(store, r.code, [a, b]);
  for (const u of [a, b]) store.action(r.code, u, 'finish', {});
  const next = store.rematch(r.code, a); store.rematch(r.code, b);
  assert.equal(next.stakeLuna, 100000);
  assert.ok(store.load(next.code).players.every(p => !p.fundedHash && !p.ready));
  assert.throws(() => store.action(next.code, a, 'ready', { rulesVersion: store.load(next.code).rulesVersion }), /DEPOSIT_REQUIRED/);
  assert.ok(store.load(r.code).players.every(p => p.fundedHash));
});

test('statistics include more than 40 games, separate modes and omit void games', t => {
  const { store, a, b } = fixture(t);
  for (let i = 0; i < 42; i++) {
    const room = store.create(a, { ...input, topic: 'math', difficulty: i % 2 ? 'easy' : 'hard' });
    answer(store, room.code, a, true); store.action(room.code, a, 'finish', {});
  }
  const r = store.create(a, input); store.tick(true);
  assert.equal(store.view(r.code, a.id).status, 'void');
  const progress = store.progress(a.id);
  assert.equal(progress.games, 42); assert.equal(store.history(a.id).length, 40);
  assert.equal(progress.groups.length, 2);
  assert.ok(progress.groups.every(g => g.games === 21 && g.correct === 21 && g.bestScore === 1 && g.wins === 0));
  assert.equal(store.progress(b.id).games, 0);
});

test('progress HTTP requires a session; completed mixed results and rematch use the same cookie', async t => {
  const { store } = fixture(t);
  const server = makeServer({ store, secureCookies: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/progress`)).status, 401);
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Nimduel-Client': '1' };
  const session = await fetch(`${base}/api/session`, { method: 'POST', headers, body: JSON.stringify({ name: 'HTTP' }) });
  const token = session.headers.get('set-cookie').split(';')[0].split('=')[1];
  const authenticated = identify(store, { token, user: (await session.json()).user }, 'http_player', base);
  headers.Cookie = 'nimduel_session=' + authenticated.token;
  const call = async (path, body) => {
    const res = await fetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
    assert.ok(res.ok, `${path}: ${res.status}`); return res.json();
  };
  const room = await call('/rooms', input);
  await call(`/rooms/${room.code}/finish`, {});
  assert.equal((await call('/progress')).games, 1);
  const next = await call(`/rooms/${room.code}/rematch`, {});
  assert.notEqual(next.code, room.code); assert.equal(next.topic, 'mixed');
});

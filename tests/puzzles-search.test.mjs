import { identify } from './helpers/identity.mjs';
import { getPuzzle } from '../server/puzzle-library.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Chess } from 'chess.js';
import catalog from '../server/puzzle-catalog.json' with { type: 'json' };
import { solver } from '../scripts/build-puzzles.mjs';
import { Store } from '../server/store.mjs';
import { makeServer } from '../server/index.mjs';

const input = { topic: 'math', difficulty: 'normal', language: 'en' };
const moveOf = s => ({ from: s.slice(0, 2), to: s.slice(2, 4), ...(s[4] ? { promotion: s[4] } : {}) });
function fixture(t) {
  let now = 100000;
  const store = new Store(':memory:', () => now);
  const users = Array.from({ length: 5 }, (_, i) => store.createSession('Player ' + i).user);
  t.after(() => store.close());
  return { store, users, later: ms => { now += ms; } };
}

test('24 legal original compositions have exact mate distances and sound branches against every defense', () => {
  assert.equal(catalog.length, 24);
  for (const n of [1, 2, 3]) assert.equal(catalog.filter(p => p.mate === n).length, 8);
  assert.equal(new Set(catalog.map(p => p.tree.fen)).size, 24);
  for (const puzzle of catalog) {
    const initial = new Chess(puzzle.tree.fen), attacker = initial.turn(), force = solver(attacker);
    assert.ok(force(initial, puzzle.mate * 2 - 1), puzzle.id);
    if (puzzle.mate > 1) assert.equal(force(initial, puzzle.mate * 2 - 3), false, puzzle.id);
    function verify(node, plies) {
      const engine = new Chess(node.fen);
      if (!Object.keys(node.choices).length) { assert.ok(engine.isCheckmate()); return; }
      for (const [key, choice] of Object.entries(node.choices)) {
        engine.move(moveOf(key));
        assert.ok(force(engine, plies - 1)); // Universal quantification on the defender's turn.
        if (choice.reply) engine.move(moveOf(choice.reply));
        assert.equal(engine.fen(), choice.next.fen);
        verify(choice.next, plies - 2);
        if (choice.reply) engine.undo();
        engine.undo();
      }
    }
    verify(puzzle.tree, puzzle.mate * 2 - 1);
  }
});

test('puzzles are private, free and solo; wrong moves stay put, retries deduplicate, solutions remain hidden', t => {
  const { store, users: [a, b] } = fixture(t);
  assert.throws(() => store.create(a, { ...input, topic: 'puzzles', mode: 'friends', capacity: 2 }), /PUZZLES_SOLO_ONLY/);
  assert.throws(() => store.create(a, { ...input, topic: 'puzzles', mode: 'practice', stake: 1 }), /PUZZLES_SOLO_ONLY/);
  const room = store.create(a, { ...input, topic: 'puzzles', mode: 'practice', difficulty: 'hard' });
  assert.equal(room.question, null); assert.ok(room.puzzle.mate >= 3 && room.puzzle.mate <= 5); assert.deepEqual(room.puzzle.solution, []);
  assert.equal(room.puzzle.path, undefined); assert.equal(room.puzzle.receipts, undefined);
  assert.throws(() => store.view(room.code, b.id), /NOT_A_MEMBER/);
  assert.throws(() => store.action(room.code, b, 'move', {}), /NOT_A_MEMBER/);
  let node = getPuzzle(store.load(room.code).puzzle.id).tree;
  const wrong = room.chess.legalMoves.find(m => !node.choices[m.from + m.to + (m.promotion ?? '')]);
  assert.ok(wrong);
  const body = { ...wrong, ply: 0, requestId: randomUUID() };
  const failed = store.action(room.code, a, 'move', body);
  assert.equal(failed.chess.fen, room.chess.fen); assert.equal(failed.puzzle.misses, 1);
  assert.equal(store.action(room.code, a, 'move', body).puzzle.misses, 1);
  assert.throws(() => store.action(room.code, a, 'move', { ...body, to: 'a1' }), /REQUEST_REUSED/);
  assert.ok(store.action(room.code, a, 'hint', {}).puzzle.hint);
  let current = failed;
  while (Object.keys(node.choices).length) {
    const choice = Object.values(node.choices)[0];
    current = store.action(room.code, a, 'move', { ...moveOf(choice.move), ply: current.puzzle.ply, requestId: randomUUID() });
    node = choice.next;
  }
  assert.equal(current.status, 'completed'); assert.equal(current.me.score, 1);
  assert.ok(current.puzzle.solution.length); assert.ok(new Chess(current.chess.fen).isCheckmate());
  assert.equal(store.progress(a.id).groups[0].correct, 1);
  assert.equal(store.progress(a.id).mistakes, 0);
  assert.throws(() => store.action(room.code, a, 'move', { ...wrong, ply: 0, requestId: randomUUID() }), /ROUND_ENDED/);
});

test('puzzle rotation avoids the previous seven; reveal records no solve; expiry voids abandoned attempts', t => {
  const { store, users: [a], later } = fixture(t); const ids = new Set();
  for (let i = 0; i < 8; i++) {
    const r = store.create(a, { ...input, topic: 'puzzles', mode: 'practice', difficulty: 'easy' });
    ids.add(store.load(r.code).puzzle.id); store.action(r.code, a, 'finish', {}); later(1);
  }
  assert.equal(ids.size, 8); assert.equal(store.progress(a.id).groups[0].correct, 0);
  const r = store.create(a, { ...input, topic: 'puzzles', mode: 'practice' }); later(1800000);
  assert.equal(store.view(r.code, a.id).status, 'void');
});

test('search pairs FIFO by topic and level, never self-matches or silently adds stakes, and keeps readiness explicit', t => {
  const { store, users: [a, b, c, d, e], later } = fixture(t);
  const first = store.search(a, 'start', input); assert.equal(first.status, 'searching');
  assert.equal(store.search(a, 'start', input).ticket, first.ticket);
  assert.throws(() => store.search(a, 'start', { ...input, topic: 'flags' }), /SEARCH_ACTIVE/);
  assert.throws(() => store.create(a, { ...input, mode: 'practice' }), /ACTIVE_ROOM_EXISTS/);
  store.search(b, 'start', { ...input, difficulty: 'hard' }); later(1);
  const matched = store.search(c, 'start', { ...input, language: 'uk' });
  assert.equal(matched.status, 'matched'); assert.equal(matched.room.stakeLuna, 0);
  assert.deepEqual(matched.room.players.map(p => p.id), [a.id, c.id]);
  assert.ok(matched.room.players.every(p => !p.ready));
  assert.equal(store.search(a, 'heartbeat', { ticket: first.ticket }).room.code, matched.room.code);
  assert.equal(store.search(b, 'view').status, 'searching');
  assert.throws(() => store.action(matched.room.code, d, 'join', {}), /REMATCH_MEMBERS_ONLY/);
  assert.throws(() => store.search(d, 'start', { ...input, stake: 100000 }), /PAYMENTS_UNAVAILABLE/);
  assert.throws(() => store.search(d, 'start', { ...input, topic: 'puzzles' }), /INVALID_TOPIC/);
  store.search(d, 'start', { ...input, difficulty: 'hard' });
  assert.deepEqual(store.search(b, 'view').room.players.map(p => p.id), [b.id, d.id]);
  assert.equal(store.search(e, 'start', input).status, 'searching');
});

test('cancel/assignment race cancels both unready seats; stale tickets cannot cancel a new search', t => {
  const { store, users: [a, b] } = fixture(t);
  const first = store.search(a, 'start', input);
  const found = store.search(b, 'start', input);
  assert.equal(store.search(a, 'cancel', { ticket: first.ticket }).status, 'idle');
  assert.equal(store.view(found.room.code, b.id).status, 'cancelled');
  const next = store.search(a, 'start', input);
  assert.equal(store.search(a, 'cancel', { ticket: first.ticket }).ticket, next.ticket);
  assert.equal(store.search(a, 'view').status, 'searching');
});

test('ready games cannot be cancelled through the queue; leaving a matched lobby releases both players', t => {
  const { store, users: [a, b] } = fixture(t);
  const queued = store.search(a, 'start', { ...input, topic: 'chess', difficulty: 'easy' });
  const found = store.search(b, 'start', { ...input, topic: 'chess', difficulty: 'hard' });
  assert.equal(found.status, 'matched');
  for (const u of [a, b]) store.action(found.room.code, u, 'ready', { rulesVersion: found.room.rulesVersion });
  assert.equal(store.search(a, 'cancel', { ticket: queued.ticket }).room.status, 'starting');
  store.tick(true);
  const second = store.search(a, 'start', input); assert.equal(second.status, 'searching');
  const next = store.search(b, 'start', input);
  store.action(next.room.code, b, 'leave', {});
  assert.equal(store.view(next.room.code, a.id).status, 'cancelled');
  assert.doesNotThrow(() => store.create(a, { ...input, mode: 'practice' }));
});

test('disconnected searches expire after 15 seconds; heartbeat cannot revive them; matched lobbies expire in 60 seconds', t => {
  const { store, users: [a, b], later } = fixture(t);
  const first = store.search(a, 'start', input); later(15000);
  assert.equal(store.search(a, 'heartbeat', { ticket: first.ticket }).status, 'idle');
  const second = store.search(b, 'start', input); assert.equal(second.status, 'searching');
  const found = store.search(a, 'start', input); later(60000);
  assert.equal(store.search(b, 'view').room.status, 'cancelled');
  assert.equal(store.load(found.room.code).reason, 'LOBBY_EXPIRED');
});

test('puzzle paths persist across database reopen, pending searches clear on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nimduel-puzzle-test-')); const path = join(directory, 'test.sqlite');
  let store = new Store(path, () => 100000);
  try {
    const a = store.createSession('A').user, b = store.createSession('B').user;
    const r = store.create(a, { ...input, topic: 'puzzles', mode: 'practice' });
    const choice = Object.values(getPuzzle(store.load(r.code).puzzle.id).tree.choices)[0];
    store.action(r.code, a, 'move', { ...moveOf(choice.move), ply: 0, requestId: randomUUID() });
    store.search(b, 'start', input); store.close(); store = new Store(path, () => 100000);
    assert.equal(store.view(r.code, a.id).puzzle.ply, 1);
    store.tick(true); assert.equal(store.search(b, 'view').status, 'idle');
    assert.equal(store.view(r.code, a.id).status, 'void');
  } finally {
    store.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); rmSync(directory, { recursive: true, force: true });
  }
});

test('search HTTP authenticates and enforces CSRF; polling and cancellation share the private ticket', async t => {
  const { store } = fixture(t); const server = makeServer({ store, secureCookies: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/search')).status, 401);
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Nimduel-Client': '1' };
  const session = await fetch(base + '/api/session', { method: 'POST', headers, body: JSON.stringify({ name: 'HTTP' }) });
  const token = session.headers.get('set-cookie').split(';')[0].split('=')[1];
  const authenticated = identify(store, { token, user: (await session.json()).user }, 'http_player', base);
  headers.Cookie = 'nimduel_session=' + authenticated.token;
  const post = (path, data, extra = {}) => fetch(base + '/api/search/' + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(data) });
  assert.equal((await post('start', input, { Origin: 'https://evil.invalid' })).status, 403);
  const queued = await (await post('start', input)).json(); assert.equal(queued.status, 'searching');
  assert.equal((await (await post('heartbeat', { ticket: queued.ticket })).json()).status, 'searching');
  assert.equal((await (await post('cancel', { ticket: queued.ticket })).json()).status, 'idle');
});

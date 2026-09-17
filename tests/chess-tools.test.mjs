import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';
import { Store } from '../server/store.mjs';
import { replayPositions } from '../src/chessReplay.ts';

const settings = { topic: 'chess', mode: 'practice', difficulty: 'master', language: 'en' };
const play = (store, user, room, from, to) => store.action(room.code, user, 'move', { from, to, ply: store.load(room.code).chess.moves.length, requestId: randomUUID() });
function fixture(t, color = 'w') {
  let now = 1000;
  const store = new Store(':memory:', () => now); t.after(() => store.close());
  const user = store.createSession('Chess tools').user, room = store.create(user, { ...settings, chessColor: color });
  const jobs = []; store.bots.engine.close();
  store.bots.engine = { choose: request => new Promise((resolve, reject) => jobs.push({ request, resolve, reject })), close() {} };
  return { store, user, room, jobs, later: ms => { now += ms; } };
}

test('white, black and random choices assign a playable board; black gets the first bot move and rematches swap colors', async t => {
  for (const color of ['w', 'b', 'random']) await t.test(color, async child => {
    const { store, user, room, jobs, later } = fixture(child, color);
    if (color !== 'random') assert.equal(room.chess.myColor, color);
    assert.ok(['w', 'b'].includes(room.chess.myColor));
    assert.equal(room.chess.botThinking, room.chess.myColor === 'b');
    if (room.chess.myColor === 'b') {
      assert.equal(room.chess.legalMoves.length, 0);
      later(500); store.tick(); assert.equal(jobs.length, 1);
      jobs[0].resolve({ from: 'e2', to: 'e4' }); await store.waitForBots();
      const next = store.view(room.code, user.id);
      assert.equal(next.chess.botThinking, false); assert.equal(next.chess.turn, 'b'); assert.equal(next.chess.legalMoves.length, 20);
    }
    store.action(room.code, user, 'resign', {});
    assert.notEqual(store.rematch(room.code, user).chess.myColor, room.chess.myColor);
  });
  const store = new Store(':memory:'); t.after(() => store.close());
  for (const chessColor of ['red', {}, null]) assert.throws(() => store.create(store.createSession('Invalid').user, { ...settings, chessColor }), /CHESS_INVALID_COLOR/);
  assert.throws(() => store.create(store.createSession('Human').user, { ...settings, difficulty: 'normal', mode: 'friends', capacity: 2, chessColor: 'b' }), /CHESS_INVALID_COLOR/);
});

test('hints are private, legal, cached per position and never play the move or stop the clock', async t => {
  const { store, user, room, jobs, later } = fixture(t);
  assert.throws(() => store.action(room.code, { id: 'outsider' }, 'hint', { ply: 0 }), /NOT_A_MEMBER/);
  assert.throws(() => store.action(room.code, user, 'hint', { ply: 1 }), /CHESS_STALE_POSITION/);
  store.action(room.code, user, 'hint', { ply: 0 }); store.tick(); store.tick();
  store.action(room.code, user, 'hint', { ply: 0 }); assert.equal(jobs.length, 1);
  later(2500); jobs[0].resolve({ from: 'e2', to: 'e4' }); await store.waitForBots();
  const hint = store.view(room.code, user.id);
  assert.equal(hint.chess.hint.status, 'ready'); assert.equal(hint.chess.hint.move.san, 'e4');
  assert.equal(hint.chess.moves.length, 0); assert.equal(hint.chess.remaining.w, 597500);
  store.action(room.code, user, 'hint', { ply: 0 }); store.tick(); assert.equal(jobs.length, 1);
  play(store, user, room, 'd2', 'd4');
  assert.equal(store.view(room.code, user.id).chess.hint, null);
  assert.throws(() => store.action(room.code, user, 'hint', { ply: 1 }), /CHESS_NOT_YOUR_TURN/);
  const human = store.createSession('Human').user;
  const versus = store.create(human, { ...settings, mode: 'friends', difficulty: 'normal', capacity: 2 });
  assert.throws(() => store.action(versus.code, human, 'hint', { ply: 0 }), /CHESS_HINT_UNAVAILABLE/);
});

test('late hints are discarded after a move, resignation, clock expiry or server interruption', async t => {
  for (const ending of ['move', 'resign', 'timeout', 'interrupt']) await t.test(ending, async child => {
    const { store, user, room, jobs, later } = fixture(child);
    store.action(room.code, user, 'hint', { ply: 0 }); store.tick();
    if (ending === 'move') play(store, user, room, 'd2', 'd4');
    if (ending === 'resign') store.action(room.code, user, 'resign', {});
    if (ending === 'timeout') later(600001);
    if (ending === 'interrupt') store.tick(true);
    jobs[0].resolve({ from: 'e2', to: 'e4' }); await store.waitForBots();
    const result = store.view(room.code, user.id);
    assert.equal(result.chess.hint, null); assert.equal(result.chess.moves.length, ending === 'move' ? 1 : 0);
    if (ending === 'timeout') assert.equal(result.reason, 'CHESS_TIMEOUT');
  });
});

test('hint engine failures and illegal replies permit a bounded retry without cancelling the game', async t => {
  for (const invalid of [false, true]) await t.test(String(invalid), async child => {
    const { store, user, room, jobs, later } = fixture(child);
    store.action(room.code, user, 'hint', { ply: 0 }); store.tick();
    if (invalid) jobs[0].resolve({ from: 'e2', to: 'e8' }); else jobs[0].reject(new Error('offline'));
    await store.waitForBots();
    const result = store.view(room.code, user.id);
    assert.equal(result.status, 'playing'); assert.equal(result.chess.hint.status, 'error');
    assert.throws(() => store.action(room.code, user, 'hint', { ply: 0 }), /CHESS_HINT_WAIT/);
    later(10000); store.action(room.code, user, 'hint', { ply: 0 }); store.tick();
    assert.equal(jobs.length, 2); jobs[1].resolve({ from: 'd2', to: 'd4' }); await store.waitForBots();
    assert.equal(store.view(room.code, user.id).chess.hint.move.san, 'd4');
  });
});

test('replay reconstructs castling, en passant and underpromotion without mutating history', () => {
  const castle = 'e4 e5 Nf3 Nc6 Bc4 Nf6 O-O'.split(' ').map(san => ({ san }));
  const before = JSON.stringify(castle), positions = replayPositions(castle);
  const board = new Chess(positions.at(-1));
  assert.equal(board.get('g1').type, 'k'); assert.equal(board.get('f1').type, 'r');
  assert.equal(new Chess(positions[0]).get('e1').type, 'k'); assert.equal(JSON.stringify(castle), before);
  const ep = new Chess(replayPositions('e4 a6 e5 d5 exd6'.split(' ').map(san => ({ san }))).at(-1));
  assert.equal(ep.get('d6').type, 'p'); assert.equal(ep.get('d5'), undefined);
  const promotion = new Chess(replayPositions('a4 h5 a5 h4 a6 h3 axb7 hxg2 bxa8=Q gxh1=N'.split(' ').map(san => ({ san }))).at(-1));
  assert.equal(promotion.get('a8').type, 'q'); assert.equal(promotion.get('h1').type, 'n');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';
import { Stockfish } from '../server/stockfish.mjs';
import { Store } from '../server/store.mjs';
import { makeServer } from '../server/index.mjs';
import levels from '../shared/chess-levels.json' with { type: 'json' };
import locales from '../shared/locales.json' with { type: 'json' };

const settings = { topic: 'chess', mode: 'practice', difficulty: 'master', language: 'en' };
test('six chess bot levels persist through rematch and progress; other games and human chess keep their existing levels', t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  assert.deepEqual(Object.keys(levels), ['beginner', 'easy', 'normal', 'hard', 'expert', 'master']);
  for (const difficulty of Object.keys(levels)) {
    for (const l of Object.values(locales)) { assert.ok(l[difficulty]); assert.ok(l['chessLevel_' + difficulty]); }
    const user = store.createSession(difficulty).user;
    const room = store.create(user, { ...settings, difficulty });
    store.action(room.code, user, 'resign', {});
    assert.equal(store.progress(user.id).groups[0].difficulty, difficulty);
    const again = store.rematch(room.code, user);
    assert.equal(again.difficulty, difficulty); assert.equal(again.chess.myColor, 'b');
    store.action(again.code, user, 'resign', {});
  }
  for (const topic of ['math', 'flags', 'capitals', 'mixed', 'puzzles']) for (const difficulty of ['beginner', 'expert', 'master'])
    assert.throws(() => store.create(store.createSession('Invalid').user, { ...settings, topic, difficulty }), /INVALID_DIFFICULTY/);
  assert.throws(() => store.create(store.createSession('Human').user, { ...settings, mode: 'friends', capacity: 2 }), /INVALID_DIFFICULTY/);
});

test('all five Stockfish levels play legal moves; strong levels avoid a mating trap and find a forced mate in two', async t => {
  const bot = new Stockfish(); t.after(() => bot.close());
  const position = new Chess(); position.move('e4');
  for (const difficulty of ['easy', 'normal', 'hard', 'expert', 'master']) {
    const move = await bot.choose({ fen: position.fen(), moves: ['e2e4'], difficulty });
    assert.ok(new Chess(position.fen()).move(move));
  }
  for (const difficulty of ['hard', 'master']) {
    const trap = new Chess('4r1k1/5ppp/8/8/8/8/q4PPP/R5K1 w - - 0 1');
    trap.move(await bot.choose({ fen: trap.fen(), difficulty }));
    assert.ok(!trap.moves().some(move => move.endsWith('#')));
  }
  const mate = new Chess('4r3/1k6/pp3r2/1b2P2p/3R1p2/P1R2P2/1P4PP/6K1 w - - 0 35');
  mate.move('exf6');
  const move = await bot.choose({ fen: mate.fen(), difficulty: 'master' });
  mate.move(move);
  const replies = mate.moves();
  assert.ok(replies.length > 0);
  for (const reply of replies) {
    mate.move(reply); assert.ok(mate.moves().some(candidate => candidate.endsWith('#')), `No mate after ${reply}`); mate.undo();
  }
  await assert.rejects(bot.choose({ fen: position.fen(), difficulty: 'constructor' }), /INVALID_DIFFICULTY/);
});

test('engine computation leaves HTTP responsive, jobs are serialized and shutdown rejects pending work', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const server = makeServer({ store, secureCookies: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const bot = store.bots.engine;
  await bot.start();
  let finished = false;
  const work = bot.choose({ fen: new Chess().fen(), difficulty: 'master' }).then(move => { finished = true; return move; });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(response.status, 200); assert.equal(finished, false);
  assert.ok(new Chess().move(await work));
  const first = bot.choose({ fen: new Chess().fen(), difficulty: 'master' });
  const second = bot.choose({ fen: new Chess().fen(), difficulty: 'easy' });
  const rejected = Promise.allSettled([first, second]);
  bot.close();
  assert.ok((await rejected).every(result => result.status === 'rejected'));
});

function controlledStore(t) {
  let now = 1000;
  const store = new Store(':memory:', () => now); t.after(() => store.close());
  const jobs = [];
  store.bots.engine.close();
  store.bots.engine = { choose: request => new Promise((resolve, reject) => jobs.push({ request, resolve, reject })), close() {} };
  const user = store.createSession('Tester').user;
  const room = store.create(user, settings);
  store.action(room.code, user, 'move', { from: 'e2', to: 'e4', ply: 0, requestId: randomUUID() });
  now += 500; store.tick();
  return { store, user, room, jobs, later: ms => { now += ms; } };
}
test('bot work deduplicates across ticks and stale responses cannot alter a resigned game', async t => {
  const { store, user, room, jobs } = controlledStore(t);
  store.tick(); store.view(room.code, user.id); assert.equal(jobs.length, 1);
  store.action(room.code, user, 'resign', {});
  jobs[0].resolve({ from: 'e7', to: 'e5' }); await store.waitForBots();
  assert.equal(store.load(room.code).chess.moves.length, 1);
  assert.equal(store.load(room.code).reason, 'CHESS_RESIGNED');
});
test('bot computation time belongs to the bot clock; a late result cannot rescue a timed-out bot', async t => {
  const { store, user, room, jobs, later } = controlledStore(t);
  later(600000);
  jobs[0].resolve({ from: 'e7', to: 'e5' }); await store.waitForBots();
  const result = store.view(room.code, user.id);
  assert.equal(result.reason, 'CHESS_TIMEOUT'); assert.deepEqual(result.winners, [user.id]);
  assert.equal(result.chess.moves.length, 1);
});
test('failed engines and invalid engine moves void practice without a loss or weak fallback', async t => {
  for (const invalidMove of [false, true]) await t.test(String(invalidMove), async child => {
    const { store, user, room, jobs } = controlledStore(child);
    if (invalidMove) jobs[0].resolve({ from: 'e2', to: 'e8' }); else jobs[0].reject(new Error('engine failure'));
    await store.waitForBots();
    const result = store.view(room.code, user.id);
    assert.equal(result.status, 'void'); assert.equal(result.reason, 'CHESS_ENGINE_UNAVAILABLE');
    assert.deepEqual(result.winners, []); assert.equal(result.chess.moves.length, 1);
    assert.equal(store.progress(user.id).games, 0);
  });
});
test('bot admission is bounded and returns capacity after a game ends', t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const players = Array.from({ length: 17 }, (_, i) => store.createSession(`Bot ${i}`).user);
  const rooms = players.slice(0,16).map(user => store.create(user, settings));
  assert.throws(() => store.create(players[16], settings), /CHESS_BOT_BUSY/);
  store.action(rooms[0].code, players[0], 'resign', {});
  assert.equal(store.create(players[16], settings).status, 'playing');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { act, advance, createRoom, roomView, voidRoom } from '../server/game.mjs';
import { Store } from '../server/store.mjs';
import { CHESS_CLOCK_MS } from '../server/chess-game.mjs';

const alice = { id: 'chess-alice', name: 'Alice' }, bob = { id: 'chess-bob', name: 'Bob' };
const input = { topic: 'chess', difficulty: 'normal', language: 'uk', mode: 'friends', capacity: 2 };
function ready() {
  const room = createRoom(alice, input, 1000);
  act(room, bob, 'join', {}, 1000);
  for (const user of [alice, bob]) act(room, user, 'ready', { rulesVersion: room.rulesVersion }, 1000);
  return room;
}
function match() {
  const room = ready();
  for (const user of [alice, bob]) act(room, user, 'start', {}, 1001);
  return room;
}
function current(room) { return [alice, bob].find(p => p.id === (room.chess.turn === 'w' ? room.chess.whiteId : room.chess.blackId)); }
function move(room, from, to, promotion, now = 1010 + room.chess.moves.length * 100) {
  const body = { from, to, ...(promotion ? { promotion } : {}), ply: room.chess.moves.length, requestId: randomUUID() };
  act(room, current(room), 'move', body, now); return body;
}

test('chess accepts only two players and requires wallet proof for stakes; bot practice is immediately playable', () => {
  assert.throws(() => createRoom(alice, { ...input, capacity: 3 }, 1000), /CHESS_TWO_PLAYERS/);
  assert.throws(() => createRoom(alice, { ...input, stake: 100000 }, 1000, { ready: true }), /VERIFIED_WALLET_REQUIRED/);
  const store = new Store(':memory:', () => 1000);
  try {
    const view = store.create(alice, { ...input, mode: 'practice' });
    assert.equal(view.status, 'playing'); assert.equal(view.players.length, 2);
    assert.equal(view.chess.myColor, 'w'); assert.equal(view.chess.legalMoves.length, 20);
    assert.equal(view.question, null); assert.equal(view.feedback, null);
  } finally { store.close(); }
});
test('the first starter does not lose clock time while waiting; no-shows lose at the deadline', () => {
  const room = ready(); act(room, alice, 'start', {}, 1100);
  assert.equal(room.status, 'starting'); assert.equal(room.chess.turnStartedAt, null);
  advance(room, 119999); assert.equal(room.chess.remaining.w, CHESS_CLOCK_MS);
  act(room, bob, 'start', {}, 120999); assert.equal(room.status, 'playing');
  assert.equal(room.chess.turnStartedAt, 120999);
  const missing = ready(); act(missing, alice, 'start', {}, 1100); advance(missing, 121000);
  assert.equal(missing.reason, 'CHESS_NO_SHOW'); assert.deepEqual(missing.winners, [alice.id]);
  const nobody = ready(); advance(nobody, 121000);
  assert.equal(nobody.reason, 'ALL_FORFEIT'); assert.deepEqual(nobody.winners, []);
});
test('server enforces turn, legal moves, stale positions and idempotent requests', () => {
  const room = match(), white = current(room), black = [alice, bob].find(p => p.id !== white.id);
  const request = { from: 'e2', to: 'e4', ply: 0, requestId: randomUUID() };
  assert.throws(() => act(room, black, 'move', request, 1002), /CHESS_NOT_YOUR_TURN/);
  assert.throws(() => act(room, white, 'move', { ...request, to: 'e5' }, 1002), /CHESS_ILLEGAL_MOVE/);
  act(room, white, 'move', request, 1003);
  const fen = room.chess.fen;
  act(room, white, 'move', request, 1004); assert.equal(room.chess.moves.length, 1); assert.equal(room.chess.fen, fen);
  assert.throws(() => act(room, white, 'move', { ...request, to: 'e3' }, 1004), /REQUEST_REUSED/);
  assert.throws(() => act(room, black, 'move', { from: 'e7', to: 'e5', ply: 0, requestId: randomUUID() }, 1004), /CHESS_STALE_POSITION/);
  assert.equal(roomView(room, white.id, 1004).chess.legalMoves.length, 0);
  assert.ok(roomView(room, black.id, 1004).chess.legalMoves.length > 0);
  assert.throws(() => act(room, white, 'finish', {}, 1005), /UNKNOWN_ACTION/);
  assert.throws(() => roomView(room, 'intruder', 1005), /NOT_A_MEMBER/);
});
test('castling, en passant and explicit underpromotion update authoritative FEN', () => {
  const castle = match();
  for (const [from, to] of [['e2','e4'],['e7','e5'],['g1','f3'],['b8','c6'],['f1','c4'],['g8','f6'],['e1','g1']]) move(castle, from, to);
  assert.equal(castle.chess.moves.at(-1).san, 'O-O'); assert.match(castle.chess.fen.split(' ')[0], /RNBQ1RK1$/);
  const ep = match();
  for (const [from, to] of [['a2','a4'],['h7','h5'],['a4','a5'],['b7','b5'],['a5','b6']]) move(ep, from, to);
  assert.match(ep.chess.moves.at(-1).san, /^axb6/); assert.equal(ep.chess.fen.split('/')[3][0], '7');
  const promotion = match();
  for (const [from, to] of [['a2','a4'],['h7','h5'],['a4','a5'],['h5','h4'],['a5','a6'],['h4','h3'],['a6','b7'],['h3','g2']]) move(promotion, from, to);
  assert.throws(() => move(promotion, 'b7', 'a8'), /CHESS_ILLEGAL_MOVE/);
  move(promotion, 'b7', 'a8', 'n'); assert.ok(promotion.chess.fen.startsWith('N'));
});
test('checkmate ends both players, blocks later moves and records the winner', () => {
  const room = match();
  for (const [from, to] of [['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']]) move(room, from, to);
  assert.equal(room.status, 'completed'); assert.equal(room.reason, 'CHESS_CHECKMATE');
  assert.deepEqual(room.winners, [room.chess.blackId]); assert.equal(room.chess.result, '0-1');
  assert.ok(room.players.every(p => p.status === 'finished'));
  assert.throws(() => move(room, 'e2', 'e3'), /ROUND_ENDED/);
});
test('clock charges only the moving side, reconnect does not reset it, deadline is exclusive', () => {
  const room = match(); move(room, 'e2', 'e4', undefined, 11001);
  assert.equal(room.chess.remaining.w, 590000); assert.equal(room.chess.remaining.b, 600000);
  act(room, current(room), 'heartbeat', {}, 21001);
  assert.equal(roomView(room, alice.id, 21001).chess.remaining.b, 590000);
  advance(room, 611001); assert.equal(room.reason, 'CHESS_TIMEOUT');
  assert.deepEqual(room.winners, [room.chess.whiteId]);
});
test('timeout is a draw when the opponent has only a king', () => {
  const room = match();
  room.chess.fen = '7k/8/8/8/8/8/8/KR6 w - - 0 1';
  room.chess.remaining.w = 1;
  advance(room, 1002);
  assert.equal(room.reason, 'CHESS_MATERIAL');
  assert.equal(room.winners.length, 2);
});
test('repetition survives serialization and automatically draws on the third occurrence', () => {
  let room = match();
  const sequence = [['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8']];
  for (let i = 0; i < 2; i++) for (const [from, to] of sequence) { room = JSON.parse(JSON.stringify(room)); move(room, from, to); }
  assert.equal(room.reason, 'CHESS_REPETITION'); assert.equal(room.winners.length, 2);
  assert.ok(room.players.every(p => p.score === 0.5));
});
test('draw requires an opponent offer; move cancels an offer; resignation is a loss', () => {
  const room = match();
  assert.throws(() => act(room, alice, 'acceptDraw', {}, 1002), /CHESS_NO_DRAW_OFFER/);
  act(room, alice, 'offerDraw', {}, 1002);
  assert.throws(() => act(room, alice, 'acceptDraw', {}, 1003), /CHESS_NO_DRAW_OFFER/);
  move(room, 'e2','e4'); assert.equal(room.chess.drawOffer, null);
  act(room, bob, 'offerDraw', {}, 1011); act(room, alice, 'acceptDraw', {}, 1012);
  assert.equal(room.reason, 'CHESS_AGREED_DRAW'); assert.equal(room.winners.length, 2);
  const resign = match(); act(resign, alice, 'resign', {}, 1002);
  assert.deepEqual(resign.winners, [bob.id]);
});
test('bot moves through server tick; server interruption voids the game', async () => {
  let now = 1000; const store = new Store(':memory:', () => now);
  try {
    let view = store.create(alice, { ...input, mode: 'practice' });
    view = store.action(view.code, alice, 'move', { from: 'e2', to: 'e4', ply: 0, requestId: randomUUID() });
    assert.equal(view.chess.moves.length, 1);
    now += 1000; store.tick(); await store.waitForBots(); view = store.view(view.code, alice.id);
    assert.equal(view.chess.moves.length, 2); assert.equal(view.chess.turn, 'w');
    store.tick(true); assert.equal(store.view(view.code, alice.id).status, 'void');
    const finished = match(); act(finished, alice, 'resign', {}, 1002); voidRoom(finished, 1003);
    assert.equal(finished.status, 'completed');
  } finally { store.close(); }
});

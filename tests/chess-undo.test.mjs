import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';
import { Store } from '../server/store.mjs';
import { applyBotMove } from '../server/chess-game.mjs';

const options = { topic: 'chess', mode: 'practice', difficulty: 'master', language: 'en' };
function fixture(t, chessColor = 'w') {
  let now = 1000;
  const store = new Store(':memory:', () => now); t.after(() => store.close());
  const user = store.createSession('Undo').user, view = store.create(user, { ...options, chessColor });
  const jobs = []; store.bots.engine.close();
  store.bots.engine = { choose: request => new Promise((resolve, reject) => jobs.push({ request, resolve, reject })), close() {} };
  const room = () => store.load(view.code);
  const move = (from, to) => store.action(view.code, user, 'move', { from, to, ply: room().chess.moves.length, revision: room().chess.revision, requestId: randomUUID() });
  const undoInput = () => ({ ply: room().chess.moves.length, revision: room().chess.revision, requestId: randomUUID() });
  const undo = (input = undoInput()) => store.action(view.code, user, 'undo', input);
  return { store, user, view, room, jobs, move, undo, undoInput, later: ms => { now += ms; } };
}
test('undo removes the human move and bot reply, keeps spent time and is idempotent', async t => {
  const f = fixture(t);
  f.later(2000); f.move('e2','e4'); f.later(500); f.store.tick();
  f.jobs[0].resolve({ from: 'e7', to: 'e5' }); await f.store.waitForBots();
  f.later(1000); const request = f.undoInput(), result = f.undo(request);
  assert.equal(result.chess.fen, new Chess().fen()); assert.equal(result.chess.moves.length, 0);
  assert.equal(result.chess.canUndo, false); assert.equal(result.chess.botThinking, false);
  assert.deepEqual(result.chess.remaining, { w: 597000, b: 599500 });
  const revision = result.chess.revision; f.undo(request); assert.equal(f.room().chess.revision, revision);
  assert.equal(f.room().players.every(p => p.index === 0), true);
  assert.throws(() => f.undo(), /CHESS_NOTHING_TO_UNDO/);
  f.move('d2','d4'); assert.equal(f.room().chess.moves[0].san, 'd4');
});
test('undo while thinking invalidates an old engine answer even after replaying the identical move', async t => {
  const f = fixture(t);
  f.move('e2','e4'); f.later(500); f.store.tick(); const oldFen = f.room().chess.fen;
  f.undo(); f.move('e2','e4'); assert.equal(f.room().chess.fen, oldFen);
  assert.equal(f.jobs[0].request.current(), false);
  f.jobs[0].resolve({ from: 'e7', to: 'e5' }); await f.store.waitForBots();
  assert.equal(f.room().chess.moves.length, 1);
  f.later(500); f.store.tick(); assert.equal(f.jobs.length, 2);
  f.jobs[1].resolve({ from: 'c7', to: 'c5' }); await f.store.waitForBots();
  assert.equal(f.room().chess.moves[1].san, 'c5');
});
test('old moves and undo requests cannot act on the same ply after a takeback; pending hints are invalidated', async t => {
  const f = fixture(t);
  const stale = { from: 'd2', to: 'd4', ply: 0, revision: 0, requestId: randomUUID() };
  f.store.action(f.view.code, f.user, 'hint', { ply: 0, revision: 0 }); f.store.tick();
  f.move('e2','e4'); const oldUndo = f.undoInput(); f.undo();
  f.store.action(f.view.code, f.user, 'hint', { ply: 0, revision: f.room().chess.revision });
  f.jobs[0].resolve({ from: 'e2', to: 'e4' }); await f.store.waitForBots();
  assert.equal(f.room().chess.hint.status, 'pending');
  assert.throws(() => f.store.action(f.view.code, f.user, 'move', stale), /CHESS_STALE_POSITION/);
  assert.throws(() => f.store.action(f.view.code, f.user, 'move', { ...stale, revision: undefined }), /CHESS_STALE_POSITION/);
  f.move('e2','e4'); assert.throws(() => f.undo(oldUndo), /CHESS_STALE_POSITION/);
});
test('black cannot undo the bot opening but can undo their own move without removing that opening', async t => {
  const f = fixture(t,'b'); f.later(500); f.store.tick();
  f.jobs[0].resolve({ from: 'e2', to: 'e4' }); await f.store.waitForBots();
  assert.equal(f.store.view(f.view.code,f.user.id).chess.canUndo, false);
  assert.throws(() => f.undo(), /CHESS_NOTHING_TO_UNDO/);
  f.move('e7','e5'); f.undo();
  assert.equal(f.room().chess.moves.length, 1); assert.equal(f.room().chess.turn, 'b');
});
test('a bot reply arriving while undo is in transit is removed together with the human move', async t => {
  const f = fixture(t); f.move('e2','e4'); const request = f.undoInput();
  f.later(500); f.store.tick(); f.jobs[0].resolve({ from: 'e7', to: 'e5' }); await f.store.waitForBots();
  assert.equal(f.undo(request).chess.moves.length, 0);
});
test('undo rejects outsiders, human games and completed games; castling rights are restored from history', t => {
  const f = fixture(t);
  assert.throws(() => f.store.action(f.view.code, { id: 'stranger' }, 'undo', f.undoInput()), /NOT_A_MEMBER/);
  const human = f.store.createSession('Human').user;
  const versus = f.store.create(human, { ...options, difficulty: 'normal', mode: 'friends', capacity: 2 });
  assert.throws(() => f.store.action(versus.code, human, 'undo', { ply: 0, revision: 0, requestId: randomUUID() }), /CHESS_UNDO_UNAVAILABLE/);
  const sequence = ['e4','e5','Nf3','Nc6','Bc4','Nf6','O-O','Be7'];
  for (const san of sequence) {
    const room = f.room(), engine = new Chess(room.chess.fen), move = engine.move(san);
    if (move.color === 'w') f.move(move.from,move.to);
    else { applyBotMove(room,move,room.chess.fen,room.chess.moves.length,1000); f.store.save(room,'test_bot'); }
  }
  f.undo(); const restored = new Chess(f.room().chess.fen);
  assert.equal(restored.get('e1').type, 'k'); assert.equal(restored.get('h1').type, 'r'); assert.ok(restored.moves().includes('O-O'));
  f.store.action(f.view.code, f.user, 'resign', {});
  assert.throws(() => f.undo(), /ROUND_ENDED/);
});

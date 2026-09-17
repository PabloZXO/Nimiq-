import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';
import { trainingCatalog, puzzlePools, getPuzzle, moveOf } from '../server/puzzle-library.mjs';
import originals from '../server/puzzle-catalog.json' with { type: 'json' };
import { initPuzzle } from '../server/puzzles.mjs';
import { Store } from '../server/store.mjs';

test('30,000 unique real positions have legal solutions ending in mate and distinct rating bands', () => {
  assert.equal(trainingCatalog.length, 30000);
  const ids = new Set(), fens = new Set(), themes = new Set(), colors = new Set(), mates = new Set();
  for (const level of ['easy', 'normal', 'hard']) assert.equal(puzzlePools[level].length, 10000);
  for (const p of trainingCatalog) {
    assert.ok(!ids.has(p.id)); ids.add(p.id);
    const engine = new Chess(p.fen);
    assert.equal(p.moves.length, p.mate * 2);
    p.moves.forEach((code, index) => {
      engine.move(moveOf(code));
      if (index === 0) {
        const fen = engine.fen().split(' ').slice(0, 4).join(' ');
        assert.ok(!fens.has(fen), p.id); fens.add(fen); colors.add(engine.turn());
      }
      if (index < p.moves.length - 1) assert.equal(engine.isGameOver(), false, p.id);
    });
    assert.ok(engine.isCheckmate(), p.id);
    if (p.difficulty === 'easy') assert.ok(p.rating >= 900 && p.rating < 1400 && p.mate <= 2);
    if (p.difficulty === 'normal') assert.ok(p.rating >= 1400 && p.rating < 1900 && p.mate >= 2 && p.mate <= 3);
    if (p.difficulty === 'hard') assert.ok(p.rating >= 1900 && p.rating <= 2800 && p.mate >= 3 && p.mate <= 5);
    for (const tag of p.themes) themes.add(tag); mates.add(p.mate);
  }
  assert.equal(colors.size, 2); assert.equal(mates.size, 5); assert.ok(themes.size > 40);
});

test('every recorded branch is recreated after cache eviction, including promotion and en passant', () => {
  const candidates = ['promotion', 'underPromotion', 'enPassant', 'quietMove'].map(tag => trainingCatalog.find(p => p.themes.includes(tag)));
  for (const p of candidates) {
    const first = getPuzzle(p.id); let node = first.tree;
    const start = new Chess(p.fen); start.move(moveOf(p.moves[0])); assert.equal(node.fen, start.fen());
    for (let i = 1; i < p.moves.length; i += 2) { const choice = node.choices[p.moves[i]]; assert.ok(choice); node = choice.next; }
    assert.ok(new Chess(node.fen).isCheckmate());
    for (const other of trainingCatalog.slice(500, 760)) getPuzzle(other.id);
    assert.deepEqual(getPuzzle(p.id).tree, first.tree);
  }
});

test('pool selection excludes the previous 9999 puzzles and old saved IDs remain valid', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const pool = puzzlePools[difficulty], room = { difficulty };
    initPuzzle(room, pool.slice(0, 9999).map(p => p.id)); assert.equal(room.puzzle.id, pool[9999].id);
    initPuzzle(room, pool.map(p => p.id)); assert.ok(pool.some(p => p.id === room.puzzle.id));
  }
  for (const p of originals) assert.equal(getPuzzle(p.id), p);
});

test('alternative immediate checkmates solve the task and survive room serialization', () => {
  const puzzle = puzzlePools.easy.filter(p => p.mate === 1).map(p => p.id).reduce((found, id) => found ?? (Object.keys(getPuzzle(id).tree.choices).length > 1 ? getPuzzle(id) : null), null);
  assert.ok(puzzle);
  const store = new Store(':memory:');
  try {
    const user = store.createSession('Player').user;
    const created = store.create(user, { topic: 'puzzles', mode: 'practice', difficulty: 'easy', language: 'en' });
    const room = store.load(created.code); room.puzzle.id = puzzle.id; store.save(room, 'fixture');
    const move = Object.keys(puzzle.tree.choices).find(key => key !== puzzle.moves[1]);
    const done = store.action(room.code, user, 'move', { ...moveOf(move), ply: 0, requestId: randomUUID() });
    assert.equal(done.status, 'completed'); assert.equal(done.me.score, 1); assert.equal(done.puzzle.misses, 0);
    assert.ok(new Chess(store.view(room.code, user.id).chess.fen).isCheckmate());
  } finally { store.close(); }
});

test('history exclusion is not displaced by unrelated games, and public state hides the puzzle ID and solution', () => {
  const store = new Store(':memory:');
  try {
    const user = store.createSession('Player').user;
    const seen = new Set();
    for (let i = 0; i < 110; i++) {
      const room = store.create(user, { topic: i % 2 ? 'math' : 'puzzles', mode: 'practice', difficulty: 'hard', language: 'en' });
      if (room.puzzle) {
        assert.equal(room.puzzle.id, undefined); assert.equal(room.puzzle.moves, undefined); assert.deepEqual(room.puzzle.solution, []);
        assert.ok(room.puzzle.rating >= 1900); assert.equal(room.puzzle.total, 10000);
        const id = store.load(room.code).puzzle.id; assert.ok(!seen.has(id)); seen.add(id);
      }
      store.action(room.code, user, 'finish', {});
    }
  } finally { store.close(); }
});

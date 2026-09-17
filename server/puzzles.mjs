import { Chess } from 'chess.js';
import { randomInt } from 'node:crypto';
import { getPuzzle, puzzlePools, moveOf } from './puzzle-library.mjs';
import { requireThat } from './game.mjs';

export function initPuzzle(room, recent = []) {
  const seen = new Set(recent);
  const all = puzzlePools[room.difficulty], fresh = all.filter(p => !seen.has(p.id));
  const pool = fresh.length ? fresh : all, puzzle = pool[randomInt(pool.length)];
  room.puzzle = { id: puzzle.id, path: [], misses: 0, assisted: false, feedback: null, hint: null, receipts: {} };
  room.roundMs = 1800000; room.questionCount = 1;
}
function nodeOf(room) {
  let node = getPuzzle(room.puzzle.id).tree;
  for (const move of room.puzzle.path) node = node.choices[move].next;
  return node;
}
function finish(room, solved, now) {
  const p = room.players[0]; p.status = 'finished'; p.finishedAt = now; p.score = solved ? 1 : 0;
  room.status = 'completed'; room.closedAt = now; room.winners = solved ? [p.id] : [];
  room.reason = solved ? 'PUZZLE_SOLVED' : 'PUZZLE_REVEALED';
}
export function actPuzzle(room, player, action, input, now) {
  const state = room.puzzle;
  if (action === 'ready') { requireThat(room.status === 'lobby', 'ROOM_LOCKED', 409); player.ready = true; room.status = 'starting'; return; }
  if (action === 'start') {
    if (player.startedAt !== null) return;
    requireThat(room.status === 'starting', 'ROUND_ENDED', 409);
    room.status = 'playing'; player.status = 'playing'; player.startedAt = now;
    player.deadline = now + room.roundMs; player.lastSeenAt = now; return;
  }
  if (action === 'heartbeat') { player.lastSeenAt = now; return; }
  if (action === 'move') {
    requireThat(typeof input.requestId === 'string' && /^[a-zA-Z0-9-]{12,80}$/.test(input.requestId), 'INVALID_REQUEST');
    const fingerprint = JSON.stringify([input.ply, input.from, input.to, input.promotion ?? null]);
    if (Object.hasOwn(state.receipts, input.requestId)) {
      requireThat(state.receipts[input.requestId] === fingerprint, 'REQUEST_REUSED', 409); return;
    }
    requireThat(room.status === 'playing', 'ROUND_ENDED', 409);
    requireThat(input.ply === state.path.length, 'CHESS_STALE_POSITION', 409);
    requireThat(Object.keys(state.receipts).length < 256, 'INVALID_REQUEST');
    const engine = new Chess(nodeOf(room).fen);
    const move = engine.moves({ verbose: true }).find(m => m.from === input.from && m.to === input.to && m.promotion === input.promotion);
    requireThat(move, 'CHESS_ILLEGAL_MOVE');
    const key = move.from + move.to + (move.promotion ?? '');
    const choice = nodeOf(room).choices[key];
    state.receipts[input.requestId] = fingerprint; state.hint = null;
    if (!choice) { state.misses++; state.feedback = 'wrong'; return; }
    state.path.push(key); player.index++; state.feedback = 'correct';
    if (new Chess(choice.next.fen).isCheckmate()) finish(room, true, now);
    return;
  }
  requireThat(room.status === 'playing', 'ROUND_ENDED', 409);
  if (action === 'hint') {
    state.assisted = true; state.hint = moveOf(Object.keys(nodeOf(room).choices)[0]);
  } else if (action === 'finish') { state.assisted = true; finish(room, false, now); }
  else requireThat(false, 'UNKNOWN_ACTION', 404);
}
export function puzzleView(room) {
  const state = room.puzzle, puzzle = getPuzzle(state.id), node = nodeOf(room);
  const color = new Chess(puzzle.tree.fen).turn();
  const moves = []; let cursor = puzzle.tree;
  for (const key of state.path) {
    const c = cursor.choices[key];
    moves.push({ ...moveOf(key), san: c.san, color });
    if (c.reply) moves.push({ ...moveOf(c.reply), san: c.replySan, color: color === 'w' ? 'b' : 'w' });
    cursor = c.next;
  }
  const solution = [];
  if (room.status === 'completed') {
    cursor = puzzle.tree; let index = 0;
    while (Object.keys(cursor.choices).length) {
      const c = cursor.choices[state.path[index++]] ?? Object.values(cursor.choices)[0]; solution.push(c.san);
      if (c.replySan) solution.push(c.replySan);
      cursor = c.next;
    }
  }
  return { puzzle: { mate: puzzle.mate, rating: puzzle.rating ?? null, total: puzzlePools[room.difficulty].length, misses: state.misses, assisted: state.assisted,
    feedback: state.feedback, hint: state.hint, ply: state.path.length, solution },
    chess: { fen: node.fen, turn: new Chess(node.fen).turn(), myColor: color, moves,
      legalMoves: room.status === 'playing' ? new Chess(node.fen).moves({ verbose: true }).map(m => ({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) })) : [] } };
}

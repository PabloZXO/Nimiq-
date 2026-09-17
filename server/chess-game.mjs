import { chooseBotMove } from './chess-bot.mjs';
import { Chess } from 'chess.js';
import { randomInt, randomUUID } from 'node:crypto';
import { requireThat } from './game.mjs';

export const CHESS_CLOCK_MS = 600_000;
const other = color => color === 'w' ? 'b' : 'w';
export function initChess(room, color = 'w') {
  if (room.mode === 'practice') room.players.push({ ...room.players[0], id: `bot-${randomUUID()}`, name: 'NimBot',
    bot: true, ready: true, nickname: undefined, walletAddress: undefined, receipts: {}, questions: [], answers: [] });
  room.chess = { fen: new Chess().fen(), moves: [], turn: 'w', whiteId: null, blackId: null,
    remaining: { w: CHESS_CLOCK_MS, b: CHESS_CLOCK_MS }, turnStartedAt: null, botDueAt: null,
    drawOffer: null, result: null, receipts: {}, preferredColor: color, hint: null, revision: 0, takebacks: 0 };
  room.roundMs = CHESS_CLOCK_MS; room.questionCount = 0;
}
export function engineFor(room) {
  const engine = new Chess();
  // Replaying retains repetition history across requests and database reloads.
  for (const move of room.chess.moves) engine.move(move.san);
  return engine;
}
function playerFor(room, color) { return room.players.find(p => p.id === room.chess[color === 'w' ? 'whiteId' : 'blackId']); }
function finish(room, reason, winnerId, now) {
  if (room.status === 'playing') {
    const state = room.chess;
    state.remaining[state.turn] = Math.max(0, state.remaining[state.turn] - Math.max(0, now - state.turnStartedAt));
    state.turnStartedAt = now;
  }
  room.status = 'completed'; room.closedAt = now; room.reason = reason;
  room.winners = winnerId ? [winnerId] : room.players.map(p => p.id);
  room.chess.result = winnerId ? (winnerId === room.chess.whiteId ? '1-0' : '0-1') : '½-½';
  room.chess.drawOffer = null; room.chess.botDueAt = null;
  room.chess.hint = null;
  for (const p of room.players) {
    p.status = 'finished'; p.finishedAt = now;
    p.score = winnerId ? (p.id === winnerId ? 1 : 0) : 0.5;
  }
}
function outcome(room, engine, now) {
  if (engine.isCheckmate()) finish(room, 'CHESS_CHECKMATE', playerFor(room, other(engine.turn())).id, now);
  else if (engine.isStalemate()) finish(room, 'CHESS_STALEMATE', null, now);
  else if (engine.isInsufficientMaterial()) finish(room, 'CHESS_MATERIAL', null, now);
  else if (engine.isThreefoldRepetition()) finish(room, 'CHESS_REPETITION', null, now);
  else if (engine.isDrawByFiftyMoves()) finish(room, 'CHESS_FIFTY', null, now);
}
function applyMove(room, engine, move, now) {
  const state = room.chess;
  state.remaining[state.turn] = Math.max(0, state.remaining[state.turn] - Math.max(0, now - state.turnStartedAt));
  const played = engine.move(move);
  state.moves.push({ san: played.san, from: played.from, to: played.to, color: played.color, promotion: played.promotion });
  playerFor(room, played.color).index++;
  state.fen = engine.fen(); state.turn = engine.turn(); state.turnStartedAt = now; state.drawOffer = null;
  state.hint = null;
  state.revision = (state.revision ?? 0) + 1;
  outcome(room, engine, now);
  state.botDueAt = room.status === 'playing' && playerFor(room, state.turn)?.bot ? now + 400 : null;
}
export function advanceChess(room, now) {
  const state = room.chess;
  if (room.status === 'starting' && now >= room.startDeadline) {
    const present = room.players.filter(p => p.startedAt !== null);
    if (present.length) finish(room, 'CHESS_NO_SHOW', present[0].id, now);
    else {
      finish(room, 'ALL_FORFEIT', null, now); room.winners = []; state.result = '—';
      for (const p of room.players) { p.status = 'forfeit'; p.score = 0; }
    }
  }
  if (room.status !== 'playing') return;
  if (state.remaining[state.turn] - Math.max(0, now - state.turnStartedAt) <= 0) {
    state.remaining[state.turn] = 0;
    const engine = new Chess(state.fen);
    const opponentPieces = engine.board().flat().filter(p => p && p.color === other(state.turn) && p.type !== 'k');
    const noMatingMaterial = !opponentPieces.length || engine.isInsufficientMaterial();
    finish(room, noMatingMaterial ? 'CHESS_MATERIAL' : 'CHESS_TIMEOUT', noMatingMaterial ? null : playerFor(room, other(state.turn)).id, now); return;
  }
  if (room.difficulty === 'beginner' && state.botDueAt !== null && now >= state.botDueAt) {
    const engine = engineFor(room); applyMove(room, engine, chooseBotMove(engine), now);
  }
}
export function applyBotMove(room, move, expectedFen, expectedPly, now) {
  advanceChess(room, now);
  if (room.status !== 'playing' || room.chess.fen !== expectedFen || room.chess.moves.length !== expectedPly) return false;
  requireThat(playerFor(room, room.chess.turn)?.bot, 'CHESS_NOT_YOUR_TURN');
  const engine = engineFor(room);
  const legal = engine.moves({ verbose: true }).find(m => m.from === move.from && m.to === move.to && m.promotion === move.promotion);
  requireThat(legal, 'CHESS_ILLEGAL_MOVE');
  applyMove(room, engine, legal, now); return true;
}
export function actChess(room, player, action, input, now) {
  const state = room.chess;
  if (action === 'ready') {
    requireThat(room.status === 'lobby', 'ROOM_LOCKED', 409);
    requireThat(input.rulesVersion === room.rulesVersion, 'RULES_CHANGED', 409);
    requireThat(room.players.length === 2, 'WAIT_FOR_PLAYERS', 409);
    if (room.stakeLuna) requireThat(player.fundedHash, 'DEPOSIT_REQUIRED', 409);
    player.ready = true;
    if (room.players.every(p => p.ready)) {
      const white = room.rematchWhiteId ? room.players.findIndex(p => p.id === room.rematchWhiteId)
        : room.mode === 'practice' ? state.preferredColor === 'random' ? randomInt(2) : state.preferredColor === 'b' ? 1 : 0 : randomInt(2);
      state.whiteId = room.players[white].id; state.blackId = room.players[1 - white].id;
      room.status = 'starting'; room.startDeadline = now + room.startWindowMs;
    }
    return;
  }
  if (action === 'start') {
    if (player.startedAt !== null) return;
    requireThat(room.status === 'starting' && now < room.startDeadline, 'START_WINDOW_CLOSED', 409);
    player.startedAt = now; player.status = 'playing'; player.lastSeenAt = now;
    for (const p of room.players.filter(p => p.bot)) { p.startedAt = now; p.status = 'playing'; }
    if (room.players.every(p => p.startedAt !== null)) {
      room.status = 'playing'; state.turnStartedAt = now;
      state.botDueAt = playerFor(room, state.turn)?.bot ? now + 400 : null;
    }
    return;
  }
  if (action === 'heartbeat') { player.lastSeenAt = now; return; }
  if (action === 'undo') {
    requireThat(room.mode === 'practice' && !player.bot, 'CHESS_UNDO_UNAVAILABLE', 403);
    requireThat(typeof input.requestId === 'string' && /^[a-zA-Z0-9-]{12,80}$/.test(input.requestId), 'INVALID_REQUEST');
    const fingerprint = JSON.stringify(['undo', player.id, input.ply, input.revision]);
    if (Object.hasOwn(state.receipts, input.requestId)) {
      requireThat(state.receipts[input.requestId] === fingerprint, 'REQUEST_REUSED', 409); return;
    }
    requireThat(room.status === 'playing', 'ROUND_ENDED', 409);
    const color = state.whiteId === player.id ? 'w' : 'b';
    const exact = input.ply === state.moves.length && input.revision === (state.revision ?? 0);
    const botJustReplied = Number.isInteger(input.ply) && Number.isInteger(input.revision)
      && input.ply + 1 === state.moves.length && input.revision + 1 === (state.revision ?? 0)
      && state.moves.at(-1)?.color !== color && state.moves.at(-2)?.color === color;
    requireThat(exact || botJustReplied, 'CHESS_STALE_POSITION', 409);
    const index = state.moves.findLastIndex(m => m.color === color);
    requireThat(index >= 0, 'CHESS_NOTHING_TO_UNDO', 409);
    state.remaining[state.turn] = Math.max(0, state.remaining[state.turn] - Math.max(0, now - state.turnStartedAt));
    state.moves = state.moves.slice(0, index);
    const engine = engineFor(room);
    state.fen = engine.fen(); state.turn = engine.turn(); state.turnStartedAt = now;
    state.botDueAt = null; state.hint = null; state.drawOffer = null;
    state.revision = (state.revision ?? 0) + 1; state.takebacks = (state.takebacks ?? 0) + 1;
    for (const p of room.players) p.index = state.moves.filter(m => m.color === (p.id === state.whiteId ? 'w' : 'b')).length;
    state.receipts[input.requestId] = fingerprint;
    return;
  }
  if (action === 'hint') {
    requireThat(room.mode === 'practice' && !player.bot, 'CHESS_HINT_UNAVAILABLE', 403);
    requireThat(room.status === 'playing', 'ROUND_ENDED', 409);
    requireThat(playerFor(room, state.turn)?.id === player.id, 'CHESS_NOT_YOUR_TURN', 409);
    requireThat(Number.isInteger(input.ply) && input.ply === state.moves.length, 'CHESS_STALE_POSITION', 409);
    requireThat(input.revision === (state.revision ?? 0) || (input.revision === undefined && !state.takebacks), 'CHESS_STALE_POSITION', 409);
    if (state.hint && state.hint.status !== 'error') return;
    requireThat(!state.hint || now - state.hint.requestedAt >= 10000, 'CHESS_HINT_WAIT', 429);
    state.hint = { status: 'pending', ply: state.moves.length, requestedAt: now, move: null };
    return;
  }
  if (action === 'move') {
    requireThat(typeof input.requestId === 'string' && /^[a-zA-Z0-9-]{12,80}$/.test(input.requestId), 'INVALID_REQUEST');
    const fingerprint = JSON.stringify([player.id, input.ply, input.from, input.to, input.promotion ?? null, ...(input.revision === undefined ? [] : [input.revision])]);
    if (Object.hasOwn(state.receipts, input.requestId)) {
      requireThat(state.receipts[input.requestId] === fingerprint, 'REQUEST_REUSED', 409); return;
    }
    requireThat(room.status === 'playing', 'ROUND_ENDED', 409);
    requireThat(playerFor(room, state.turn)?.id === player.id, 'CHESS_NOT_YOUR_TURN', 409);
    requireThat(Number.isInteger(input.ply) && input.ply === state.moves.length, 'CHESS_STALE_POSITION', 409);
    requireThat(input.revision === (state.revision ?? 0) || (input.revision === undefined && !state.takebacks), 'CHESS_STALE_POSITION', 409);
    requireThat(typeof input.from === 'string' && /^[a-h][1-8]$/.test(input.from) && typeof input.to === 'string' && /^[a-h][1-8]$/.test(input.to), 'CHESS_ILLEGAL_MOVE');
    requireThat(input.promotion === undefined || ['q', 'r', 'b', 'n'].includes(input.promotion), 'CHESS_ILLEGAL_MOVE');
    const engine = engineFor(room);
    const move = engine.moves({ verbose: true }).find(m => m.from === input.from && m.to === input.to && m.promotion === input.promotion);
    requireThat(move, 'CHESS_ILLEGAL_MOVE');
    applyMove(room, engine, move, now); state.receipts[input.requestId] = fingerprint; return;
  }
  requireThat(room.status === 'playing', 'ROUND_ENDED', 409);
  if (action === 'resign') finish(room, 'CHESS_RESIGNED', room.players.find(p => p.id !== player.id).id, now);
  else if (action === 'offerDraw') {
    requireThat(room.mode === 'friends', 'CHESS_DRAW_UNAVAILABLE');
    state.drawOffer = player.id;
  } else if (action === 'acceptDraw') {
    requireThat(state.drawOffer && state.drawOffer !== player.id, 'CHESS_NO_DRAW_OFFER', 409);
    finish(room, 'CHESS_AGREED_DRAW', null, now);
  } else if (action === 'declineDraw') {
    requireThat(state.drawOffer && state.drawOffer !== player.id, 'CHESS_NO_DRAW_OFFER', 409); state.drawOffer = null;
  } else requireThat(false, 'UNKNOWN_ACTION', 404);
}
export function chessView(room, userId, now) {
  const state = room.chess, engine = new Chess(state.fen);
  const remaining = { ...state.remaining };
  if (room.status === 'playing') remaining[state.turn] = Math.max(0, remaining[state.turn] - Math.max(0, now - state.turnStartedAt));
  return { fen: state.fen, turn: state.turn, whiteId: state.whiteId, blackId: state.blackId,
    myColor: state.whiteId === userId ? 'w' : state.blackId === userId ? 'b' : null,
    remaining, moves: state.moves, inCheck: engine.isCheck(), result: state.result, drawOffer: state.drawOffer,
    revision: state.revision ?? 0,
    canUndo: room.mode === 'practice' && room.status === 'playing' && state.moves.some(m => m.color === (state.whiteId === userId ? 'w' : 'b')),
    botThinking: room.status === 'playing' && !!playerFor(room, state.turn)?.bot,
    hint: room.mode === 'practice' && room.status === 'playing' && playerFor(room, state.turn)?.id === userId ? state.hint ?? null : null,
    legalMoves: room.status === 'playing' && playerFor(room, state.turn)?.id === userId
      ? engine.moves({ verbose: true }).map(m => ({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) })) : [] };
}

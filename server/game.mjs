import { paymentNetwork } from './payment-network.mjs';
import { feeContribution } from './payment-fees.mjs';
import { initChess, actChess, advanceChess, chessView } from './chess-game.mjs';
import { initPuzzle, actPuzzle, puzzleView } from './puzzles.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { publicQuestion, questionDeck, retryQuestion } from './questions.mjs';
import languages from '../shared/languages.json' with { type: 'json' };
import chessLevels from '../shared/chess-levels.json' with { type: 'json' };

export class GameError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function requireThat(condition, code, status = 400) {
  if (!condition) throw new GameError(code, status);
}
const terminal = new Set(['finished', 'forfeit']);
export const isActive = room => ['lobby', 'starting', 'playing'].includes(room.status);

function newPlayer(user) {
  return { id: user.id, name: user.name, ready: false, status: 'waiting', startedAt: null,
    ...(user.nickname ? { nickname: user.nickname } : {}),
    ...(user.wallet ? { walletAddress: user.wallet.address } : {}),
    deadline: null, lastSeenAt: null, finishedAt: null, score: 0, index: 0, questions: [], answers: [], receipts: {} };
}

export function createRoom(user, input, now, payments = null) {
  requireThat(['math', 'flags', 'capitals', 'chess', 'mixed', 'puzzles'].includes(input.topic), 'INVALID_TOPIC');
  requireThat(input.topic === 'chess' && input.mode === 'practice'
    ? typeof input.difficulty === 'string' && Object.hasOwn(chessLevels, input.difficulty)
    : ['easy', 'normal', 'hard'].includes(input.difficulty), 'INVALID_DIFFICULTY');
  requireThat(typeof input.language === 'string' && Object.hasOwn(languages, input.language), 'INVALID_LANGUAGE');
  requireThat(input.mode === 'practice' || input.mode === 'friends', 'INVALID_MODE');
  const chess = input.topic === 'chess';
  if (input.chessColor !== undefined) requireThat(chess && input.mode === 'practice' && ['w', 'b', 'random'].includes(input.chessColor), 'CHESS_INVALID_COLOR');
  requireThat(!chess || input.mode === 'practice' || input.capacity === 2, 'CHESS_TWO_PLAYERS');
  const capacity = chess ? 2 : input.mode === 'practice' ? 1 : input.capacity;
  requireThat(Number.isInteger(capacity) && capacity >= (input.mode === 'practice' ? 1 : 2) && capacity <= 8, 'INVALID_CAPACITY');
  const stakeLuna = input.stake ?? 0;
  requireThat(input.topic !== 'puzzles' || (input.mode === 'practice' && stakeLuna === 0), 'PUZZLES_SOLO_ONLY');
  requireThat(Number.isSafeInteger(stakeLuna) && stakeLuna >= 0 && stakeLuna <= 10_000_000, 'INVALID_PAYMENT_AMOUNT');
  if (stakeLuna) {
    requireThat(payments?.ready && input.mode === 'friends', 'PAYMENTS_UNAVAILABLE', 503);
    requireThat(payments.network !== 'mainalbatross' || input.paymentNetwork === 'mainalbatross', 'PAYMENT_NETWORK_CHANGED', 409);
    requireThat(user.wallet && user.wallet.address !== payments.address, 'VERIFIED_WALLET_REQUIRED', 403);
  }
  const room = {
    code: randomBytes(5).toString('hex').toUpperCase(), ownerId: user.id,
    topic: input.topic, difficulty: input.difficulty, language: input.language, mode: input.mode,
    capacity, rulesVersion: 1, roundMs: 90_000, startWindowMs: 120_000, questionCount: 30,
    status: 'lobby', createdAt: now, lobbyDeadline: now + 30 * 60_000,
    startDeadline: null, closedAt: null, reason: null, winners: [],
    players: [newPlayer(user)],
    ...(stakeLuna ? { stakeLuna, paymentNetwork: paymentNetwork(payments.network).name, paymentRulesVersion: paymentNetwork(payments.network).rules, treasuryAddress: payments.address } : {}),
  };
  if (chess) initChess(room, input.chessColor ?? 'w');
  if (input.topic === 'puzzles') initPuzzle(room);
  return room;
}

export function member(room, userId) {
  const player = room.players.find(p => p.id === userId);
  requireThat(player, 'NOT_A_MEMBER', 403);
  return player;
}

export function advance(room, now) {
  if (!isActive(room)) return;
  if (room.status === 'lobby') {
    if (now >= room.lobbyDeadline) { room.status = 'cancelled'; room.reason = 'LOBBY_EXPIRED'; room.closedAt = now; }
    return;
  }
  if (room.topic === 'chess') { advanceChess(room, now); return; }
  if (room.topic === 'puzzles') {
    if (room.status === 'playing' && now >= room.players[0].deadline) voidRoom(room, now, 'PUZZLE_EXPIRED');
    return;
  }
  for (const p of room.players) {
    if (p.status === 'waiting' && now >= room.startDeadline) {
      p.status = 'forfeit'; p.finishedAt = room.startDeadline;
    }
    if (p.status === 'playing' && now >= p.deadline) {
      // Brief network interruptions are tolerated; a disconnected player forfeits.
      p.status = p.deadline - p.lastSeenAt <= 5_000 ? 'finished' : 'forfeit';
      p.finishedAt = p.deadline;
    }
  }
  if (room.players.every(p => terminal.has(p.status))) {
    room.status = 'completed'; room.closedAt = now;
    const finishers = room.players.filter(p => p.status === 'finished');
    const best = Math.max(...finishers.map(p => p.score));
    room.winners = finishers.filter(p => p.score === best).map(p => p.id);
    if (finishers.length === 0) room.reason = 'ALL_FORFEIT';
  }
}

export function act(room, user, action, input, now) {
  advance(room, now);
  if (action === 'join') {
    requireThat(!room.invitedUserId || room.invitedUserId === user.id || room.players.some(p => p.id === user.id), 'INVITE_FORBIDDEN', 403);
    requireThat(!room.rematchPlayers || room.rematchPlayers.includes(user.id), 'REMATCH_MEMBERS_ONLY', 403);
    if (room.players.some(p => p.id === user.id)) return;
    requireThat(room.status === 'lobby', 'ROOM_LOCKED', 409);
    requireThat(room.players.length < room.capacity, 'ROOM_FULL', 409);
    if (room.stakeLuna) {
      requireThat(user.wallet && user.wallet.address !== room.treasuryAddress, 'VERIFIED_WALLET_REQUIRED', 403);
      requireThat(!room.players.some(p => p.walletAddress === user.wallet.address), 'DUPLICATE_WALLET', 409);
    }
    room.players.push(newPlayer(user));
    room.rulesVersion++;
    for (const p of room.players) p.ready = false;
    return;
  }
  const p = member(room, user.id);
  if (action === 'leave') {
    requireThat(room.status === 'lobby', 'ALREADY_COMMITTED', 409);
    if (room.matchmaking || room.invitedUserId || room.rematchOf) { room.status = 'cancelled'; room.reason = room.matchmaking ? 'SEARCH_CANCELLED' : room.rematchOf ? 'REMATCH_CANCELLED' : 'INVITE_CANCELLED'; room.closedAt = now; return; }
    if (room.stakeLuna) {
      // Keep the funded roster in the final record so refunds survive cancellation and restart.
      room.status = 'cancelled'; room.reason = 'PLAYER_LEFT'; room.closedAt = now; return;
    }
    room.players = room.players.filter(other => other.id !== user.id);
    room.rulesVersion++;
    for (const other of room.players) other.ready = false;
    if (!room.players.length) { room.status = 'cancelled'; room.closedAt = now; }
    else if (room.ownerId === user.id) room.ownerId = room.players[0].id;
    return;
  }
  if (room.topic === 'chess') { actChess(room, p, action, input, now); return; }
  if (room.topic === 'puzzles') { actPuzzle(room, p, action, input, now); return; }
  if (action === 'ready') {
    requireThat(room.status === 'lobby', 'ROOM_LOCKED', 409);
    requireThat(input.rulesVersion === room.rulesVersion, 'RULES_CHANGED', 409);
    requireThat(room.players.length === room.capacity, 'WAIT_FOR_PLAYERS', 409);
    if (room.stakeLuna) requireThat(p.fundedHash, 'DEPOSIT_REQUIRED', 409);
    p.ready = true;
    if (room.players.every(other => other.ready)) {
      room.status = 'starting'; room.startDeadline = now + room.startWindowMs;
      for (const other of room.players) other.questions = room.trainingQuestions
        ? room.trainingQuestions.map(retryQuestion) : questionDeck(room.topic, room.difficulty, room.language, room.questionCount);
    }
    return;
  }
  if (action === 'start') {
    if (p.startedAt !== null) return;
    requireThat(['starting', 'playing'].includes(room.status) && p.status === 'waiting' && now < room.startDeadline, 'START_WINDOW_CLOSED', 409);
    p.status = 'playing'; p.startedAt = now; p.lastSeenAt = now; p.deadline = now + room.roundMs;
    room.status = 'playing';
    return;
  }
  if (action === 'heartbeat') {
    if (p.status === 'playing' && room.status === 'playing') p.lastSeenAt = now;
    return;
  }
  if (action === 'answer') {
    requireThat(typeof input.requestId === 'string' && /^[a-zA-Z0-9-]{12,80}$/.test(input.requestId), 'INVALID_REQUEST');
    if (Object.hasOwn(p.receipts, input.requestId)) {
      const receipt = p.receipts[input.requestId];
      requireThat(receipt.questionId === input.questionId && receipt.value === input.value, 'REQUEST_REUSED', 409);
      return;
    }
    requireThat(p.status === 'playing' && now < p.deadline && room.status === 'playing', 'ROUND_ENDED', 409);
    const q = p.questions[p.index];
    requireThat(q && q.id === input.questionId, 'STALE_QUESTION', 409);
    requireThat(input.value === null || (typeof input.value === 'string' && input.value.length <= 80), 'INVALID_ANSWER');
    if (q.kind !== 'math') requireThat(input.value === null || q.options.some(o => o.id === input.value), 'INVALID_ANSWER');
    else requireThat(input.value === null || /^-?\d{1,7}$/.test(input.value), 'INVALID_ANSWER');
    const value = q.kind === 'math' && input.value !== null ? String(Number(input.value)) : input.value;
    const correct = value === q.answer;
    const record = { questionId: q.id, value: input.value, correct, skipped: input.value === null, receivedAt: now };
    p.answers.push(record); p.receipts[input.requestId] = record; p.lastSeenAt = now;
    p.score += input.value === null ? 0 : correct ? 1 : -1;
    p.index++;
    if (p.index === p.questions.length) { p.status = 'finished'; p.finishedAt = now; }
  } else if (action === 'finish') {
    if (p.status === 'finished') return;
    requireThat(p.status === 'playing' && room.status === 'playing' && now < p.deadline, 'ROUND_ENDED', 409);
    p.status = 'finished'; p.finishedAt = now;
  } else {
    throw new GameError('UNKNOWN_ACTION', 404);
  }
  advance(room, now);
}

export function voidRoom(room, now, reason = 'SERVER_INTERRUPTION') {
  if (!['starting', 'playing'].includes(room.status)) return;
  room.status = 'void'; room.reason = reason; room.closedAt = now; room.winners = [];
}

export function roomView(room, userId, now) {
  const me = member(room, userId);
  const reveal = room.status === 'completed';
  const review = reveal ? me.answers.map(a => {
    const q = me.questions.find(item => item.id === a.questionId);
    return { ...a, question: publicQuestion(q), answer: q.answerLabel ?? q.answer,
      submitted: a.value === null ? null : q.kind !== 'math' ? q.options.find(o => o.id === a.value)?.label : a.value };
  }) : [];
  return {
    code: room.code, topic: room.topic, difficulty: room.difficulty, language: room.language,
    training: Boolean(room.trainingQuestions), rematchCode: room.rematchCode ?? null,
    matchmaking: Boolean(room.matchmaking), ranked: Boolean(room.ranked),
    rating: reveal ? room.rating ?? null : null,
    invitedNickname: room.invitedNickname ?? null,
    rematchOf: room.rematchOf ?? null,
    mode: room.mode, capacity: room.capacity, rulesVersion: room.rulesVersion,
    roundMs: room.roundMs, startWindowMs: room.startWindowMs, questionCount: room.questionCount,
    status: room.status, createdAt: room.createdAt, startDeadline: room.startDeadline,
    lobbyDeadline: room.lobbyDeadline, closedAt: room.closedAt, reason: room.reason,
    winners: room.winners, serverNow: now,
    stakeLuna: room.stakeLuna ?? 0, feeContributionLuna: feeContribution(room), paymentNetwork: room.paymentNetwork ?? 'testalbatross',
    players: room.players.map(p => ({ id: p.id, name: p.name, nickname: p.nickname ?? null, ready: p.ready, status: p.status,
      funded: Boolean(p.fundedHash), score: reveal ? p.score : null, answered: reveal || p.id === userId ? p.index : null })),
    me: { id: me.id, status: me.status, startedAt: me.startedAt, deadline: me.deadline,
      answered: me.index, score: room.mode === 'practice' || reveal ? me.score : null },
    ...(room.topic === 'chess' ? { chess: chessView(room, userId, now) } : {}),
    ...(room.topic === 'puzzles' ? puzzleView(room) : {}),
    question: !['chess', 'puzzles'].includes(room.topic) && me.status === 'playing' && room.status === 'playing' ? publicQuestion(me.questions[me.index]) : null,
    feedback: room.topic !== 'chess' && room.mode === 'practice' && me.answers.length ? {
      correct: me.answers.at(-1).correct, skipped: me.answers.at(-1).skipped,
      kind: me.questions[me.index - 1].kind,
      answer: me.questions[me.index - 1].answerLabel ?? me.questions[me.index - 1].answer,
    } : null,
    review,
  };
}

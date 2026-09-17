import test from 'node:test';
import assert from 'node:assert/strict';
import { act, advance, createRoom, roomView, voidRoom } from '../server/game.mjs';
import { arithmetic, questionDeck } from '../server/questions.mjs';

const alice = { id: 'alice', name: 'Аліса' };
const bob = { id: 'bob', name: 'Богдан' };
const carol = { id: 'carol', name: 'Кароліна' };
const input = { topic: 'math', difficulty: 'normal', language: 'uk', mode: 'friends', capacity: 2 };
const base = 1_000_000;
function match(capacity = 2) {
  const r = createRoom(alice, { ...input, capacity }, base);
  act(r, bob, 'join', {}, base);
  if (capacity === 3) act(r, carol, 'join', {}, base);
  for (const user of capacity === 3 ? [alice, bob, carol] : [alice, bob]) act(r, user, 'ready', { rulesVersion: r.rulesVersion }, base);
  return r;
}
function answer(r, user, value, time = base + 1, id = 'request-123456789') {
  const p = r.players.find(p => p.id === user.id);
  act(r, user, 'answer', { value, questionId: p.questions[p.index].id, requestId: id }, time);
}

test('arithmetic templates always produce correct integer results', () => {
  for (const difficulty of ['normal', 'hard']) for (let i = 0; i < 1000; i++) {
    const q = arithmetic(i, difficulty);
    const [a, op, b] = q.prompt.split(' ');
    const expected = op === '+' ? +a + +b : op === '−' ? +a - +b : op === '×' ? +a * +b : +a / +b;
    assert.equal(Number(q.answer), expected);
    assert.ok(Number.isInteger(expected));
  }
});
test('flags have four unique options and exactly one matching answer', () => {
  for (const lang of ['uk', 'en']) for (const q of questionDeck('flags', 'normal', lang, 100)) {
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options.map(o => o.label)).size, 4);
    assert.equal(q.options.find(o => o.id === q.answer).label, q.answerLabel);
    assert.equal(q.visual.type, 'image');
    assert.match(q.visual.src, /^\/flags\/[a-f0-9]{20}\.svg$/);
  }
});
test('changing the roster invalidates stale ready confirmations', () => {
  const r = createRoom(alice, input, base);
  const previous = r.rulesVersion;
  act(r, bob, 'join', {}, base);
  assert.throws(() => act(r, alice, 'ready', { rulesVersion: previous }, base), /RULES_CHANGED/);
  act(r, alice, 'ready', { rulesVersion: r.rulesVersion }, base);
  act(r, bob, 'leave', {}, base);
  assert.equal(r.players[0].ready, false);
  assert.throws(() => act(r, alice, 'ready', { rulesVersion: r.rulesVersion }, base), /WAIT_FOR_PLAYERS/);
});
test('late starters receive the same full round duration, results wait for them', () => {
  const r = match();
  act(r, alice, 'start', {}, base + 10_000);
  act(r, alice, 'finish', {}, base + 80_000);
  act(r, bob, 'start', {}, base + 119_999);
  assert.equal(r.players[1].deadline, base + 209_999);
  advance(r, base + 120_000);
  assert.equal(r.status, 'playing');
  assert.equal(roomView(r, alice.id, base + 120_000).players[0].score, null);
  act(r, bob, 'finish', {}, base + 200_000);
  assert.equal(r.status, 'completed');
  assert.deepEqual(r.winners.sort(), ['alice', 'bob']);
});
test('start deadline is exclusive and a ready no-show forfeits', () => {
  const r = match();
  act(r, alice, 'start', {}, base);
  act(r, alice, 'finish', {}, base + 1);
  assert.throws(() => act(r, bob, 'start', {}, base + 120_000), /START_WINDOW_CLOSED/);
  assert.equal(r.players[1].status, 'forfeit');
  assert.deepEqual(r.winners, ['alice']);
});
test('a disconnected player forfeits, a present player finishes at the deadline', () => {
  const r = match();
  act(r, alice, 'start', {}, base);
  act(r, bob, 'start', {}, base);
  act(r, alice, 'heartbeat', {}, base + 88_000);
  advance(r, base + 90_000);
  assert.equal(r.players[0].status, 'finished');
  assert.equal(r.players[1].status, 'forfeit');
  assert.deepEqual(r.winners, ['alice']);
});
test('reconnect never resets clock; reconnect after deadline cannot rescue a forfeit', () => {
  const r = match(); act(r, alice, 'start', {}, base);
  const original = r.players[0].deadline;
  act(r, alice, 'start', {}, base + 20_000);
  act(r, alice, 'heartbeat', {}, base + 30_000);
  assert.equal(r.players[0].deadline, original);
  act(r, alice, 'heartbeat', {}, base + 91_000);
  assert.equal(r.players[0].status, 'forfeit');
});
test('duplicate answer requests are idempotent and cannot change the answer', () => {
  const r = match(); act(r, alice, 'start', {}, base);
  const q = r.players[0].questions[0];
  const payload = { value: q.answer, questionId: q.id, requestId: 'request-repeat-123' };
  act(r, alice, 'answer', payload, base + 1);
  act(r, alice, 'answer', payload, base + 2);
  assert.equal(r.players[0].score, 1); assert.equal(r.players[0].index, 1);
  assert.throws(() => act(r, alice, 'answer', { ...payload, value: '99999' }, base + 3), /REQUEST_REUSED/);
  assert.throws(() => act(r, alice, 'answer', { ...payload, requestId: 'request-another-123' }, base + 4), /STALE_QUESTION/);
});
test('answers at or after deadline do not count', () => {
  const r = match(); act(r, alice, 'start', {}, base);
  assert.throws(() => answer(r, alice, r.players[0].questions[0].answer, base + 90_000), /ROUND_ENDED/);
  assert.equal(r.players[0].score, 0);
});
test('only the current question is visible, scores and reviews stay secret', () => {
  const r = match(); act(r, alice, 'start', {}, base);
  const raw = r.players[0].questions[0];
  const view = roomView(r, alice.id, base);
  assert.equal(view.question.id, raw.id);
  assert.equal(view.question.answer, undefined);
  assert.equal(view.players[1].answered, null);
  assert.equal(view.me.score, null);
  assert.equal(view.feedback, null);
  assert.deepEqual(view.review, []);
  assert.ok(!JSON.stringify(view).includes(r.players[0].questions[1].id));
  assert.throws(() => roomView(r, 'outsider', base), /NOT_A_MEMBER/);
});
test('correct, wrong and skipped answers score +1, -1 and 0', () => {
  const r = match(); act(r, alice, 'start', {}, base);
  answer(r, alice, r.players[0].questions[0].answer, base + 1, 'correct-answer-123');
  answer(r, alice, '999999', base + 2, 'wrong-answer-123');
  answer(r, alice, null, base + 3, 'skipped-answer-123');
  assert.equal(r.players[0].score, 0); assert.equal(r.players[0].index, 3);
});
test('group games retain all tied winners and exclude forfeits even with a higher score', () => {
  const r = match(3);
  for (const user of [alice, bob, carol]) act(r, user, 'start', {}, base);
  answer(r, carol, r.players[2].questions[0].answer);
  act(r, alice, 'finish', {}, base + 2); act(r, bob, 'finish', {}, base + 3);
  advance(r, base + 90_000);
  assert.deepEqual(r.winners.sort(), ['alice', 'bob']);
});
test('server interruption voids an active game but preserves completed results', () => {
  const r = match(); voidRoom(r, base + 1);
  assert.equal(r.status, 'void'); assert.deepEqual(r.winners, []);
  assert.throws(() => act(r, alice, 'start', {}, base + 2), /START_WINDOW_CLOSED/);
  const done = match();
  for (const user of [alice, bob]) { act(done, user, 'start', {}, base); act(done, user, 'finish', {}, base + 1); }
  voidRoom(done, base + 2); assert.equal(done.status, 'completed');
});
test('all forfeits produce no winner; unfinished lobbies expire', () => {
  const r = match(); advance(r, base + 120_000);
  assert.equal(r.reason, 'ALL_FORFEIT'); assert.deepEqual(r.winners, []);
  const lobby = createRoom(alice, input, base); advance(lobby, base + 1800_000);
  assert.equal(lobby.status, 'cancelled');
});
test('paid requests are rejected server-side', () => {
  assert.throws(() => createRoom(alice, { ...input, stake: 10 }, base), /PAYMENTS_UNAVAILABLE/);
  assert.throws(() => createRoom(alice, { ...input, capacity: 9 }, base), /INVALID_CAPACITY/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Address } from '@nimiq/core';
import { Store } from '../server/store.mjs';
import { createRoom } from '../server/game.mjs';
import { settlementPlan } from '../server/payment-policy.mjs';
import { identify } from './helpers/identity.mjs';

const input = { topic: 'math', difficulty: 'normal', language: 'en', mode: 'friends', capacity: 2 };
function fixture(t) {
  let now = Date.now();
  const store = new Store(':memory:', () => now); t.after(() => store.close());
  const a = new Address(new Uint8Array(20).fill(20));
  const status = { ready: true, network: 'testalbatross', address: a.toUserFriendlyAddress() }; a.free();
  store.payments = { status: () => status };
  const users = Array.from({ length: 5 }, (_, i) => identify(store, store.createSession('Player ' + i), 'paid_' + i).user);
  const fund = (room, players) => {
    const deposits = players.map((p, i) => ({ playerId: p.id, address: p.wallet.address, amountLuna: room.stakeLuna, hash: String(i + 1).repeat(64) }));
    store.markFunded(room.code, deposits); return deposits;
  };
  return { store, users, status, fund, now: () => now, later(ms) { now += ms; store.tick(); } };
}

for (const topic of ['math', 'flags', 'capitals', 'mixed', 'chess']) {
  test(`${topic}: matchmaking separates stakes, enforces payment, settles results and preserves the stake on rematch`, t => {
    const { store, users: [free, a, expensive, b], fund, now } = fixture(t);
    const settings = { ...input, topic, stake: 100000 };
    store.search(free, 'start', { ...settings, stake: 0 });
    const queued = store.search(a, 'start', settings);
    assert.equal(queued.stakeLuna, 100000);
    store.search(expensive, 'start', { ...settings, stake: 500000 });
    assert.throws(() => store.search(a, 'start', { ...settings, stake: 500000 }), /SEARCH_ACTIVE/);
    const found = store.search(b, 'start', settings), room = store.load(found.room.code);
    assert.equal(room.stakeLuna, 100000); assert.equal(room.lobbyDeadline, now() + 600000);
    assert.deepEqual(room.players.map(p => p.walletAddress), [a.wallet.address, b.wallet.address]);
    assert.equal(store.search(free, 'view').status, 'searching');
    assert.equal(store.search(expensive, 'view').status, 'searching');
    assert.throws(() => store.action(room.code, a, 'ready', { rulesVersion: room.rulesVersion }), /DEPOSIT_REQUIRED/);
    const deposits = fund(room, [a, b]);
    for (const user of [a, b]) store.action(room.code, user, 'ready', { rulesVersion: room.rulesVersion });
    for (const user of [a, b]) store.action(room.code, user, 'start', {});
    if (topic === 'chess') store.action(room.code, a, 'resign', {});
    else for (const user of [a, b]) store.action(room.code, user, 'finish', {});
    const result = store.load(room.code), plan = settlementPlan(result, deposits);
    assert.equal(plan.totalLuna, 200000);
    assert.deepEqual(plan.transfers.map(p => p.amountLuna).sort(), topic === 'chess' ? [200000] : [100000, 100000]);
    const rematch = store.rematch(room.code, b); store.rematch(room.code, a);
    assert.equal(rematch.stakeLuna, 100000);
    assert.ok(store.load(rematch.code).players.every(p => !p.fundedHash));
    const next = store.load(rematch.code);
    assert.throws(() => store.action(next.code, b, 'ready', { rulesVersion: next.rulesVersion }), /DEPOSIT_REQUIRED/);
  });
}

test('paid search preserves skill/rating boundaries and skips an expired candidate session', t => {
  const { store, users: [a, b, c, d, e] } = fixture(t);
  const settings = { ...input, stake: 100000, ranked: true };
  store.search(a, 'start', { ...settings, difficulty: 'hard' });
  store.search(b, 'start', { ...settings, ranked: false });
  store.search(c, 'start', settings);
  store.db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(c.id);
  assert.equal(store.search(d, 'start', settings).status, 'searching');
  const found = store.search(e, 'start', settings);
  assert.deepEqual(found.room.players.map(p => p.id), [d.id, e.id]);
  assert.equal(found.room.ranked, true);
});

test('paid matchmaking cancellation and deadline preserve funded members for refunds', t => {
  const { store, users: [a, b, c, d], fund, later } = fixture(t);
  const settings = { ...input, stake: 100000 };
  const queued = store.search(a, 'start', settings); const found = store.search(b, 'start', settings);
  const room = store.load(found.room.code); const deposits = fund(room, [a]);
  store.search(a, 'cancel', { ticket: queued.ticket });
  assert.equal(store.load(room.code).players.length, 2);
  assert.deepEqual(settlementPlan(store.load(room.code), deposits).transfers.map(p => [p.kind, p.amountLuna]), [['refund', 100000]]);
  store.search(c, 'start', settings); const next = store.search(d, 'start', settings).room;
  const paid = fund(next, [c]); later(600000);
  assert.equal(store.load(next.code).reason, 'LOBBY_EXPIRED');
  assert.equal(settlementPlan(store.load(next.code), paid).transfers[0].amountLuna, 100000);
});

test('paid nickname invites disclose the stake before acceptance and retain payment checks', t => {
  const { store, users: [a, b, outsider], fund } = fixture(t);
  const room = store.create(a, { ...input, topic: 'chess', stake: 500000, invite: b.nickname });
  const invite = store.invitations(b).invitations[0];
  assert.equal(invite.stakeLuna, 500000); assert.equal(invite.roomCode, undefined);
  assert.throws(() => store.action(room.code, outsider, 'join', {}), /INVITE_FORBIDDEN/);
  const joined = store.invitation(b, invite.id, 'accept').room;
  assert.equal(joined.stakeLuna, 500000); assert.equal(joined.players.length, 2);
  assert.throws(() => store.action(room.code, b, 'ready', { rulesVersion: joined.rulesVersion }), /DEPOSIT_REQUIRED/);
  const deposits = fund(joined, [a]);
  store.action(room.code, b, 'leave', {});
  assert.equal(settlementPlan(store.load(room.code), deposits).transfers[0].amountLuna, 500000);
});

test('all solo modes stay free, and unavailable payments or unsigned wallets cannot enter paid search', t => {
  const { store, users: [a], status, now } = fixture(t);
  for (const topic of ['math', 'flags', 'capitals', 'mixed', 'chess', 'puzzles']) {
    assert.throws(() => createRoom(a, { ...input, topic, mode: 'practice', stake: 100000 }, now(), status), /PAYMENTS_UNAVAILABLE|PUZZLES_SOLO_ONLY/);
  }
  const guest = store.createSession('Guest');
  assert.throws(() => store.search(guest.user, 'start', { ...input, stake: 100000 }), /VERIFIED_WALLET_REQUIRED/);
  status.ready = false;
  assert.throws(() => store.search(a, 'start', { ...input, stake: 100000 }), /PAYMENTS_UNAVAILABLE/);
  assert.equal(store.search(a, 'start', { ...input, stake: 0 }).status, 'searching');
});

for (const outcome of ['draw', 'no-show', 'interruption']) {
  test(`paid ranked chess: ${outcome} conserves deposits and rates only completed play`, t => {
    const { store, users: [a, b], fund, later } = fixture(t);
    const settings = { ...input, topic: 'chess', stake: 500000, ranked: true };
    store.search(a, 'start', settings);
    const room = store.search(b, 'start', settings).room;
    const deposits = fund(room, [a, b]);
    for (const user of [a, b]) store.action(room.code, user, 'ready', { rulesVersion: room.rulesVersion });
    if (outcome === 'no-show') later(120001);
    else {
      for (const user of [a, b]) store.action(room.code, user, 'start', {});
      if (outcome === 'draw') {
        store.action(room.code, a, 'offerDraw', {}); store.action(room.code, b, 'acceptDraw', {});
      } else store.tick(true);
    }
    const result = store.load(room.code), plan = settlementPlan(result, deposits);
    assert.deepEqual(plan.transfers.map(p => p.amountLuna), [500000, 500000]);
    assert.equal(store.leaderboard(a, 'chess').me.games, outcome === 'draw' ? 1 : 0);
    if (outcome === 'draw') assert.equal(result.rating.status, 'rated');
    else assert.ok(plan.transfers.every(p => p.kind === 'refund'));
  });
}

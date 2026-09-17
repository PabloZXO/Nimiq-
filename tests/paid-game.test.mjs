import test from 'node:test';
import assert from 'node:assert/strict';
import { Address } from '@nimiq/core';
import { createRoom, act } from '../server/game.mjs';
import { Store } from '../server/store.mjs';

const addr = n => { const a = new Address(new Uint8Array(20).fill(n)); const result = a.toUserFriendlyAddress(); a.free(); return result; };
const a = { id: 'a', name: 'A', wallet: { address: addr(1) } }, b = { id: 'b', name: 'B', wallet: { address: addr(2) } };
const input = { topic: 'math', difficulty: 'normal', language: 'uk', mode: 'friends', capacity: 2, stake: 100000 };
const payments = { ready: true, address: addr(3) };
test('paid rooms require verified distinct wallets and confirmed entries before ready', () => {
  assert.throws(() => createRoom({ id: 'guest' }, input, 1000, payments), /VERIFIED_WALLET_REQUIRED/);
  assert.throws(() => createRoom(a, input, 1000, { ...payments, ready: false }), /PAYMENTS_UNAVAILABLE/);
  const room = createRoom(a, input, 1000, payments);
  assert.throws(() => act(room, { id: 'other', wallet: a.wallet }, 'join', {}, 1001), /DUPLICATE_WALLET/);
  act(room, b, 'join', {}, 1001);
  assert.throws(() => act(room, a, 'ready', { rulesVersion: room.rulesVersion }, 1002), /DEPOSIT_REQUIRED/);
  room.players[0].fundedHash = 'a'.repeat(64);
  act(room, a, 'ready', { rulesVersion: room.rulesVersion }, 1002);
  assert.equal(room.status, 'lobby');
  room.players[1].fundedHash = 'b'.repeat(64);
  act(room, b, 'ready', { rulesVersion: room.rulesVersion }, 1003);
  assert.equal(room.status, 'starting');
});
test('leaving a paid lobby retains the refund roster and prevents another game start', () => {
  const room = createRoom(a, input, 1000, payments); act(room, b, 'join', {}, 1001);
  room.players[0].fundedHash = 'a'.repeat(64); act(room, a, 'leave', {}, 1002);
  assert.equal(room.status, 'cancelled'); assert.equal(room.players.length, 2);
  assert.equal(room.players[0].walletAddress, a.wallet.address);
  assert.throws(() => act(room, b, 'ready', { rulesVersion: room.rulesVersion }, 1003), /ROOM_LOCKED/);
});
test('funding cache rejects wrong addresses and is safely repeatable', () => {
  const store = new Store(':memory:', () => 1000); store.payments = { status: () => payments };
  try {
    const view = store.create(a, input), deposit = { playerId: a.id, address: a.wallet.address, amountLuna: 100000, hash: 'a'.repeat(64) };
    assert.throws(() => store.markFunded(view.code, [{ ...deposit, address: b.wallet.address }]), /DEPOSIT_MISMATCH/);
    store.markFunded(view.code, [deposit]); store.markFunded(view.code, [deposit]);
    assert.equal(store.load(view.code).players[0].fundedHash, deposit.hash);
  } finally { store.close(); }
});

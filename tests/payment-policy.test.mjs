import test from 'node:test';
import assert from 'node:assert/strict';
import { Address } from '@nimiq/core';
import { classifyDeposit, depositSender, paymentMemo, settlementPlan, PAYMENT_RULES_VERSION } from '../server/payment-policy.mjs';
import { htlcProof } from './helpers/htlc.mjs';

function address(index) {
  const value = new Address(new Uint8Array(20).fill(index));
  const result = value.toUserFriendlyAddress(); value.free(); return result;
}
const addresses = [1,2,3,4].map(address);
function fixture(count = 2) {
  const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, status: 'finished' }));
  const room = { code: 'ABCDEF1234', paymentRulesVersion: PAYMENT_RULES_VERSION, status: 'completed',
    reason: null, stakeLuna: 100_000, players, winners: ['p0'] };
  const deposits = players.map((p, i) => ({ playerId: p.id, address: addresses[i], amountLuna: room.stakeLuna }));
  return { room, deposits };
}
test('duel winner receives the full bank; server cancellation returns each own stake', () => {
  const { room, deposits } = fixture();
  const prize = settlementPlan(room, deposits); assert.equal(prize.transfers[0].amountLuna, 200_000);
  assert.equal(prize.transfers[0].kind, 'prize'); assert.equal(prize.networkId, 5);
  room.status = 'void'; room.reason = 'SERVER_INTERRUPTION';
  const refund = settlementPlan(room, deposits); assert.deepEqual(refund.transfers.map(t => t.amountLuna), [100_000, 100_000]);
});
test('group tie preserves every Luna and has a stable allocation independent of input ordering', () => {
  const { room, deposits } = fixture(4); room.winners = ['p0', 'p1', 'p2'];
  const a = settlementPlan(room, deposits); const b = settlementPlan(room, [...deposits].reverse());
  assert.equal(a.totalLuna, 400_000);
  assert.deepEqual(a.transfers.map(t => t.amountLuna), [133_334, 133_333, 133_333]);
  assert.equal(a.decisionHash, b.decisionHash);
});
test('all no-shows return deposits and unfilled cancelled rooms only return received deposits', () => {
  const { room, deposits } = fixture(3); room.reason = 'ALL_FORFEIT'; room.winners = [];
  room.players.forEach(p => p.status = 'forfeit');
  assert.equal(settlementPlan(room, deposits).transfers.length, 3);
  room.status = 'cancelled';
  assert.equal(settlementPlan(room, deposits.slice(0, 2)).totalLuna, 200_000);
});
test('settlement rejects missing deposits, forged winners, duplicate wallets and unfinished games', () => {
  const { room, deposits } = fixture(3);
  assert.throws(() => settlementPlan(room, deposits.slice(0, 2)), /MISSING_DEPOSIT/);
  assert.throws(() => settlementPlan({ ...room, winners: ['outsider'] }, deposits), /INVALID_WINNERS/);
  assert.throws(() => settlementPlan({ ...room, status: 'playing' }, deposits), /MATCH_NOT_FINAL/);
  assert.throws(() => settlementPlan(room, deposits.map(d => ({ ...d, address: deposits[0].address }))), /DUPLICATE_WALLET/);
  assert.throws(() => settlementPlan(room, [{ ...deposits[0], amountLuna: 10.5 }, ...deposits.slice(1)]), /INVALID_PAYMENT_AMOUNT/);
});
test('deposit confirmation requires testnet, final successful inclusion and exact sender/recipient/memo', () => {
  const intent = { id: 'a'.repeat(32), sender: addresses[0], recipient: addresses[1], amountLuna: 100_000, expiresAt: 1_800_000_100_000 };
  const tx = { transactionHash: 'b'.repeat(64), network: 'testalbatross', state: 'confirmed', executionResult: true,
    blockHeight: 500, sender: intent.sender, recipient: intent.recipient, senderType: 'basic', recipientType: 'basic',
    flags: 0, value: 100_000, timestamp: 1_800_000_000_000, data: { raw: Buffer.from(paymentMemo(intent.id)).toString('hex') } };
  assert.equal(classifyDeposit(tx, intent, 500).disposition, 'funded');
  assert.throws(() => classifyDeposit({ ...tx, network: 'mainalbatross' }, intent, 500), /WRONG_PAYMENT_NETWORK/);
  assert.throws(() => classifyDeposit({ ...tx, executionResult: false }, intent, 500), /PAYMENT_NOT_CONFIRMED/);
  assert.throws(() => classifyDeposit(tx, intent, 499), /PAYMENT_NOT_FINAL/);
  assert.throws(() => classifyDeposit({ ...tx, sender: addresses[2] }, intent, 500), /WRONG_PAYMENT_SENDER/);
  assert.throws(() => classifyDeposit({ ...tx, data: { raw: '' } }, intent, 500), /WRONG_PAYMENT_MEMO/);
  assert.equal(classifyDeposit({ ...tx, value: 50_000 }, intent, 500).disposition, 'refund_required');
  assert.equal(classifyDeposit({ ...tx, timestamp: intent.expiresAt }, intent, 500).reason, 'LATE_DEPOSIT');
});

test('Nimiq Pay early-resolve deposits identify the creator from raw proof, never the contract or co-signer', () => {
  const htlc = htlcProof();
  const intent = { id: 'a'.repeat(32), sender: htlc.creator, recipient: addresses[1], amountLuna: 100000, expiresAt: 1800000100000 };
  const tx = { transactionHash: 'b'.repeat(64), network: 'testalbatross', state: 'confirmed', executionResult: true,
    blockHeight: 500, sender: addresses[2], recipient: intent.recipient, senderType: 'htlc', recipientType: 'basic',
    flags: 0, value: 100000, timestamp: 1800000000000, proof: htlc.proof, data: { raw: Buffer.from(paymentMemo(intent.id)).toString('hex') } };
  assert.equal(depositSender(tx), htlc.creator);
  assert.equal(classifyDeposit(tx, intent, 500).disposition, 'funded');
  assert.throws(() => classifyDeposit(tx, { ...intent, sender: htlc.signer }, 500), /WRONG_PAYMENT_SENDER/);
  assert.throws(() => classifyDeposit(tx, { ...intent, sender: tx.sender }, 500), /WRONG_PAYMENT_SENDER/);
  assert.equal(depositSender({ ...tx, proof: { ...htlc.proof, creator: addresses[3] } }), htlc.creator);
  assert.throws(() => depositSender({ ...tx, proof: { ...htlc.proof, raw: '00' } }), /UNSUPPORTED_PAYMENT_TYPE/);
  assert.throws(() => depositSender({ ...tx, proof: htlc.timeout }), /UNSUPPORTED_PAYMENT_TYPE/);
  assert.throws(() => classifyDeposit({ ...tx, network: 'mainalbatross' }, intent, 500), /WRONG_PAYMENT_NETWORK/);
  assert.throws(() => classifyDeposit(tx, intent, 499), /PAYMENT_NOT_FINAL/);
  assert.equal(classifyDeposit(tx, { ...intent, closed: true }, 500).disposition, 'refund_required');
});

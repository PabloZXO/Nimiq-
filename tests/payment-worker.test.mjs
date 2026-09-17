import test from 'node:test';
import assert from 'node:assert/strict';
import { Payments } from '../server/payments.mjs';
import { htlcProof } from './helpers/htlc.mjs';

function fixture(job, transactions = []) {
  let jobs = job ? [{ ...job }] : []; const sent = []; let signed = 0, reviews = 0;
  const ledger = { intents: async () => [], payouts: async () => jobs, obligations: async () => 100000,
    confirm: async () => { jobs = []; }, review: async () => { jobs[0].status = 'review'; reviews++; } };
  const chain = { address: 'treasury', synced: true, head: async () => ({ height: 100, finalizedHeight: 96 }),
    history: async () => transactions, balance: async () => 1000000, broadcast: async raw => sent.push(raw), sign: async () => { signed++; throw new Error('Should not re-sign'); } };
  return { service: new Payments({ paidRooms: () => [] }, ledger, chain), chain, sent, signed: () => signed, reviews: () => reviews };
}
test('unknown broadcast result retries the persisted transaction without creating another payment', async () => {
  const f = fixture({ id: 'payout', status: 'signed', raw_tx: 'persisted-bytes', tx_hash: 'hash', valid_until: 200 });
  f.chain.broadcast = async raw => { f.sent.push(raw); if (f.sent.length === 1) throw new Error('Connection lost after send'); };
  await assert.rejects(f.service.cycle(), /Connection lost/); await f.service.cycle();
  assert.deepEqual(f.sent, ['persisted-bytes','persisted-bytes']); assert.equal(f.signed(), 0);
});
test('an expired unknown payout requires review and prevents new entries', async () => {
  const f = fixture({ id: 'payout', status: 'signed', raw_tx: 'persisted', valid_until: 100 });
  await f.service.cycle(); assert.equal(f.reviews(), 1); assert.equal(f.sent.length, 0); assert.equal(f.signed(), 0);
  assert.equal(f.service.status().ready, false); assert.equal(f.service.status().reason, 'review');
});
test('final chain proof is reconciled before checking expiry or attempting another send', async () => {
  const f = fixture({ id: 'payout', status: 'signed', raw_tx: 'persisted', tx_hash: 'hash', valid_until: 100 },
    [{ transactionHash: 'hash', state: 'confirmed', blockHeight: 90, recipient: 'winner' }]);
  await f.service.cycle(); assert.equal(f.reviews(), 0); assert.equal(f.sent.length, 0); assert.equal(f.signed(), 0);
});

test('worker forwards verified early-resolve deposits and skips unsupported contract proofs', async () => {
  const htlc = htlcProof(), id = 'a'.repeat(32), recorded = [];
  const tx = { transactionHash: 'b'.repeat(64), state: 'confirmed', executionResult: true, blockHeight: 90,
    recipient: 'treasury', senderType: 'htlc', recipientType: 'basic', flags: 0, proof: htlc.proof,
    data: { raw: Buffer.from('NimDuel:' + id).toString('hex') } };
  const f = fixture(null, [{ ...tx, proof: htlc.timeout }, tx]);
  f.service.ledger.intents = async () => [{ id, roomCode: 'ABCDEF1234' }];
  f.service.ledger.recordDeposit = async (...args) => recorded.push(args);
  f.service.store.load = () => ({ status: 'lobby', lobbyDeadline: Date.now() + 60000 });
  await f.service.cycle();
  assert.equal(recorded.length, 1); assert.equal(recorded[0][0], tx);
  assert.equal(recorded[0][2], 96); assert.equal(recorded[0][3], false);
});

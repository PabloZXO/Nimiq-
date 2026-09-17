import test from 'node:test';
import assert from 'node:assert/strict';
import { Address } from '@nimiq/core';
import { Ledger } from '../server/ledger.mjs';
import { paymentMemo } from '../server/payment-policy.mjs';
import { htlcProof } from './helpers/htlc.mjs';

const url = new URL(process.env.PAYMENT_DATABASE_URL);
const network = process.env.TEST_NETWORK === 'mainalbatross' ? 'mainalbatross' : 'testalbatross';
url.pathname = network === 'mainalbatross' ? '/nimduel_test_mainnet' : '/nimduel_test';
const ledger = new Ledger(url.toString(), network);
const address = n => { const a = new Address(new Uint8Array(20).fill(n)); const result = a.toUserFriendlyAddress(); a.free(); return result; };
const now = Date.now();
const room = { code: 'ABCDEF1234', status: 'completed', paymentNetwork: network, paymentRulesVersion: network === 'mainalbatross' ? 'nim-v1' : 'test-nim-v1', stakeLuna: 100000,
  treasuryAddress: address(3), lobbyDeadline: now + 60000, winners: ['a'], players: [
    { id: 'a', walletAddress: address(1), status: 'finished' }, { id: 'b', walletAddress: address(2), status: 'forfeit' }] };
const tx = (intent, hash, value = 100000) => ({ transactionHash: hash.repeat(64), network, state: 'confirmed', executionResult: true,
  blockHeight: 50, sender: intent.sender, recipient: intent.recipient, senderType: 'basic', recipientType: 'basic', flags: 0,
  value, fee: 0, timestamp: now, data: { raw: Buffer.from(paymentMemo(intent.id)).toString('hex') } });

test('PostgreSQL deposits, refunds, conserved liabilities, immutable settlement and crash-safe payout', async () => {
  try {
    await ledger.init();
    const wrongLedger = new Ledger(url.toString(), network === 'mainalbatross' ? 'testalbatross' : 'mainalbatross');
    try { await assert.rejects(wrongLedger.init(), /PAYMENT_DATABASE_NETWORK_MISMATCH/); } finally { await wrongLedger.close(); }
    // This command is restricted to the separately named disposable test database above.
    await ledger.pool.query('TRUNCATE journal,payouts,settlements,deposits,payment_intents CASCADE');
    const [a, b] = await Promise.all(room.players.map(p => ledger.intent(room, p)));
    assert.equal((await ledger.intent(room, room.players[0])).id, a.id);
    await Promise.all([ledger.recordDeposit(tx(a, 'a'), a, 64, false), ledger.recordDeposit(tx(a, 'a'), a, 64, false)]);
    await ledger.recordDeposit(tx(b, 'b'), b, 64, false);
    assert.equal((await ledger.funded(room.code)).length, 2);
    assert.equal(await ledger.obligations(), 200000);
    await ledger.recordDeposit(tx(a, 'c'), a, 64, false); // second distinct payment refunds
    await ledger.recordDeposit(tx(a, 'd', 50000), a, 64, false); // underpayment refunds actual amount
    assert.equal((await ledger.payouts()).length, 2);
    const plans = await Promise.all([ledger.settle(room), ledger.settle(room)]);
    assert.equal(plans[0].decisionHash, plans[1].decisionHash);
    assert.equal((await ledger.payouts()).length, 3);
    assert.equal(await ledger.obligations(), 350000);
    await ledger.recordDeposit(tx(b, 'e'), b, 64, true); // late, after settlement
    assert.equal(await ledger.obligations(), 450000);
    assert.equal((await ledger.pool.query('SELECT count(*) AS n FROM settlements')).rows[0].n, '1');
    const job = (await ledger.payouts()).find(p => p.kind === 'prize');
    const signed = await ledger.signed(job.id, { hash: 'f'.repeat(64), raw: 'saved-original-bytes', fee: 1000, validUntil: 100 });
    const retried = await ledger.signed(job.id, { hash: '9'.repeat(64), raw: 'must-never-replace', fee: 1000, validUntil: 200 });
    assert.equal(retried.raw_tx, signed.raw_tx); assert.equal(retried.tx_hash, signed.tx_hash);
    const proof = { network, state: 'confirmed', executionResult: true, blockHeight: 70,
      transactionHash: signed.tx_hash, recipient: job.address, value: 200000, fee: 1000 };
    await assert.rejects(ledger.confirm(signed, { ...proof, value: 1 }, 96), /INVALID_PAYOUT_PROOF/);
    await Promise.all([ledger.confirm(signed, proof, 96), ledger.confirm(signed, proof, 96)]);
    assert.equal(await ledger.obligations(), 250000);
    const entries = (await ledger.pool.query('SELECT entries FROM journal')).rows.flatMap(r => r.entries);
    assert.equal(entries.reduce((sum, e) => sum + e.luna, 0), 0);
    assert.equal((await ledger.pool.query("SELECT count(*) AS n FROM journal WHERE id LIKE 'payout:%'")).rows[0].n, '1');
    await ledger.recordDeposit({ ...tx(a, '7'), sender: address(4) }, a, 64, false);
    const wrongSender = (await ledger.payouts()).find(p => p.id === `deposit:${'7'.repeat(64)}`);
    assert.equal(wrongSender.address, address(4)); assert.equal(wrongSender.kind, 'refund');
    assert.equal((await ledger.funded(room.code)).length, 2);
    await assert.rejects(ledger.settle({ ...room, winners: ['b'] }), /INVALID_WINNERS|SETTLEMENT_CONFLICT/);
    const pending = (await ledger.payouts())[0];
    await ledger.signed(pending.id, { hash: '8'.repeat(64), raw: 'unknown-result', fee: 1000, validUntil: 100 });
    await ledger.review(pending.id);
    assert.equal((await ledger.payouts()).find(p => p.id === pending.id).status, 'review');
    const htlc = htlcProof();
    const htlcRoom = { ...room, code: 'ABCDEF5678', players: [{ id: 'htlc', walletAddress: htlc.creator }] };
    const htlcIntent = await ledger.intent(htlcRoom, htlcRoom.players[0]);
    const transfer = { ...tx(htlcIntent, '1'), sender: address(9), senderType: 'htlc', proof: htlc.proof };
    await ledger.recordDeposit(transfer, htlcIntent, 64, false);
    assert.equal((await ledger.funded(htlcRoom.code))[0].address, htlc.creator);
    await ledger.recordDeposit({ ...transfer, transactionHash: '2'.repeat(64) }, htlcIntent, 64, false);
    await ledger.recordDeposit({ ...transfer, transactionHash: '3'.repeat(64) }, htlcIntent, 64, true);
    const refunds = (await ledger.payouts()).filter(p => p.room_code === htlcRoom.code);
    assert.equal(refunds.length, 2);
    assert.ok(refunds.every(p => p.kind === 'refund' && p.address === htlc.creator && Number(p.amount_luna) === 100000));
    assert.equal((await ledger.funded(htlcRoom.code)).length, 1);
  } finally { await ledger.close(); }
});

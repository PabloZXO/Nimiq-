import test from 'node:test';
import assert from 'node:assert/strict';
import { Payments } from '../server/payments.mjs';
import { feeContribution, SHARED_FEE_RULES } from '../server/payment-fees.mjs';
import { NETWORKS } from '../server/payment-network.mjs';

function fixture() {
  let balance = 0, obligations = 0, fees = 0, jobs = [];
  const sent = [];
  const room = { code: 'ABCDEF1234', status: 'lobby', stakeLuna: 100000, capacity: 2,
    paymentNetwork: 'mainalbatross', paymentRulesVersion: SHARED_FEE_RULES,
    players: [{ id: 'a', walletAddress: 'alice' }, { id: 'b', walletAddress: 'bob' }] };
  const ledger = { intents: async () => [], payouts: async () => jobs, obligations: async () => obligations,
    pendingRoomFees: async () => fees, intent: async () => ({ amountLuna: 101000, feeContributionLuna: 1000 }),
    signed: async (_, tx) => ({ status: 'signed', raw_tx: tx.raw }) };
  const chain = { network: NETWORKS.mainalbatross, address: 'treasury', synced: true,
    head: async () => ({ height: 100, finalizedHeight: 96 }), history: async () => [], balance: async () => balance,
    sign: async (_, value) => { sent.push(value); return { raw: 'persisted' }; }, broadcast: async () => {} };
  const service = new Payments({ paidRooms: () => [], view: () => {}, load: () => room }, ledger, chain);
  return { service, room, sent, set: (b, o, f, j = []) => { balance=b; obligations=o; fees=f; jobs=j; } };
}

test('empty Mainnet treasury opens self-funded entries only after reconciliation and explicit fee acknowledgement', async () => {
  const f=fixture(), user={id:'a',wallet:{address:'alice'}};
  assert.equal(f.service.status().ready,false);
  await f.service.cycle();
  assert.equal(f.service.status().ready,true);
  assert.equal(f.service.status().feeContributionLuna,1000);
  await assert.rejects(f.service.intent(f.room.code,user),/PAYMENT_NETWORK_CHANGED/);
  await assert.rejects(f.service.intent(f.room.code,user,{feeContributionLuna:1}),/PAYMENT_NETWORK_CHANGED/);
  assert.equal((await f.service.intent(f.room.code,user,{feeContributionLuna:1000})).amountLuna,101000);
  f.room.paymentRulesVersion='nim-v1';
  await assert.rejects(f.service.intent(f.room.code,user),/PAYMENTS_UNAVAILABLE/);
  assert.equal(feeContribution(f.room),0);
});

test('fees held for unfinished rooms cannot finance another payout, and deficits close new entries', async () => {
  const f=fixture(), job={id:'refund',address:'a',amount_luna:100000,status:'queued'};
  f.set(202000,200000,1000,[job]); await f.service.cycle();
  assert.equal(f.service.reserve,0); assert.deepEqual(f.sent,[100000]);
  f.set(201000,200000,1000,[job]); await f.service.cycle();
  assert.equal(f.service.reserve,-1000); assert.equal(f.service.status().ready,false);
  assert.deepEqual(f.sent,[100000]);
  f.set(202000,200000,0,[job]); await f.service.cycle();
  assert.equal(f.service.reserve,1000);
});

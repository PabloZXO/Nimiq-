import test from 'node:test';
import assert from 'node:assert/strict';
import { Address, KeyPair, Transaction } from '@nimiq/core';
import { Store } from '../server/store.mjs';
import { identify } from './helpers/identity.mjs';
import { NimiqChain, loadTestKey } from '../server/testnet.mjs';
import { classifyDeposit, settlementPlan, paymentMemo } from '../server/payment-policy.mjs';
import { Payments } from '../server/payments.mjs';
import { NETWORKS } from '../server/payment-network.mjs';

const address = n => { const a = new Address(new Uint8Array(20).fill(n)); const s = a.toUserFriendlyAddress(); a.free(); return s; };
const settings = { topic: 'chess', difficulty: 'normal', language: 'en', mode: 'friends', capacity: 2, stake: 100000, paymentNetwork: 'mainalbatross' };

test('Mainnet requires explicit current-network selection, preserves it through search/invites/rematch, and isolates legacy rooms', t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const a = identify(store, store.createSession('Alice'), 'main_alice').user;
  const b = identify(store, store.createSession('Bob'), 'main_bob').user;
  const status = { ready: true, network: 'mainalbatross', address: address(3) };
  store.payments = { status: () => status };
  assert.throws(() => store.create(a, { ...settings, paymentNetwork: undefined }), /PAYMENT_NETWORK_CHANGED/);
  assert.throws(() => store.search(a, 'start', { ...settings, paymentNetwork: 'testalbatross' }), /PAYMENT_NETWORK_CHANGED/);
  store.search(a, 'start', settings); const room = store.search(b, 'start', settings).room;
  assert.equal(room.paymentNetwork, 'mainalbatross');
  const deposits = [a,b].map((u,i) => ({ playerId: u.id, address: u.wallet.address, amountLuna: 100000, hash: String(i+1).repeat(64) }));
  store.markFunded(room.code, deposits);
  for (const u of [a,b]) store.action(room.code,u,'ready',{rulesVersion:room.rulesVersion});
  for (const u of [a,b]) store.action(room.code,u,'start',{});
  store.action(room.code,a,'resign',{});
  const plan = settlementPlan(store.load(room.code), deposits);
  assert.equal(plan.networkId,24); assert.equal(plan.rulesVersion,'nim-shared-fees-v2'); assert.equal(plan.totalLuna,200000);
  const next = store.rematch(room.code,a); assert.equal(next.paymentNetwork,'mainalbatross');
  assert.equal(store.rematches(b).requests[0].paymentNetwork,'mainalbatross');
  store.action(next.code,a,'leave',{});
  const inviteRoom = store.create(a,{...settings,invite:b.nickname});
  assert.equal(store.invitations(b).invitations[0].paymentNetwork,'mainalbatross');
  store.action(inviteRoom.code,a,'leave',{});
  status.network='testalbatross';
  assert.throws(()=>store.rematch(room.code,a),/PAYMENT_NETWORK_CHANGED/);
});

test('proofs and settlement cannot cross networks even when address, amount and memo match', () => {
  const intent={network:'mainalbatross',id:'a'.repeat(32),sender:address(1),recipient:address(2),amountLuna:100000,expiresAt:Date.now()+60000};
  const tx={network:'mainalbatross',transactionHash:'b'.repeat(64),state:'confirmed',executionResult:true,blockHeight:50,
    sender:intent.sender,recipient:intent.recipient,senderType:'basic',recipientType:'basic',flags:0,value:100000,
    timestamp:Date.now(),data:{raw:Buffer.from(paymentMemo(intent.id)).toString('hex')}};
  assert.equal(classifyDeposit(tx,intent,64).disposition,'funded');
  assert.throws(()=>classifyDeposit({...tx,network:'testalbatross'},intent,64),/WRONG_PAYMENT_NETWORK/);
  assert.throws(()=>classifyDeposit(tx,{...intent,network:'testalbatross'},64),/WRONG_PAYMENT_NETWORK/);
  assert.throws(()=>settlementPlan({paymentNetwork:'mainalbatross',paymentRulesVersion:'test-nim-v1'},[]),/UNSUPPORTED_PAYMENT_RULES/);
});

test('Mainnet signs only network 24 and refuses broadcasting Testnet bytes (no real broadcast)',async()=>{
  const key=KeyPair.generate(), chain=new NimiqChain(key,'mainalbatross');
  chain.head=async()=>({height:61881530,finalizedHeight:61881504});
  chain.client={getProtocolVersion:async()=>1,disconnectNetwork:async()=>{},sendTransaction:async()=>{throw new Error('Must not broadcast')}};
  try {
    const signed=await chain.sign(address(4),100000), tx=Transaction.fromAny(signed.raw);
    assert.equal(tx.networkId,24); assert.equal(tx.value,100000n); tx.free();
    chain.network=NETWORKS.testalbatross;
    await assert.rejects(chain.broadcast(signed.raw),/WRONG_PAYMENT_NETWORK/);
  }finally{await chain.close()}
  const prior=process.env.PAYMENT_NETWORK;process.env.PAYMENT_NETWORK='mainalbatross';
  try{await assert.rejects(loadTestKey('never-read.key'),/TESTNET_REQUIRED/)}finally{if(prior===undefined)delete process.env.PAYMENT_NETWORK;else process.env.PAYMENT_NETWORK=prior}
});

test('Mainnet worker ignores legacy Testnet rooms and cannot open their payment intents',async()=>{
  const settled=[],legacy={code:'ABCDEF1234',status:'completed',stakeLuna:100000,players:[{id:'a'}]};
  const main={...legacy,code:'ABCDEF1235',paymentNetwork:'mainalbatross'};
  const chain={network:NETWORKS.mainalbatross,address:address(3),synced:true,head:async()=>({height:64,finalizedHeight:64}),
    history:async()=>[],balance:async()=>1000000};
  const ledger={intents:async()=>[],payouts:async()=>[],obligations:async()=>0,settle:async r=>settled.push(r.code)};
  const store={paidRooms:()=>[legacy,main],view:()=>{},load:()=>legacy};
  const worker=new Payments(store,ledger,chain);await worker.cycle();
  assert.deepEqual(settled,[main.code]); assert.equal(worker.status().network,'mainalbatross');
  await assert.rejects(worker.intent(legacy.code,{id:'a'}),/WRONG_PAYMENT_NETWORK/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Address } from '@nimiq/core';
import { Ledger } from '../server/ledger.mjs';
import { paymentMemo } from '../server/payment-policy.mjs';
import { SHARED_FEE_RULES } from '../server/payment-fees.mjs';

// Only run sequentially against this disposable database, never the live ledger.
const url = new URL(process.env.PAYMENT_DATABASE_URL); url.pathname='/nimduel_test_mainnet';
const ledger=new Ledger(url.toString(),'mainalbatross');
const address=n=>{const a=new Address(new Uint8Array(20).fill(n));const s=a.toUserFriendlyAddress();a.free();return s;};
const now=Date.now(); let nextHash=1;
const room=(code,count=2)=>({code,status:'completed',paymentNetwork:'mainalbatross',paymentRulesVersion:SHARED_FEE_RULES,
  stakeLuna:100000,treasuryAddress:address(20),lobbyDeadline:now+60000,winners:['p0'],
  players:Array.from({length:count},(_,i)=>({id:`p${i}`,walletAddress:address(i+1),status:'finished'}))});
const tx=(i,value=i.amountLuna,extra={})=>({transactionHash:(nextHash++).toString(16).padStart(64,'0'),network:'mainalbatross',
  state:'confirmed',executionResult:true,blockHeight:50,timestamp:now,sender:i.sender,recipient:i.recipient,
  senderType:'basic',recipientType:'basic',flags:0,value,fee:0,data:{raw:Buffer.from(paymentMemo(i.id)).toString('hex')},...extra});

test('equal prepaid fees conserve stakes, cover every refund, retain surplus and isolate tiny erroneous deposits',async()=>{
  try {
    await ledger.init();
    await ledger.pool.query('TRUNCATE journal,payouts,settlements,deposits,payment_intents CASCADE');
    const duel=room('ABCDEF1234');
    const [a,b]=await Promise.all(duel.players.map(p=>ledger.intent(duel,p)));
    assert.equal(a.amountLuna,101000);assert.equal(a.feeContributionLuna,1000);
    const first=tx(a);
    await Promise.all([ledger.recordDeposit(first,a,64,false),ledger.recordDeposit(first,a,64,false)]);
    await ledger.recordDeposit(tx(b),b,64,false);
    assert.deepEqual((await ledger.funded(duel.code)).map(d=>d.amountLuna),[100000,100000]);
    assert.equal(await ledger.obligations(),200000);assert.equal(await ledger.pendingRoomFees(),2000);
    const prize=await ledger.settle(duel);
    assert.equal(prize.transfers[0].amountLuna,200000);assert.equal(await ledger.pendingRoomFees(),0);
    assert.equal((await ledger.settle(duel)).decisionHash,prize.decisionHash);
    const refundRoom=room('ABCDEF1235',8); refundRoom.status='cancelled';
    for(const p of refundRoom.players){const i=await ledger.intent(refundRoom,p);await ledger.recordDeposit(tx(i),i,64,false);}
    assert.equal(await ledger.pendingRoomFees(),8000);
    assert.deepEqual((await ledger.settle(refundRoom)).transfers.map(t=>t.amountLuna),Array(8).fill(100000));
    assert.equal(await ledger.pendingRoomFees(),0);
    const tieRoom=room('ABCDEF1236',3);tieRoom.winners=['p0','p1','p2'];
    for(const p of tieRoom.players){const i=await ledger.intent(tieRoom,p);await ledger.recordDeposit(tx(i),i,64,false);}
    assert.deepEqual((await ledger.settle(tieRoom)).transfers.map(t=>t.amountLuna),[100000,100000,100000]);
    const partial=room('ABCDEF1237');partial.status='void';partial.reason='SERVER_INTERRUPTION';
    const partialIntent=await ledger.intent(partial,partial.players[0]);await ledger.recordDeposit(tx(partialIntent),partialIntent,64,false);
    assert.equal((await ledger.settle(partial)).transfers[0].amountLuna,100000);
    // Every additional transfer finances its own return, including wrong senders.
    for(const [value,expected] of [[101000,100000],[50000,49000],[202000,201000]]){
      const proof=tx(a,value);await ledger.recordDeposit(proof,a,64,true);
      assert.equal(Number((await ledger.payouts()).find(p=>p.id===`deposit:${proof.transactionHash}`).amount_luna),expected);
    }
    const wrong=tx(a,101000,{sender:address(10)});await ledger.recordDeposit(wrong,a,64,false);
    assert.equal((await ledger.payouts()).find(p=>p.id===`deposit:${wrong.transactionHash}`).address,address(10));
    const beforeDust=await ledger.obligations(),jobsBefore=(await ledger.payouts()).length;
    for(const value of [1,1000])await ledger.recordDeposit(tx(a,value),a,64,true);
    assert.equal(await ledger.obligations(),beforeDust+1001);assert.equal((await ledger.payouts()).length,jobsBefore);
    assert.equal((await ledger.view(duel.code,'p0')).payouts.filter(p=>p.status==='below_fee').length,2);
    // Fee income less outgoing fees stays positive without any operator top-up.
    const contributed=Number((await ledger.pool.query("SELECT -sum((e->>'luna')::bigint) AS n FROM journal,jsonb_array_elements(entries)e WHERE e->>'account'='reserve:contributions'")).rows[0].n);
    const jobs=await ledger.payouts();assert.ok(contributed>=jobs.length*1000);
    for(const [n,p] of jobs.entries()){
      const signed=await ledger.signed(p.id,{hash:(100+n).toString(16).padStart(64,'0'),raw:'test-only',fee:1000,validUntil:100});
      await ledger.confirm(signed,{network:'mainalbatross',state:'confirmed',executionResult:true,blockHeight:70,
        transactionHash:signed.tx_hash,recipient:p.address,value:Number(p.amount_luna),fee:1000},96);
    }
    assert.equal(await ledger.obligations(),1001); // tiny deposits are still owed, never revenue
    const entries=(await ledger.pool.query('SELECT entries FROM journal')).rows.flatMap(r=>r.entries);
    assert.equal(entries.reduce((sum,e)=>sum+e.luna,0),0);
    const assets=entries.filter(e=>e.account==='asset:mainnet').reduce((sum,e)=>sum+e.luna,0);
    assert.equal(assets,1001+contributed-jobs.length*1000);
    assert.equal(assets-1001,1000); // one unused duel payout fee retained in reserve
  }finally{await ledger.close();}
});

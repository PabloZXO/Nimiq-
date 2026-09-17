import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Address, TransactionBuilder } from '@nimiq/core';
import { Testnet, loadTestKey } from '../server/testnet.mjs';
import { messageDigest } from '../server/wallet-auth.mjs';

// Uses only separately generated test actors. Never signs for a real user's wallet.
assert.equal(process.argv[2], '--run-testnet'); assert.equal(process.env.PAYMENT_NETWORK, 'testalbatross');
const base = 'http://nimduel-api:8787/api', origin = process.env.PUBLIC_ORIGIN;
const runId = randomBytes(6).toString('hex'), dir = `/app/data/live-test-${runId}`;
await mkdir(dir, { mode: 0o700 });
const timeout = setTimeout(() => { console.error('Live test timed out; retain test records for inspection'); process.exit(1); }, 600000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(label, fn) {
  for (let i = 0; i < 70; i++) { const result = await fn(); if (result) { console.log(label); return result; } await pause(4000); }
  throw new Error(`${label}: timed out`);
}
const actors = [];
for (const name of ['A', 'B']) {
  const key = await loadTestKey(`${dir}/${name}.key`, true), addr = key.toAddress();
  const actor = { name, key, address: addr.toUserFriendlyAddress(), cookie: '' }; addr.free();
  actor.api = async (path, input) => {
    const response = await fetch(base + path, { method: input === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, Cookie: actor.cookie, ...(input === undefined ? {} : { 'Content-Type': 'application/json', 'X-Nimduel-Client': '1' }) },
      body: input === undefined ? undefined : JSON.stringify(input), signal: AbortSignal.timeout(15000) });
    const cookie = response.headers.get('set-cookie'); if (cookie) actor.cookie = cookie.split(';')[0];
    const result = await response.json(); if (!response.ok) throw new Error(`${path}: ${result.error}`); return result;
  };
  await actor.api('/session', { name: `Test ${name} ${runId}` });
  const challenge = await actor.api('/wallet/challenge', { address: actor.address, language: 'en' });
  assert.equal(challenge.origin, origin);
  const signature = key.sign(messageDigest(challenge.message)), pub = key.publicKey;
  const verified = await actor.api('/wallet/verify', { challengeId: challenge.id, publicKey: pub.toHex(), signature: signature.toHex() });
  signature.free(); pub.free(); actor.id = verified.user.id;
  const faucet = await fetch('https://faucet.pos.nimiq-testnet.com/tapit', { method: 'POST', body: new URLSearchParams({ address: actor.address, amount: '100' }), signal: AbortSignal.timeout(30000) });
  assert.equal((await faucet.json()).success, true); actors.push(actor);
}
console.log('Two test actors authenticated and funded by test faucet');
const [a, b] = actors, chain = new Testnet(a.key);
try {
  await chain.connect();
  await until('Treasury ready', async () => (await a.api('/payments')).ready);
  await until('Test balances available', async () => (await chain.client.getAccount(a.address)).balance >= 1000000 && (await chain.client.getAccount(b.address)).balance >= 1000000);
  async function deposit(actor, room) {
    const intent = await actor.api(`/rooms/${room.code}/payment`, {});
    const head = await chain.head(), sender = Address.fromString(actor.address), recipient = Address.fromString(intent.recipient);
    const tx = TransactionBuilder.newBasicWithData(sender, recipient, Buffer.from(intent.memo), BigInt(intent.amountLuna), 1000n, head.height, 5);
    try {
      actor.key.signTransaction(tx); tx.verify(await chain.client.getProtocolVersion(), 5);
      await writeFile(`${dir}/${room.code}-${actor.name}.json`, JSON.stringify({ roomCode: room.code, hash: tx.hash(), raw: tx.toHex() }), { mode: 0o600, flag: 'wx' });
      await chain.broadcast(tx.toHex()); console.log(`Test entry sent: ${room.code} ${actor.name}`);
    } finally { tx.free(); sender.free(); recipient.free(); }
  }
  const create = () => a.api('/rooms', { topic: 'math', difficulty: 'normal', language: 'en', mode: 'friends', capacity: 2, stake: 100000 });
  const room = await create(); await b.api(`/rooms/${room.code}/join`, {});
  await deposit(a, room); await deposit(b, room);
  const funded = await until('Both entries independently confirmed', async () => { const r = await a.api(`/rooms/${room.code}`); return r.players.every(p => p.funded) && r; });
  await a.api(`/rooms/${room.code}/ready`, { rulesVersion: funded.rulesVersion });
  await b.api(`/rooms/${room.code}/ready`, { rulesVersion: funded.rulesVersion });
  const started = await a.api(`/rooms/${room.code}/start`, {}); await b.api(`/rooms/${room.code}/start`, {});
  const expression = /^(\d+)\s*([+−\-×÷])\s*(\d+)$/.exec(started.question.prompt); assert.ok(expression, 'known arithmetic template');
  const x = Number(expression[1]), y = Number(expression[3]);
  const answer = expression[2] === '+' ? x + y : ['−','-'].includes(expression[2]) ? x - y : expression[2] === '×' ? x * y : x / y;
  await a.api(`/rooms/${room.code}/answer`, { questionId: started.question.id, value: String(answer), requestId: randomBytes(16).toString('hex') });
  await a.api(`/rooms/${room.code}/finish`, {}); const result = await b.api(`/rooms/${room.code}/finish`, {});
  assert.deepEqual(result.winners, [a.id]);
  const prize = await until('Full 2 NIM prize confirmed on Testnet', async () => (await a.api(`/rooms/${room.code}/payment`)).payouts.find(p => p.kind === 'prize' && p.status === 'confirmed'));
  assert.equal(prize.amountLuna, 200000);
  const cancelled = await create(); await b.api(`/rooms/${cancelled.code}/join`, {}); await deposit(a, cancelled);
  await until('Single entry confirmed before cancellation', async () => (await a.api(`/rooms/${cancelled.code}`)).players.find(p => p.id === a.id).funded);
  await b.api(`/rooms/${cancelled.code}/leave`, {});
  const refund = await until('Cancelled room refund confirmed on Testnet', async () => (await a.api(`/rooms/${cancelled.code}/payment`)).payouts.find(p => p.kind === 'refund' && p.status === 'confirmed'));
  assert.equal(refund.amountLuna, 100000);
  console.log(JSON.stringify({ success: true, runId, winnerRoom: room.code, prizeHash: prize.hash, cancelledRoom: cancelled.code, refundHash: refund.hash }));
} finally { clearTimeout(timeout); await chain.close(); b.key.free(); }
process.exit(0);

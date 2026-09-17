import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { PublicKey } from '@nimiq/core';
import { Store } from '../server/store.mjs';
import { verifyWalletSignature, CHALLENGE_TTL_MS, WALLET_SESSION_TTL_MS } from '../server/wallet-auth.mjs';
import { makeServer } from '../server/index.mjs';
import { request as httpRequest } from 'node:http';

// Independent Node Ed25519 signing; no production keys or externally funded accounts.
function signer() {
  const pair = generateKeyPairSync('ed25519');
  const rawPublic = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const publicKey = rawPublic.toString('hex');
  const key = PublicKey.fromHex(publicKey); const derived = key.toAddress();
  const address = derived.toUserFriendlyAddress(); derived.free(); key.free();
  return { address, sign(message, withPrefix = true, byteLength = true) {
    const encoded = Buffer.from(message, 'utf8');
    const payload = Buffer.concat([Buffer.from('\x16Nimiq Signed Message:\n'), Buffer.from(String(byteLength ? encoded.length : message.length)), encoded]);
    const hash = createHash('sha256').update(payload).digest();
    return { publicKey, signature: sign(null, withPrefix ? hash : encoded, pair.privateKey).toString('hex') };
  } };
}
const origin = 'http://localhost:5173';
function fixture() {
  let now = 100000;
  const store = new Store(':memory:', () => now);
  const guest = store.createSession('Аліса'); const wallet = signer();
  function challenge(session = guest, signingWallet = wallet, lang = 'uk', site = origin) {
    return store.walletChallenge(session.user, session.token, site, { address: signingWallet.address, language: lang });
  }
  function verify(request, session = guest, signingWallet = wallet, site = origin) {
    return store.verifyWallet(session.user, session.token, site, { challengeId: request.id, ...signingWallet.sign(request.message) });
  }
  return { store, guest, wallet, challenge, verify, advance(ms) { now += ms; } };
}

test('valid UTF-8 signature verifies, rotates cookie, and preserves guest identity/history', () => {
  const f = fixture();
  try {
    const r = f.store.create(f.guest.user, { topic: 'math', difficulty: 'normal', language: 'uk', mode: 'practice' });
    f.advance(1); f.store.action(r.code, f.guest.user, 'finish', {});
    const q = f.challenge(); const session = f.verify(q);
    assert.equal(session.user.id, f.guest.user.id);
    assert.equal(session.user.wallet.address, f.wallet.address);
    assert.notEqual(session.token, f.guest.token);
    assert.equal(f.store.session(f.guest.token), null);
    assert.equal(f.store.session(session.token).wallet.address, f.wallet.address);
    assert.equal(f.store.history(session.user.id)[0].code, r.code);
  } finally { f.store.close(); }
});
test('raw signatures and JavaScript character-length prefixes are rejected', () => {
  const wallet = signer(); const message = 'Увійти в NimDuel 👋';
  assert.equal(verifyWalletSignature(message, wallet.address, wallet.sign(message)), wallet.address);
  assert.throws(() => verifyWalletSignature(message, wallet.address, wallet.sign(message, false)), /INVALID_SIGNATURE/);
  assert.throws(() => verifyWalletSignature(message, wallet.address, wallet.sign(message, true, false)), /INVALID_SIGNATURE/);
  assert.throws(() => verifyWalletSignature(message + '.', wallet.address, wallet.sign(message)), /INVALID_SIGNATURE/);
});
test('a signature from a different address cannot claim the selected wallet', () => {
  const f = fixture();
  try {
    const q = f.challenge();
    assert.throws(() => f.verify(q, f.guest, signer()), /WALLET_ADDRESS_MISMATCH/);
    assert.throws(() => f.verify(q), /CHALLENGE_EXPIRED/);
    assert.equal(f.store.session(f.guest.token).wallet, undefined);
  } finally { f.store.close(); }
});
test('nonces are bound to session and origin, expire at the boundary, and invalidate older challenges', () => {
  const f = fixture();
  try {
    const first = f.challenge(); const other = f.store.createSession('Other');
    assert.throws(() => f.verify(first, other), /CHALLENGE_EXPIRED/);
    assert.throws(() => f.verify(first, f.guest, f.wallet, 'https://wrong.invalid'), /CHALLENGE_ORIGIN_MISMATCH/);
    const second = f.challenge(); assert.notEqual(first.id, second.id);
    assert.throws(() => f.verify(first), /CHALLENGE_EXPIRED/);
    f.advance(CHALLENGE_TTL_MS);
    assert.throws(() => f.verify(second), /CHALLENGE_EXPIRED/);
  } finally { f.store.close(); }
});
test('consumed successful proof cannot be replayed', () => {
  const f = fixture();
  try {
    const q = f.challenge(); f.verify(q);
    assert.throws(() => f.verify(q), /CHALLENGE_EXPIRED/);
  } finally { f.store.close(); }
});
test('signing again on a new device restores one wallet profile and revokes the prior device', () => {
  const f = fixture();
  try {
    const a = f.verify(f.challenge());
    const guestB = f.store.createSession('Богдан');
    const b = f.verify(f.challenge(guestB), guestB);
    assert.equal(a.user.id, b.user.id); assert.equal(b.user.name, 'Аліса');
    assert.equal(f.store.session(a.token), null); assert.equal(f.store.session(guestB.token), null);
    assert.equal(f.store.session(b.token).id, a.user.id);
    f.advance(WALLET_SESSION_TTL_MS); assert.equal(f.store.session(b.token), null);
  } finally { f.store.close(); }
});
test('a fresh wallet proof recovers an active game without changing it and revokes the lost session', () => {
  const f = fixture();
  try {
    const current = f.verify(f.challenge());
    const room = f.store.create(current.user, { topic: 'math', difficulty: 'normal', language: 'uk', mode: 'practice' });
    f.store.claimNickname(current.user, 'recover_me');
    const before = f.store.load(room.code);
    const guestB = f.store.createSession('Other');
    const invalid = f.challenge(guestB);
    assert.throws(() => f.verify(invalid, guestB, signer()), /WALLET_ADDRESS_MISMATCH/);
    assert.ok(f.store.session(current.token), 'invalid signatures cannot kick the existing session out');
    f.advance(5000);
    const recovered = f.verify(f.challenge(guestB), guestB);
    assert.equal(recovered.user.id, current.user.id);
    assert.equal(recovered.user.nickname, 'recover_me');
    assert.equal(f.store.session(current.token), null);
    assert.equal(f.store.session(guestB.token), null);
    assert.deepEqual(f.store.load(room.code), before, 'no reset of questions, score, status or deadlines');
    assert.equal(f.store.view(room.code, recovered.user.id).me.id, current.user.id);
    assert.throws(() => f.store.logout(recovered.user, recovered.token), /ACTIVE_ROOM_EXISTS/);
  } finally { f.store.close(); }
});

test('recovering a paid lobby preserves the funded seat and does not require another deposit', () => {
  const f = fixture();
  try {
    const current = f.verify(f.challenge());
    f.store.payments = { status: () => ({ ready: true, network: 'testalbatross', address: signer().address }) };
    const room = f.store.create(current.user, { topic: 'math', difficulty: 'normal', language: 'uk', mode: 'friends', capacity: 2, stake: 100000 });
    f.store.markFunded(room.code, [{ playerId: current.user.id, address: current.user.wallet.address, amountLuna: 100000, hash: 'a'.repeat(64) }]);
    const before = f.store.load(room.code);
    const fresh = f.store.createSession('Returning');
    const recovered = f.verify(f.challenge(fresh), fresh);
    assert.deepEqual(f.store.load(room.code), before);
    assert.equal(f.store.view(room.code, recovered.user.id).players[0].funded, true);
    assert.equal(f.store.session(current.token), null);
  } finally { f.store.close(); }
});
test('logout revokes authentication and changing wallets needs explicit logout', () => {
  const f = fixture();
  try {
    const current = f.verify(f.challenge());
    assert.throws(() => f.challenge(current, signer()), /WALLET_SWITCH_REQUIRES_LOGOUT/);
    f.store.logout(current.user, current.token); assert.equal(f.store.session(current.token), null);
    const fresh = f.store.createSession('Other');
    const restored = f.verify(f.challenge(fresh), fresh); assert.equal(restored.user.id, current.user.id);
  } finally { f.store.close(); }
});
test('malformed proofs are rejected and challenge issuance is bounded', () => {
  const f = fixture();
  try {
    const q = f.challenge();
    assert.throws(() => f.store.verifyWallet(f.guest.user, f.guest.token, origin, { challengeId: q.id, publicKey: 'a', signature: 'b' }), /INVALID_SIGNATURE/);
    assert.throws(() => f.verify(q), /CHALLENGE_EXPIRED/);
    for (let i = 1; i < 10; i++) f.challenge();
    assert.throws(() => f.challenge(), /WALLET_RATE_LIMIT/);
  } finally { f.store.close(); }
});
test('HTTP login returns only the rotated HttpOnly cookie, respects CSRF, and persists verified user', async t => {
  const store = new Store(':memory:'); const server = makeServer({ store, secureCookies: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  let cookie = ''; const wallet = signer();
  async function post(path, body, suppliedOrigin = site) {
    return fetch(site + '/api' + path, { method: 'POST', headers: { Cookie: cookie, Origin: suppliedOrigin, 'X-Nimduel-Client': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  const guest = await post('/session', { name: 'Wallet test' }); cookie = guest.headers.get('set-cookie').split(';')[0];
  const challenge = await (await post('/wallet/challenge', { address: wallet.address, language: 'uk' })).json();
  assert.equal(challenge.origin, site);
  const payload = { challengeId: challenge.id, ...wallet.sign(challenge.message) };
  assert.equal((await post('/wallet/verify', payload, 'https://evil.invalid')).status, 403);
  const verified = await post('/wallet/verify', payload); assert.equal(verified.status, 200);
  const body = await verified.json(); assert.equal(body.user.wallet.address, wallet.address); assert.equal(body.token, undefined);
  assert.match(verified.headers.get('set-cookie'), /HttpOnly/);
  assert.match(verified.headers.get('set-cookie'), /Max-Age=86400/);
  const expires = /Expires=([^;]+)/.exec(verified.headers.get('set-cookie'))[1];
  assert.ok(Math.abs(Date.parse(expires) - Date.now() - WALLET_SESSION_TTL_MS) < 5000);
  assert.equal((await post('/wallet/verify', payload)).status, 401);
  cookie = verified.headers.get('set-cookie').split(';')[0];
  const restored = await fetch(site + '/api/session', { headers: { Cookie: cookie } });
  assert.equal((await restored.json()).user.wallet.address, wallet.address);
  const slowBody = JSON.stringify({ topic: 'math', difficulty: 'normal', mode: 'practice', language: 'uk' });
  let slowRequest;
  const slowResult = new Promise((resolve, reject) => {
    slowRequest = httpRequest(site + '/api/rooms', { method: 'POST', headers: {
      Cookie: cookie, Origin: site, 'X-Nimduel-Client': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(slowBody),
    } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    slowRequest.on('error', reject); slowRequest.write(slowBody.slice(0, 1));
  });
  const loggedOut = await post('/logout', {});
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  slowRequest.end(slowBody.slice(1));
  assert.equal(await slowResult, 401, 'a request whose body finishes after logout must not use stale authentication');
  assert.equal((await post('/wallet/challenge', { address: wallet.address, language: 'uk' })).status, 401);
});

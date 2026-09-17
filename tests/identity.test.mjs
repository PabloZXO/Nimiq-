import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicKey } from '@nimiq/core';
import { Store } from '../server/store.mjs';
import { makeServer } from '../server/index.mjs';
import { messageDigest } from '../server/wallet-auth.mjs';

const origin = 'http://localhost:5173';
const settings = { topic: 'math', difficulty: 'normal', language: 'en', mode: 'friends', capacity: 2 };
function signer() {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  const pub = PublicKey.fromHex(publicKey), addr = pub.toAddress();
  const address = addr.toUserFriendlyAddress(); addr.free(); pub.free();
  return { address, proof: message => ({ publicKey, signature: sign(null, messageDigest(message), pair.privateKey).toString('hex') }) };
}
function fixture(t, path = ':memory:') {
  let now = 100000; const store = new Store(path, () => now);
  t.after(() => store.close());
  function login(wallet, session = store.createSession('Guest')) {
    const challenge = store.walletChallenge(session.user, session.token, origin, { address: wallet.address, language: 'en' });
    return store.verifyWallet(session.user, session.token, origin, { challengeId: challenge.id, ...wallet.proof(challenge.message) });
  }
  function account(nickname) {
    const wallet = signer(), session = login(wallet);
    const user = nickname ? store.claimNickname(session.user, nickname) : session.user;
    return { wallet, user, token: session.token };
  }
  return { store, login, account, later: ms => { now += ms; } };
}
test('wallet proof is required to register an immutable, case-insensitive nickname; display-name updates cannot overwrite it', t => {
  const { store, account } = fixture(t); const guest = store.createSession('Old name');
  assert.throws(() => store.claimNickname(guest.user, 'alice'), /VERIFIED_WALLET_REQUIRED/);
  const a = account(); const b = account();
  const user = store.claimNickname(a.user, '@Alice_7');
  assert.equal(user.nickname, 'alice_7'); assert.equal(user.name, '@alice_7');
  assert.equal(store.session(a.token).nickname, 'alice_7');
  assert.equal(store.claimNickname(user, 'ALICE_7').nickname, 'alice_7');
  assert.throws(() => store.claimNickname(b.user, 'Alice_7'), /NICKNAME_TAKEN/);
  assert.throws(() => store.claimNickname(user, 'new_name'), /NICKNAME_LOCKED/);
  assert.equal(store.rename(user, 'Impersonator').name, '@alice_7');
  for (const value of ['x', '9name', 'long'.repeat(6), '__proto__', 'A l i c e', '<img>', 'Р°lice', '\u202Ename']) assert.throws(() => store.claimNickname(b.user, value), /INVALID_NICKNAME/);
  assert.throws(() => store.claimNickname(b.user, 'admin'), /NICKNAME_RESERVED/);
});

test('saved friends are private, idempotent and restored with the wallet identity; removing does not affect other lists', t => {
  const { store, login, account } = fixture(t);
  const a = account('alice'), b = account('bob'), c = account('carol');
  assert.deepEqual(store.changeFriend(a.user, '@BOB', 'add'), { friends: [{ nickname: 'bob', status: 'offline' }] });
  assert.deepEqual(store.changeFriend(a.user, 'bob', 'add'), { friends: [{ nickname: 'bob', status: 'offline' }] });
  assert.deepEqual(store.friends(b.user), { friends: [] });
  store.changeFriend(c.user, 'bob', 'add');
  const restored = login(a.wallet);
  assert.deepEqual(store.friends(restored.user), { friends: [{ nickname: 'bob', status: 'offline' }] });
  assert.equal(store.session(a.token), null);
  const room = store.create(restored.user, { ...settings, invite: store.friends(restored.user).friends[0].nickname });
  assert.equal(store.invitations(b.user).invitations[0].from, 'alice');
  store.changeFriend(restored.user, 'bob', 'remove');
  assert.deepEqual(store.changeFriend(restored.user, 'bob', 'remove'), { friends: [] });
  assert.deepEqual(store.friends(c.user), { friends: [{ nickname: 'bob', status: 'offline' }] });
  assert.equal(store.invitations(b.user).invitations[0].status, 'pending');
  assert.equal(store.view(room.code, restored.user.id).invitedNickname, 'bob');
});

test('friends persist in SQLite and remain available to a new store connection', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'nimduel-friends-'));
  try {
    await t.test('save and reopen', child => {
      const path = join(directory, 'test.sqlite');
      const { store, account } = fixture(child, path);
      const a = account('alice'), b = account('bob');
      store.changeFriend(a.user, b.user.nickname, 'add');
      const reopened = new Store(path, () => 100000);
      try { assert.deepEqual(reopened.friends(reopened.session(a.token)), { friends: [{ nickname: 'bob', status: 'offline' }] }); }
      finally { reopened.close(); }
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('friends require a verified identity, reject invalid targets and enforce a bounded list without blocking removal', t => {
  const { store, account } = fixture(t);
  const a = account('alice'), guest = store.createSession('Guest').user;
  assert.throws(() => store.friends(guest), /NICKNAME_REQUIRED/);
  assert.throws(() => store.changeFriend(guest, 'alice', 'add'), /NICKNAME_REQUIRED/);
  assert.throws(() => store.friends({ ...a.user, wallet: undefined }), /NICKNAME_REQUIRED/);
  assert.throws(() => store.changeFriend(a.user, '@ALICE', 'add'), /FRIEND_SELF/);
  assert.throws(() => store.changeFriend(a.user, 'missing', 'add'), /PLAYER_NOT_FOUND/);
  assert.throws(() => store.changeFriend(a.user, '<script>', 'add'), /INVALID_NICKNAME/);
  assert.throws(() => store.changeFriend(a.user, 'alice', 'unknown'), /INVALID_FRIEND_ACTION/);
  for (let i = 0; i < 201; i++) {
    const id = `friend-${i}`, nickname = `player_${String(i).padStart(3, '0')}`;
    store.db.prepare('INSERT INTO wallet_accounts VALUES (?, ?, ?, ?)').run(`test-address-${i}`, id, nickname, 1);
    store.db.prepare('INSERT INTO nicknames VALUES (?, ?, ?)').run(id, nickname, 1);
    if (i < 200) store.changeFriend(a.user, nickname, 'add');
  }
  assert.equal(store.changeFriend(a.user, 'player_000', 'add').friends.length, 200);
  assert.throws(() => store.changeFriend(a.user, 'player_200', 'add'), /FRIEND_LIMIT/);
  assert.equal(store.changeFriend(a.user, 'player_000', 'remove').friends.length, 199);
  const result = store.changeFriend(a.user, 'player_200', 'add');
  assert.equal(result.friends.length, 200);
  assert.deepEqual(result.friends[0], { nickname: 'player_001', status: 'offline' });
});

test('friends HTTP endpoints enforce session ownership and CSRF; client-supplied owner IDs cannot access another list', async t => {
  const { store, account } = fixture(t);
  const a = account('alice'), b = account('bob'), c = account('carol');
  const server = makeServer({ store, secureCookies: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (session, body, site = base) => fetch(base + '/api/friends', {
    method: body ? 'POST' : 'GET', headers: { Cookie: `nimduel_session=${session.token}`, Origin: site, 'X-Nimduel-Client': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal((await fetch(base + '/api/friends')).status, 401);
  assert.equal((await call(store.createSession('Guest'))).status, 403);
  assert.equal((await call(a, { nickname: 'bob', action: 'add' }, 'https://evil.invalid')).status, 403);
  assert.equal((await call(a, { nickname: 'bob', action: 'add' })).status, 200);
  await call(c, { nickname: 'bob', action: 'remove', userId: a.user.id });
  assert.deepEqual(await (await call(c)).json(), { friends: [] });
  assert.deepEqual(await (await call(a)).json(), { friends: [{ nickname: 'bob', status: 'offline' }] });
  assert.deepEqual(await (await call(b)).json(), { friends: [] });
  const missingHeader = await fetch(base + '/api/friends', { method: 'POST', headers: { Cookie: `nimduel_session=${a.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'bob', action: 'remove' }) });
  assert.equal(missingHeader.status, 403);
});

test('friend presence expires, derives playing from server state, and is revoked by logout or wallet recovery', t => {
  const { store, account, login, later } = fixture(t);
  const a = account('alice'), b = account('bob');
  store.changeFriend(a.user, 'bob', 'add');
  const status = () => store.friends(a.user).friends[0].status;
  assert.equal(status(), 'offline');
  store.heartbeatPresence(b.user, b.token);
  assert.equal(status(), 'online');
  const lobby = store.create(b.user, settings);
  assert.equal(status(), 'online'); // Waiting in a lobby is not playing a round.
  store.action(lobby.code, b.user, 'leave', {});
  const practice = store.create(b.user, { ...settings, mode: 'practice' });
  assert.equal(status(), 'playing');
  later(44999); assert.equal(status(), 'playing');
  later(1); assert.equal(status(), 'offline');
  store.heartbeatPresence(b.user, b.token); assert.equal(status(), 'playing');
  store.action(practice.code, b.user, 'finish', {}); assert.equal(status(), 'online');
  const recovered = login(b.wallet);
  assert.equal(status(), 'offline');
  assert.throws(() => store.heartbeatPresence(b.user, b.token), /SESSION_REQUIRED/);
  store.heartbeatPresence(recovered.user, recovered.token); assert.equal(status(), 'online');
  store.logout(recovered.user, recovered.token); assert.equal(status(), 'offline');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM presence').get().n, 0);
});

test('presence cannot be spoofed, requires a verified session and never reveals timestamps, room IDs or wallets', async t => {
  const { store, account, later } = fixture(t);
  const a = account('alice'), b = account('bob'), guest = store.createSession('Guest');
  store.changeFriend(a.user, 'bob', 'add');
  const server = makeServer({ store, secureCookies: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const beat = (session, body = {}, origin = base) => fetch(base + '/api/presence', {
    method: 'POST', headers: { Cookie: `nimduel_session=${session.token}`, Origin: origin, 'X-Nimduel-Client': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await beat({ token: '' })).status, 401);
  assert.equal((await beat(guest)).status, 403);
  assert.equal((await beat(b, {}, 'https://evil.invalid')).status, 403);
  assert.equal((await beat(a, { userId: b.user.id, status: 'playing' })).status, 200);
  assert.deepEqual(store.friends(a.user), { friends: [{ nickname: 'bob', status: 'offline' }] });
  assert.equal((await beat(b, { status: 'playing' })).status, 200);
  assert.deepEqual(store.friends(a.user), { friends: [{ nickname: 'bob', status: 'online' }] });
  later(-1); assert.equal(store.friends(a.user).friends[0].status, 'offline'); // Future timestamps are not live.
  later(1);
  store.db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run(100000, b.user.id);
  assert.equal(store.friends(a.user).friends[0].status, 'offline');
  assert.equal((await beat(b)).status, 401);
  assert.deepEqual(store.lookupPlayer(a.user, 'bob'), { player: { nickname: 'bob' } });
});
test('wallet recovery restores nickname and prior guest history, rotates sessions, and preserves another wallet identity', t => {
  const { store, login, account } = fixture(t);
  const guest = store.createSession('Existing player');
  const room = store.create(guest.user, { ...settings, mode: 'practice' }); store.action(room.code, guest.user, 'finish', {});
  const wallet = signer(), signed = login(wallet, guest), claimed = store.claimNickname(signed.user, 'recover_me');
  const restored = login(wallet);
  assert.equal(restored.user.id, claimed.id); assert.equal(restored.user.nickname, 'recover_me');
  assert.equal(store.history(restored.user.id)[0].code, room.code); assert.equal(store.session(signed.token), null);
  const b = account('other_wallet');
  assert.throws(() => store.claimNickname(b.user, 'recover_me'), /NICKNAME_LOCKED/);
  assert.equal(store.lookupPlayer(restored.user, '@RECOVER_ME').player.nickname, 'recover_me');
  assert.deepEqual(Object.keys(store.lookupPlayer(restored.user, 'other_wallet').player), ['nickname']);
});
test('mandatory registration preserves legacy room and search snapshots; guests cannot query the directory', t => {
  const { store, account } = fixture(t); const a = account(), b = account();
  const room = store.create(a.user, { ...settings, mode: 'practice' });
  const oldName = room.players[0].name;
  const claimed = store.claimNickname(a.user, 'active_name');
  assert.equal(store.view(room.code, claimed.id).players[0].name, oldName);
  store.action(room.code, claimed, 'finish', {});
  const queue = store.search(b.user, 'start', settings);
  const searching = store.claimNickname(b.user, 'search_name');
  assert.equal(store.search(searching, 'view').ticket, queue.ticket);
  store.search(searching, 'cancel', { ticket: queue.ticket });
  assert.throws(() => store.lookupPlayer(store.createSession('Guest').user, 'active_name'), /NICKNAME_REQUIRED/);
  assert.throws(() => store.claimNickname(claimed, 'another_name'), /NICKNAME_LOCKED/);
  assert.equal(store.create(claimed, { ...settings, mode: 'practice' }).players[0].nickname, 'active_name');
});

test('invitations reserve a free duel for the named recipient, hide addresses and require explicit acceptance', t => {
  const { store, account } = fixture(t); const a = account('alice'), b = account('bob'), c = account('carol');
  const r = store.create(a.user, { ...settings, invite: '@BOB' });
  assert.equal(r.players.length, 1); assert.equal(r.invitedNickname, 'bob');
  const inbox = store.invitations(b.user).invitations[0];
  assert.equal(inbox.from, 'alice'); assert.equal(inbox.roomCode, undefined);
  assert.equal(JSON.stringify(inbox).includes(a.wallet.address), false);
  assert.equal(JSON.stringify(inbox).includes(b.wallet.address), false);
  assert.equal(store.invitations(c.user).invitations.length, 0);
  assert.throws(() => store.action(r.code, c.user, 'join', {}), /INVITE_FORBIDDEN/);
  assert.throws(() => store.invitation(c.user, inbox.id, 'accept'), /INVITE_NOT_FOUND/);
  assert.throws(() => store.invitation(a.user, inbox.id, 'accept'), /INVITE_FORBIDDEN/);
  const accepted = store.invitation(b.user, inbox.id, 'accept').room;
  assert.equal(accepted.code, r.code); assert.equal(accepted.players.length, 2);
  assert.ok(accepted.players.every(p => !p.ready && p.nickname));
  assert.equal(store.invitation(b.user, inbox.id, 'accept').room.code, r.code);
  assert.throws(() => store.invitation(a.user, inbox.id, 'cancel'), /INVITE_CLOSED/);
  store.action(r.code, b.user, 'leave', {});
  assert.equal(store.view(r.code, a.user.id).status, 'cancelled');
});
test('declining, cancelling and expiry release the sender; invalid invitations roll back room creation', t => {
  const { store, account, later } = fixture(t); const a = account('alice'), b = account('bob');
  for (const [extra, code] of [[{ invite: 'missing' }, 'PLAYER_NOT_FOUND'], [{ invite: 'alice' }, 'INVITE_SELF'], [{ invite: 'bob', capacity: 3 }, 'INVITE_DUEL_ONLY'], [{ invite: 'bob', mode: 'practice' }, 'INVITE_DUEL_ONLY']]) {
    assert.throws(() => store.create(a.user, { ...settings, ...extra }), new RegExp(code));
    assert.equal(store.history(a.user.id).length, 0);
  }
  for (const action of ['decline', 'cancel', 'expire']) {
    const r = store.create(a.user, { ...settings, invite: 'bob' });
    const row = store.invitations(b.user).invitations.find(i => i.status === 'pending');
    if (action === 'expire') { later(600000); store.tick(); }
    else store.invitation(action === 'cancel' ? a.user : b.user, row.id, action);
    assert.equal(store.view(r.code, a.user.id).status, 'cancelled');
    assert.throws(() => store.invitation(b.user, row.id, 'accept'), /INVITE_CLOSED/);
    assert.ok(!store.hasActiveRoom(a.user.id)); later(1);
  }
});
test('busy recipients keep their current game; direct recipient join consumes the invitation; matchmaking retains verified nicknames', t => {
  const { store, account } = fixture(t); const a = account('alice'), b = account('bob');
  const busy = store.create(b.user, { ...settings, mode: 'practice' });
  const invited = store.create(a.user, { ...settings, invite: 'bob' });
  const row = store.invitations(b.user).invitations[0];
  assert.throws(() => store.invitation(b.user, row.id, 'accept'), /ACTIVE_ROOM_EXISTS/);
  assert.equal(store.invitations(b.user).invitations[0].status, 'pending');
  store.action(busy.code, b.user, 'finish', {});
  store.action(invited.code, b.user, 'join', {});
  assert.equal(store.invitations(b.user).invitations[0].status, 'accepted');
  store.action(invited.code, a.user, 'leave', {});
  store.search(a.user, 'start', settings);
  const found = store.search(b.user, 'start', settings);
  assert.deepEqual(found.room.players.map(p => p.nickname), ['alice', 'bob']);
});
test('bot identity never inherits a wallet nickname; invitation rate limit rolls back the extra room', t => {
  const { store, account, later } = fixture(t); const a = account('alice'), b = account('bob');
  const chess = store.create(a.user, { ...settings, topic: 'chess', mode: 'practice' });
  assert.equal(chess.players.find(p => p.id !== a.user.id).nickname, null);
  store.action(chess.code, a.user, 'resign', {});
  for (let i = 0; i < 20; i++) {
    store.create(a.user, { ...settings, invite: 'bob' });
    const invitation = store.invitations(a.user).invitations.find(i => i.status === 'pending');
    store.invitation(a.user, invitation.id, 'cancel'); later(1);
  }
  assert.throws(() => store.create(a.user, { ...settings, invite: 'bob' }), /INVITE_LIMIT/);
  assert.equal(store.history(a.user.id).length, 21);
  assert.ok(!store.hasActiveRoom(a.user.id));
});
test('HTTP registration is atomic, session-authenticated and CSRF protected; public lookup has no wallet data', async t => {
  const { store, account } = fixture(t); const a = account(), b = account();
  const server = makeServer({ store, secureCookies: false }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (session, path, body, site = base) => fetch(base + '/api' + path, {
    method: body ? 'POST' : 'GET', headers: { Cookie: `nimduel_session=${session.token}`, Origin: site, 'X-Nimduel-Client': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal((await fetch(base + '/api/players?nickname=alice')).status, 401);
  assert.equal((await call(a, '/nickname', { nickname: 'alice' }, 'https://evil.invalid')).status, 403);
  const claims = await Promise.all([call(a, '/nickname', { nickname: 'alice' }), call(b, '/nickname', { nickname: 'ALICE' })]);
  assert.deepEqual(claims.map(r => r.status).sort(), [200, 409]);
  const winner = claims[0].status === 200 ? a : b;
  const publicPlayer = await (await call(winner, '/players?nickname=alice')).json();
  assert.deepEqual(publicPlayer, { player: { nickname: 'alice' } });
  const rename = await (await call(winner, '/session', { name: 'fake' })).json();
  assert.equal(rename.user.name, '@alice');
});

import { identify } from './helpers/identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.mjs';
import { makeServer } from '../server/index.mjs';
const options = { topic: 'math', difficulty: 'normal', language: 'en', mode: 'friends', capacity: 2 };
function fixture(t, path = ':memory:') {
  let now = 1000000; const store = new Store(path, () => now);
  t.after(() => store.close());
  function account(name) {
    const session = store.createSession(name), address = 'fixture-' + name;
    store.db.prepare('INSERT INTO wallet_accounts VALUES (?, ?, ?, ?)').run(address, session.user.id, name, now);
    store.db.prepare('INSERT INTO wallet_sessions VALUES (?, ?, ?)').run(createHash('sha256').update(session.token).digest('hex'), address, now);
    session.user = store.claimNickname(store.session(session.token), name);
    return session;
  }
  return { store, account, later: ms => { now += ms; } };
}
function pair(store, a, b, topic = 'math', ranked = true) {
  store.search(a, 'start', { ...options, topic, ranked });
  return store.search(b, 'start', { ...options, topic, ranked }).room;
}
function start(store, r, users) {
  for (const u of users) store.action(r.code, u, 'ready', { rulesVersion: store.load(r.code).rulesVersion });
  for (const u of users) store.action(r.code, u, 'start', {});
}
function finish(store, r, a, b, win = true) {
  start(store, r, [a, b]);
  if (win) { const q = store.load(r.code).players.find(p => p.id === a.id).questions[0];
    store.action(r.code, a, 'answer', { questionId: q.id, requestId: randomUUID(), value: q.answer }); }
  store.action(r.code, a, 'finish', {}); return store.action(r.code, b, 'finish', {});
}

test('ranked queue requires wallet identity, validates category, and never pairs with casual players', t => {
  const { store, account } = fixture(t), a = account('alice').user, b = account('bobby').user;
  const guest = store.createSession('guest').user;
  assert.throws(() => store.search(guest, 'start', { ...options, ranked: true }), /NICKNAME_REQUIRED/);
  assert.throws(() => store.search(a, 'start', { ...options, ranked: 'true' }), /INVALID_RANKED/);
  assert.throws(() => store.search(a, 'start', { ...options, topic: 'mixed', ranked: true }), /INVALID_RATING_CATEGORY/);
  const casual = store.search(b, 'start', options);
  assert.equal(store.search(a, 'start', { ...options, ranked: true }).status, 'searching');
  assert.throws(() => store.search(a, 'start', { ...options, ranked: false }), /SEARCH_ACTIVE/);
  store.search(b, 'cancel', { ticket: casual.ticket });
  const r = store.search(b, 'start', { ...options, ranked: true }).room;
  assert.equal(r.ranked, true); assert.equal(r.rating, null);
});

test('Elo win changes both ratings once, public leaderboard has only nicknames and ranking fields', t => {
  const { store, account } = fixture(t), a = account('alice').user, b = account('bobby').user;
  const r = pair(store, a, b), done = finish(store, r, a, b);
  assert.deepEqual(done.rating.players.map(p => p.after).sort((a,b)=>a-b), [984, 1016]);
  for (let i=0;i<3;i++) { store.view(r.code, a.id); store.transaction(()=>store.save(store.load(r.code),'retry')); }
  const board = store.leaderboard(a, 'math');
  assert.equal(board.me.games, 1); assert.equal(board.me.rating, 1016); assert.equal(board.me.rank, 1);
  assert.equal(board.players[0].nickname, 'alice');
  assert.deepEqual(Object.keys(board.players[0]).sort(), ['draws','games','losses','nickname','rank','rating','wins']);
  assert.ok(!JSON.stringify(board).includes('fixture-')); assert.ok(!JSON.stringify(board).includes(a.id));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM rating_matches').get().n, 1);
});

test('repeat opponents share a 24-hour cooldown across flags and capitals but categories stay independent', t => {
  const { store, account, later } = fixture(t), a = account('alice').user, b = account('bobby').user;
  finish(store, pair(store,a,b,'flags'),a,b);
  const repeat = finish(store,pair(store,a,b,'capitals'),a,b);
  assert.equal(repeat.rating.status,'repeat_pair'); assert.equal(store.leaderboard(a,'geography').me.games,1);
  finish(store,pair(store,a,b,'math'),a,b,false);
  assert.equal(store.leaderboard(a,'math').me.rating,1000); assert.equal(store.leaderboard(a,'math').me.draws,1);
  later(86400000); // Fresh verified fixture sessions are still live for this unit test.
  finish(store,pair(store,a,b,'capitals'),a,b);
  assert.equal(store.leaderboard(a,'geography').me.games,2);
});

test('private rooms, casual search and rematches cannot mint ranking points, including forged ranked input', t => {
  const { store, account } = fixture(t), a = account('alice').user, b = account('bobby').user;
  const privateRoom = store.create(a,{...options,ranked:true}); store.action(privateRoom.code,b,'join',{});
  assert.equal(finish(store,privateRoom,a,b).rating,null);
  const ranked=pair(store,a,b); finish(store,ranked,a,b);
  const next=store.rematch(ranked.code,a); store.rematch(ranked.code,b);
  assert.equal(next.ranked,false); assert.equal(finish(store,next,a,b).rating,null);
  finish(store,pair(store,a,b,'math',false),a,b);
  assert.equal(store.leaderboard(a,'math').me.games,1);
});

test('server interruption and both no-shows do not rate; one missing player loses to the finisher', t => {
  const { store, account, later } = fixture(t), a = account('alice').user, b = account('bobby').user;
  const r=pair(store,a,b); store.tick(true); assert.equal(store.view(r.code,a.id).rating,null);
  const missing=pair(store,a,b); for(const u of [a,b]) store.action(missing.code,u,'ready',{rulesVersion:missing.rulesVersion});
  later(120001); store.tick(); assert.equal(store.view(missing.code,a.id).rating.status,'no_result');
  assert.equal(store.leaderboard(a,'math').me.games,0);
  const one=pair(store,a,b); for(const u of [a,b]) store.action(one.code,u,'ready',{rulesVersion:one.rulesVersion});
  store.action(one.code,a,'start',{}); store.action(one.code,a,'finish',{});
  later(120001); store.tick(); assert.equal(store.leaderboard(a,'math').me.rating,1016);
});

test('chess resignations and agreed draws use chess rating only', t => {
  const { store, account, later } = fixture(t), a=account('alice').user,b=account('bobby').user;
  const r=pair(store,a,b,'chess'); start(store,r,[a,b]); store.action(r.code,b,'resign',{});
  assert.equal(store.leaderboard(a,'chess').me.rating,1016); assert.equal(store.leaderboard(a,'math').me.games,0);
  later(86400000); const draw=pair(store,a,b,'chess'); start(store,draw,[a,b]);
  store.action(draw.code,a,'offerDraw',{}); store.action(draw.code,b,'acceptDraw',{});
  assert.equal(store.leaderboard(a,'chess').me.draws,1); assert.equal(store.leaderboard(a,'chess').me.games,2);
});

test('rematch notifies opponents, accepts idempotently without automatic readiness and blocks strangers', t => {
  const { store }=fixture(t),a=store.createSession('Alice').user,b=store.createSession('Bob').user,c=store.createSession('Stranger').user;
  const r=store.create(a,options); store.action(r.code,b,'join',{}); finish(store,r,a,b);
  const next=store.rematch(r.code,a), request=store.rematches(b).requests[0];
  assert.equal(request.from,'Alice'); assert.equal(request.previousCode,r.code); assert.equal(request.code,next.code);
  assert.equal(store.rematches(c).requests.length,0); assert.equal(store.rematches(a).requests.length,0);
  assert.throws(()=>store.declineRematch(next.code,c),/REMATCH_UNAVAILABLE/);
  assert.throws(()=>store.rematch(r.code,c),/NOT_A_MEMBER/);
  assert.equal(store.rematch(r.code,b).code,next.code); assert.equal(store.rematch(r.code,b).code,next.code);
  assert.equal(store.rematches(b).requests.length,0); assert.ok(store.load(next.code).players.every(p=>!p.ready));
  assert.throws(()=>store.declineRematch(next.code,b),/REMATCH_CLOSED/);
});

test('decline cancels group rematch, expiry and leaving release players, busy opponents are never pulled in', t => {
  const { store, later }=fixture(t),a=store.createSession('A').user,b=store.createSession('B').user,c=store.createSession('C').user;
  const r=store.create(a,{...options,capacity:3}); for(const u of [b,c])store.action(r.code,u,'join',{});
  start(store,r,[a,b,c]); for(const u of [a,b,c])store.action(r.code,u,'finish',{});
  const next=store.rematch(r.code,a); store.rematch(r.code,b);
  store.declineRematch(next.code,c); store.declineRematch(next.code,c);
  assert.equal(store.view(next.code,a.id).reason,'REMATCH_DECLINED'); assert.equal(store.hasActiveRoom(b.id),undefined);
  assert.equal(store.rematches(c).requests.length,0); assert.throws(()=>store.rematch(r.code,c),/REMATCH_CLOSED/);
  const r2=store.create(a,options); store.action(r2.code,b,'join',{}); finish(store,r2,a,b);
  const waiting=store.rematch(r2.code,a); const other=store.create(b,{...options,mode:'practice'});
  assert.throws(()=>store.rematch(r2.code,b),/ACTIVE_ROOM_EXISTS/); assert.equal(store.rematches(b).requests.length,1);
  store.action(other.code,b,'finish',{}); later(600001); store.tick();
  assert.equal(store.rematches(b).requests.length,0); assert.equal(store.view(waiting.code,a.id).status,'cancelled');
});

test('schema migration is repeatable and rated history persists after reopen', t => {
  const dir=mkdtempSync(join(tmpdir(),'nimduel-ranking-')); const path=join(dir,'game.sqlite');
  const old=new DatabaseSync(path); old.exec(`CREATE TABLE match_queue (user_id TEXT PRIMARY KEY, ticket TEXT, topic TEXT, difficulty TEXT, language TEXT, name TEXT, created_at INTEGER, last_seen INTEGER, room_code TEXT) STRICT;`); old.close();
  const {store,account}=fixture(t,path),a=account('alice').user,b=account('bobby').user;
  assert.equal(store.db.prepare('PRAGMA table_info(match_queue)').all().find(c => c.name === 'stake_luna').dflt_value, '0');
  t.after(()=>{ assert.ok(dir.startsWith(join(tmpdir(),'nimduel-ranking-'))); rmSync(dir,{recursive:true,force:true}); });
  const r=pair(store,a,b); finish(store,r,a,b);
  const reopened=new Store(path); try { assert.equal(reopened.leaderboard(a,'math').me.rating,1016); assert.equal(reopened.load(r.code).rating.status,'rated'); } finally {reopened.close();}
});

test('leaderboard is public, rematch inbox is private and decline enforces CSRF and recipient ownership',async t=>{
  const {store}=fixture(t),a=identify(store,store.createSession('Alice'),'alice'),b=identify(store,store.createSession('Bob'),'bobby'),c=identify(store,store.createSession('Other'),'other');
  const r=store.create(a.user,options);store.action(r.code,b.user,'join',{});finish(store,r,a.user,b.user);const next=store.rematch(r.code,a.user);
  const server=makeServer({store,secureCookies:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/leaderboard?category=math')).status,200);
  assert.equal((await fetch(base+'/api/leaderboard?category=__proto__')).status,400);
  assert.equal((await fetch(base+'/api/rematches')).status,401);
  const headers={'Origin':base,'Content-Type':'application/json','X-Nimduel-Client':'1',Cookie:'nimduel_session='+b.token};
  assert.equal((await fetch(base+'/api/rematches',{headers})).status,200);
  const url=base+`/api/rematches/${next.code}/decline`;
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:'{}'})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Cookie:'nimduel_session='+c.token},body:'{}'})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,200);
});

test('rating ledger failure rolls back both ratings and game completion, then retry settles once', t => {
  const {store,account}=fixture(t),a=account('alice').user,b=account('bobby').user;
  const r=pair(store,a,b); start(store,r,[a,b]); store.action(r.code,a,'finish',{});
  store.db.exec("CREATE TRIGGER fail_rating BEFORE INSERT ON rating_matches BEGIN SELECT RAISE(ABORT, 'ledger unavailable'); END;");
  assert.throws(()=>store.action(r.code,b,'finish',{}),/ledger unavailable/);
  assert.equal(store.leaderboard(a,'math').me.games,0); assert.equal(store.load(r.code).status,'playing');
  store.db.exec('DROP TRIGGER fail_rating'); store.action(r.code,b,'finish',{});
  assert.equal(store.leaderboard(a,'math').me.games,1);
});

test('declining a funded group rematch retains every deposit for refund and leaving closes all invitations', t => {
  const {store}=fixture(t), users=['A','B','C'].map(name=>({...store.createSession(name).user,wallet:{address:'wallet-'+name}}));
  const [a,b,c]=users; store.payments={status:()=>({ready:true,address:'bank'})};
  const r=store.create(a,{...options,capacity:3,stake:100000}); for(const u of [b,c])store.action(r.code,u,'join',{});
  const deposits=users.map(u=>({playerId:u.id,address:u.wallet.address,amountLuna:100000,hash:randomUUID()}));
  store.markFunded(r.code,deposits);start(store,r,users);for(const u of users)store.action(r.code,u,'finish',{});
  const next=store.rematch(r.code,a);store.rematch(r.code,b);store.markFunded(next.code,deposits.slice(0,2));
  store.declineRematch(next.code,c); const closed=store.load(next.code);
  assert.equal(closed.status,'cancelled');assert.equal(closed.players.length,2);assert.ok(closed.players.every(p=>p.fundedHash));
  assert.equal(store.rematches(c).requests.length,0);
  const fresh=store.create(a,options);store.action(fresh.code,b,'join',{});finish(store,fresh,a,b);
  const leave=store.rematch(fresh.code,a);store.action(leave.code,a,'leave',{});
  assert.equal(store.load(leave.code).reason,'REMATCH_CANCELLED');assert.equal(store.rematches(b).requests.length,0);
});

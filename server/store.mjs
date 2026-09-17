import { roomNetwork } from './payment-network.mjs';
import { settleRating, leaderboard } from './ratings.mjs';
import { ChessRunner } from './chess-runner.mjs';
import { friendsView, changeFriend } from './friends.mjs';
import { syncRematches, rematchesView, declineRematch } from './rematches.mjs';
import { DatabaseSync } from 'node:sqlite';
import languages from '../shared/languages.json' with { type: 'json' };
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { completedRooms, pendingMistakes, progressView } from './progress.mjs';
import { pruneQueue, searchAction, searchView } from './matchmaking.mjs';
import { initPuzzle } from './puzzles.mjs';
import { claimNickname, lookupPlayer, inviteToRoom, invitationsView, invitationAction, expireInvitations } from './identity.mjs';
import { act, advance, createRoom, GameError, member, requireThat, roomView, voidRoom } from './game.mjs';
import { canonicalAddress, challengeMessage, CHALLENGE_TTL_MS, verifyWalletSignature, WALLET_SESSION_TTL_MS } from './wallet-auth.mjs';

const digest = token => createHash('sha256').update(token).digest('hex');

export class Store {
  constructor(path = 'data/nimduel.sqlite', clock = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.clock = clock;
    this.bots = new ChessRunner(this);
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL, body TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS rooms_status ON rooms(status);
      CREATE TABLE IF NOT EXISTS room_members (
        code TEXT NOT NULL REFERENCES rooms(code), user_id TEXT NOT NULL,
        PRIMARY KEY(code, user_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS members_user ON room_members(user_id);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY, code TEXT NOT NULL REFERENCES rooms(code),
        kind TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS wallet_accounts (
        address TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS wallet_sessions (
        token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
        address TEXT NOT NULL REFERENCES wallet_accounts(address), verified_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS wallet_challenges (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_hash TEXT NOT NULL,
        address TEXT NOT NULL, origin TEXT NOT NULL, message TEXT NOT NULL,
        issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS challenges_user ON wallet_challenges(user_id, issued_at);
      CREATE TABLE IF NOT EXISTS presence (
        token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
        last_seen INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS match_queue (
        user_id TEXT PRIMARY KEY, ticket TEXT NOT NULL UNIQUE, topic TEXT NOT NULL,
        difficulty TEXT NOT NULL, language TEXT NOT NULL, name TEXT NOT NULL,
        created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, room_code TEXT REFERENCES rooms(code)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS nicknames (
        user_id TEXT PRIMARY KEY REFERENCES wallet_accounts(user_id),
        nickname TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY, room_code TEXT NOT NULL UNIQUE REFERENCES rooms(code),
        sender_id TEXT NOT NULL REFERENCES nicknames(user_id), recipient_id TEXT NOT NULL REFERENCES nicknames(user_id),
        sender_nickname TEXT NOT NULL, recipient_nickname TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS invitations_recipient ON invitations(recipient_id, status);
      CREATE TABLE IF NOT EXISTS friends (
        user_id TEXT NOT NULL REFERENCES nicknames(user_id),
        friend_id TEXT NOT NULL REFERENCES nicknames(user_id), created_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, friend_id), CHECK(user_id <> friend_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ratings (
        user_id TEXT NOT NULL REFERENCES nicknames(user_id), category TEXT NOT NULL,
        rating INTEGER NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL, draws INTEGER NOT NULL, losses INTEGER NOT NULL,
        PRIMARY KEY(user_id, category)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS rating_matches (
        room_code TEXT PRIMARY KEY REFERENCES rooms(code), category TEXT NOT NULL, pair TEXT NOT NULL,
        created_at INTEGER NOT NULL, rated INTEGER NOT NULL, body TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS rating_pairs ON rating_matches(pair, category, created_at);
      CREATE TABLE IF NOT EXISTS rematch_requests (
        room_code TEXT NOT NULL REFERENCES rooms(code), previous_code TEXT NOT NULL REFERENCES rooms(code),
        recipient_id TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(room_code, recipient_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS rematch_recipient ON rematch_requests(recipient_id, status);

    `);
    if (!this.db.prepare('PRAGMA table_info(match_queue)').all().some(c => c.name === 'ranked'))
      this.db.exec('ALTER TABLE match_queue ADD COLUMN ranked INTEGER NOT NULL DEFAULT 0');
    if (!this.db.prepare('PRAGMA table_info(match_queue)').all().some(c => c.name === 'stake_luna'))
      this.db.exec('ALTER TABLE match_queue ADD COLUMN stake_luna INTEGER NOT NULL DEFAULT 0');
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  session(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = this.db.prepare(`SELECT s.user_id, s.name, w.address, w.verified_at, n.nickname FROM sessions s
      LEFT JOIN wallet_sessions w ON w.token_hash = s.token_hash
      LEFT JOIN nicknames n ON n.user_id=s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(digest(token), this.clock());
    return row ? { id: row.user_id, name: row.name,
      ...(row.nickname ? { nickname: row.nickname } : {}),
      ...(row.address ? { wallet: { address: row.address, verifiedAt: row.verified_at } } : {}) } : null;
  }
  createSession(name) {
    const token = randomBytes(32).toString('hex');
    const user = { id: randomUUID(), name };
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(digest(token), user.id, name, this.clock() + 30 * 86400_000);
    return { token, user };
  }
  rename(user, name) {
    if (user.nickname) return user; // A display-name update cannot overwrite a registered identity.
    this.transaction(() => {
      this.db.prepare('UPDATE sessions SET name = ? WHERE user_id = ?').run(name, user.id);
      this.db.prepare('UPDATE wallet_accounts SET name = ? WHERE user_id = ?').run(name, user.id);
    });
    return { ...user, name };
  }
  logout(user, token) {
    this.transaction(() => {
      requireThat(!this.hasActiveRoom(user.id), 'ACTIVE_ROOM_EXISTS', 409);
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
      this.db.prepare('DELETE FROM wallet_challenges WHERE session_hash = ?').run(digest(token));
    });
  }
  walletChallenge(user, token, origin, input) {
    const address = canonicalAddress(input.address);
    requireThat(typeof input.language === 'string' && Object.hasOwn(languages, input.language), 'INVALID_LANGUAGE');
    requireThat(!user.wallet || user.wallet.address === address, 'WALLET_SWITCH_REQUIRES_LOGOUT', 409);
    return this.transaction(() => {
      const issuedAt = this.clock();
      this.db.prepare('DELETE FROM wallet_challenges WHERE expires_at < ?').run(issuedAt - 600_000);
      const recent = this.db.prepare('SELECT COUNT(*) AS n FROM wallet_challenges WHERE user_id = ? AND issued_at > ?').get(user.id, issuedAt - 600_000);
      requireThat(recent.n < 10, 'WALLET_RATE_LIMIT', 429);
      const id = randomBytes(32).toString('hex');
      const expiresAt = issuedAt + CHALLENGE_TTL_MS;
      const message = challengeMessage({ id, address, origin, issuedAt, expiresAt, language: input.language });
      this.db.prepare('UPDATE wallet_challenges SET used_at = ? WHERE session_hash = ? AND used_at IS NULL').run(issuedAt, digest(token));
      this.db.prepare('INSERT INTO wallet_challenges VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)').run(id, user.id, digest(token), address, origin, message, issuedAt, expiresAt);
      return { id, address, origin, message, expiresAt };
    });
  }
  verifyWallet(user, token, origin, input) {
    requireThat(typeof input.challengeId === 'string' && /^[a-f0-9]{64}$/.test(input.challengeId), 'INVALID_CHALLENGE');
    const result = this.transaction(() => {
      const now = this.clock();
      const challenge = this.db.prepare('SELECT * FROM wallet_challenges WHERE id = ? AND user_id = ? AND session_hash = ?').get(input.challengeId, user.id, digest(token));
      requireThat(challenge && challenge.used_at === null && challenge.expires_at > now && challenge.issued_at <= now, 'CHALLENGE_EXPIRED', 409);
      requireThat(challenge.origin === origin, 'CHALLENGE_ORIGIN_MISMATCH', 403);
      // Consume a challenge even when its signature fails. A new attempt requires a new challenge.
      this.db.prepare('UPDATE wallet_challenges SET used_at = ? WHERE id = ?').run(now, challenge.id);
      try { verifyWalletSignature(challenge.message, challenge.address, input); }
      catch (error) { return { error }; }
      const ownWallet = this.db.prepare('SELECT address FROM wallet_accounts WHERE user_id = ?').get(user.id);
      if (ownWallet && ownWallet.address !== challenge.address) return { error: new GameError('WALLET_SWITCH_REQUIRES_LOGOUT', 409) };
      const account = this.db.prepare('SELECT user_id, name FROM wallet_accounts WHERE address = ?').get(challenge.address);
      const userId = account?.user_id ?? user.id;
      if (userId !== user.id && this.hasActiveRoom(user.id)) return { error: new GameError('ACTIVE_ROOM_EXISTS', 409) };
      // A fresh wallet signature can recover a lost browser session during a match.
      // Preserve the wallet's player ID and room; rotation below revokes the old device.
      const name = account?.name ?? user.name;
      if (!account) this.db.prepare('INSERT INTO wallet_accounts VALUES (?, ?, ?, ?)').run(challenge.address, userId, name, now);
      const rotated = randomBytes(32).toString('hex');
      // One live session per wallet. Guest credentials cannot survive privilege elevation.
      this.db.prepare('DELETE FROM sessions WHERE user_id IN (?, ?)').run(user.id, userId);
      this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(digest(rotated), userId, name, now + WALLET_SESSION_TTL_MS);
      this.db.prepare('INSERT INTO wallet_sessions VALUES (?, ?, ?)').run(digest(rotated), challenge.address, now);
      const nickname = this.db.prepare('SELECT nickname FROM nicknames WHERE user_id=?').get(userId)?.nickname;
      return { token: rotated, user: { id: userId, name, ...(nickname ? { nickname } : {}), wallet: { address: challenge.address, verifiedAt: now } } };
    });
    if (result.error) throw result.error;
    return result;
  }
  load(code) {
    const row = this.db.prepare('SELECT body FROM rooms WHERE code = ?').get(code);
    if (!row) throw new GameError('ROOM_NOT_FOUND', 404);
    return JSON.parse(row.body);
  }
  save(room, kind) {
    this.db.prepare(`INSERT INTO rooms VALUES (?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET status=excluded.status, body=excluded.body`).run(room.code, room.status, room.createdAt, JSON.stringify(room));
    settleRating(this, room); syncRematches(this, room);
    if (room.rating) this.db.prepare('UPDATE rooms SET body=? WHERE code=?').run(JSON.stringify(room), room.code);
    this.db.prepare('DELETE FROM room_members WHERE code = ?').run(room.code);
    for (const p of room.players) this.db.prepare('INSERT INTO room_members VALUES (?, ?)').run(room.code, p.id);
    if (kind !== 'heartbeat') this.db.prepare('INSERT INTO events(code, kind, created_at) VALUES (?, ?, ?)').run(room.code, kind, this.clock());
  }
  hasActiveRoom(userId, exceptCode, ignoreQueue = false) {
    return this.db.prepare(`SELECT r.code FROM rooms r JOIN room_members m ON m.code=r.code
      WHERE m.user_id=? AND r.status IN ('lobby','starting','playing') AND r.code != ? LIMIT 1`).get(userId, exceptCode ?? '')
      ?? (!ignoreQueue && this.db.prepare('SELECT ticket FROM match_queue WHERE user_id=? AND room_code IS NULL AND last_seen>? AND created_at>?')
        .get(userId, this.clock() - 15000, this.clock() - 300000));
  }
  search(user, kind, input = {}) {
    return this.transaction(() => {
      const now = this.clock(); pruneQueue(this, now);
      return kind === 'view' ? searchView(this, user, now) : searchAction(this, user, kind, input, now);
    });
  }
  claimNickname(user, nickname) { return this.transaction(() => claimNickname(this, user, nickname)); }
  lookupPlayer(user, nickname) { return lookupPlayer(this, user, nickname); }
  friends(user) { return friendsView(this, user); }
  heartbeatPresence(user, token) {
    // Bind presence to the authenticated session, never to a client-supplied user ID or status.
    requireThat(user.nickname && user.wallet, 'NICKNAME_REQUIRED', 403);
    requireThat(this.session(token)?.id === user.id, 'SESSION_REQUIRED', 401);
    this.db.prepare(`INSERT INTO presence VALUES (?, ?) ON CONFLICT(token_hash)
      DO UPDATE SET last_seen=excluded.last_seen`).run(digest(token), this.clock());
    return { ok: true };
  }
  changeFriend(user, nickname, action) { return this.transaction(() => changeFriend(this, user, nickname, action)); }
  invitations(user) { return this.transaction(() => invitationsView(this, user, this.clock())); }
  invitation(user, id, action) { return this.transaction(() => invitationAction(this, user, id, action, this.clock())); }
  create(user, input) {
    return this.transaction(() => {
      if (this.hasActiveRoom(user.id)) throw new GameError('ACTIVE_ROOM_EXISTS', 409);
      const recent = this.db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE created_at > ?').get(this.clock() - 3600_000);
      if (recent.n >= 500) throw new GameError('SERVER_BUSY', 429);
      if (input.topic === 'chess' && input.mode === 'practice') this.requireBotCapacity();
      const room = createRoom(user, input, this.clock(), this.payments?.status());
      if (room.topic === 'puzzles') {
        const recent = this.db.prepare(`SELECT json_extract(r.body, '$.puzzle.id') AS puzzle_id
          FROM rooms r JOIN room_members m ON m.code=r.code
          WHERE m.user_id=? AND json_extract(r.body, '$.topic')='puzzles'
          AND json_extract(r.body, '$.difficulty')=? ORDER BY r.created_at DESC, r.rowid DESC LIMIT 9999`)
          .all(user.id, room.difficulty).map(r => r.puzzle_id);
        initPuzzle(room, recent);
      }
      if (input.training !== undefined) {
        requireThat(input.training === 'mistakes' && input.mode === 'practice' && !room.stakeLuna && !['chess', 'puzzles'].includes(room.topic), 'INVALID_TRAINING');
        const mistakes = pendingMistakes(completedRooms(this.db, user.id), user.id)
          .filter(item => item.difficulty === room.difficulty && (room.topic === 'mixed' || item.question.kind === room.topic));
        requireThat(mistakes.length, 'NO_MISTAKES', 409);
        room.trainingQuestions = mistakes.slice(0, 30).map(item => item.question);
        room.questionCount = room.trainingQuestions.length;
      }
      if (input.mode === 'practice') {
        act(room, user, 'ready', { rulesVersion: room.rulesVersion }, this.clock());
        act(room, user, 'start', {}, this.clock());
      }
      this.save(room, 'create');
      if (input.invite !== undefined) inviteToRoom(this, room, user, input.invite, this.clock());
      return roomView(room, user.id, this.clock());
    });
  }
  leaderboard(user, category) { return leaderboard(this, user, category); }
  rematches(user) { return rematchesView(this, user, this.clock()); }
  declineRematch(code, user) { return this.transaction(() => declineRematch(this, code, user)); }
  progress(userId) { return progressView(completedRooms(this.db, userId), userId); }
  rematch(code, user) {
    return this.transaction(() => {
      const previous = this.load(code);
      member(previous, user.id);
      requireThat(!previous.stakeLuna || roomNetwork(previous) === (this.payments?.status().network ?? 'testalbatross'), 'PAYMENT_NETWORK_CHANGED', 409);
      requireThat(previous.status === 'completed' && !previous.trainingQuestions && previous.topic !== 'puzzles', 'REMATCH_UNAVAILABLE', 409);
      if (previous.rematchCode) {
        const next = this.load(previous.rematchCode);
        requireThat(!['cancelled', 'void'].includes(next.status) && (next.status !== 'lobby' || next.lobbyDeadline > this.clock()), 'REMATCH_CLOSED', 409);
        requireThat(!this.hasActiveRoom(user.id, next.code), 'ACTIVE_ROOM_EXISTS', 409);
        act(next, user, 'join', {}, this.clock());
        this.save(next, 'rematch_join');
        return roomView(next, user.id, this.clock());
      }
      requireThat(!this.hasActiveRoom(user.id), 'ACTIVE_ROOM_EXISTS', 409);
      const recent = this.db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE created_at > ?').get(this.clock() - 3600_000);
      requireThat(recent.n < 500, 'SERVER_BUSY', 429);
      if (previous.topic === 'chess' && previous.mode === 'practice') this.requireBotCapacity();
      const next = createRoom(user, { topic: previous.topic, difficulty: previous.difficulty,
        language: previous.language, mode: previous.mode, capacity: previous.capacity,
        stake: previous.stakeLuna ?? 0, paymentNetwork: roomNetwork(previous) }, this.clock(), this.payments?.status());
      next.rematchOf = previous.code;
      if (next.mode === 'friends') next.lobbyDeadline = this.clock() + 600000;
      next.rematchPlayers = previous.players.filter(p => !p.bot).map(p => p.id);
      if (next.chess) {
        next.rematchWhiteId = previous.mode === 'practice'
          ? previous.chess.whiteId === user.id ? next.players.find(p => p.bot).id : user.id
          : previous.chess.blackId;
      }
      if (next.mode === 'practice') {
        act(next, user, 'ready', { rulesVersion: next.rulesVersion }, this.clock());
        act(next, user, 'start', {}, this.clock());
      }
      previous.rematchCode = next.code;
      this.save(next, 'rematch_create'); this.save(previous, 'rematch_link');
      if (next.mode === 'friends') for (const id of next.rematchPlayers.filter(id => id !== user.id))
        this.db.prepare("INSERT INTO rematch_requests VALUES (?, ?, ?, 'pending')").run(next.code, previous.code, id);
      return roomView(next, user.id, this.clock());
    });
  }
  action(code, user, action, input) {
    return this.transaction(() => {
      const room = this.load(code);
      if (action === 'join' && this.hasActiveRoom(user.id, code)) throw new GameError('ACTIVE_ROOM_EXISTS', 409);
      act(room, user, action, input, this.clock());
      if (action === 'join' && room.invitedUserId === user.id) this.db.prepare("UPDATE invitations SET status='accepted' WHERE room_code=? AND status='pending'").run(code);
      this.save(room, action);
      return action === 'leave' ? { left: true } : roomView(room, user.id, this.clock());
    });
  }
  view(code, userId) {
    return this.transaction(() => {
      const room = this.load(code);
      member(room, userId);
      const before = JSON.stringify(room);
      advance(room, this.clock());
      if (before !== JSON.stringify(room)) this.save(room, 'deadline');
      return roomView(room, userId, this.clock());
    });
  }
  history(userId) {
    const rows = this.db.prepare(`SELECT r.body FROM rooms r JOIN room_members m ON m.code = r.code
      WHERE m.user_id = ? ORDER BY r.created_at DESC LIMIT 40`).all(userId);
    return rows.map(row => {
      const r = JSON.parse(row.body); const me = r.players.find(p => p.id === userId);
      return { code: r.code, topic: r.topic, status: r.status, mode: r.mode, createdAt: r.createdAt,
        score: r.status === 'completed' ? me.score : null, won: r.winners.includes(userId), players: r.players.length };
    });
  }
  tick(interrupted = false) {
    this.transaction(() => {
      expireInvitations(this, this.clock());
      if (interrupted) this.db.prepare('DELETE FROM match_queue WHERE room_code IS NULL').run();
      else pruneQueue(this, this.clock());
      const rows = this.db.prepare("SELECT body FROM rooms WHERE status IN ('lobby','starting','playing')").all();
      for (const row of rows) {
        const room = JSON.parse(row.body); const before = JSON.stringify(room);
        if (interrupted) voidRoom(room, this.clock());
        else advance(room, this.clock());
        if (before !== JSON.stringify(room)) this.save(room, interrupted ? 'server_interruption' : 'deadline');
      }
    });
    if (!interrupted) this.bots.schedule();
  }
  waitForBots() { return this.bots.wait(); }
  requireBotCapacity() {
    const count = this.db.prepare("SELECT count(*) AS n FROM rooms WHERE status IN ('starting','playing') AND json_extract(body, '$.topic')='chess' AND json_extract(body, '$.mode')='practice'").get().n;
    requireThat(count < 16, 'CHESS_BOT_BUSY', 503);
  }
  paidRooms() { return this.db.prepare('SELECT body FROM rooms').all().map(row => JSON.parse(row.body)).filter(room => room.stakeLuna); }
  markFunded(code, deposits) {
    this.transaction(() => {
      const room = this.load(code); let changed = false;
      if (room.status !== 'lobby') return;
      for (const deposit of deposits) {
        const p = member(room, deposit.playerId);
        requireThat(p.walletAddress === deposit.address && room.stakeLuna === deposit.amountLuna, 'DEPOSIT_MISMATCH');
        if (!p.fundedHash) { p.fundedHash = deposit.hash; changed = true; }
      }
      if (changed) this.save(room, 'deposit_confirmed');
    });
  }
  close() { this.bots.close(); this.db.close(); }
}

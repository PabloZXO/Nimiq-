import { requireIdentity } from './identity.mjs';
import { ratingCategory } from './ratings.mjs';
import { randomUUID } from 'node:crypto';
import { act, advance, createRoom, requireThat, roomView } from './game.mjs';

export const SEARCH_LEASE_MS = 15000;
export const SEARCH_LIMIT_MS = 300000;
export function pruneQueue(store, now) {
  store.db.prepare('DELETE FROM match_queue WHERE room_code IS NULL AND (last_seen <= ? OR created_at <= ?)')
    .run(now - SEARCH_LEASE_MS, now - SEARCH_LIMIT_MS);
}
export function searchView(store, user, now) {
  const row = store.db.prepare('SELECT * FROM match_queue WHERE user_id=?').get(user.id);
  if (!row) return { status: 'idle' };
  if (row.room_code) {
    const room = store.load(row.room_code);
    const before = JSON.stringify(room); advance(room, now);
    if (before !== JSON.stringify(room)) store.save(room, 'search_deadline');
    return { status: 'matched', ticket: row.ticket, room: roomView(room, user.id, now) };
  }
  return { status: 'searching', ticket: row.ticket, topic: row.topic, difficulty: row.difficulty,
    ranked: Boolean(row.ranked), stakeLuna: row.stake_luna, paymentNetwork: store.payments?.status().network ?? 'testalbatross', expiresAt: row.created_at + SEARCH_LIMIT_MS };
}
export function searchAction(store, user, kind, input, now) {
  pruneQueue(store, now);
  let row = store.db.prepare('SELECT * FROM match_queue WHERE user_id=?').get(user.id);
  if (kind === 'cancel') {
    if (!row || row.ticket !== input.ticket) return searchView(store, user, now);
    if (row.room_code) {
      const room = store.load(row.room_code);
      if (room.status === 'lobby') {
        room.status = 'cancelled'; room.reason = 'SEARCH_CANCELLED'; room.closedAt = now;
        store.save(room, 'search_cancelled');
      } else if (['starting', 'playing'].includes(room.status)) return searchView(store, user, now);
    }
    store.db.prepare('DELETE FROM match_queue WHERE user_id=?').run(user.id);
    return { status: 'idle' };
  }
  if (kind === 'heartbeat') {
    if (row?.ticket === input.ticket && !row.room_code) store.db.prepare('UPDATE match_queue SET last_seen=? WHERE user_id=?').run(now, user.id);
    return searchView(store, user, now);
  }
  requireThat(kind === 'start', 'UNKNOWN_ACTION');
  requireThat(['math', 'flags', 'capitals', 'mixed', 'chess'].includes(input.topic), 'INVALID_TOPIC');
  const stake = input.stake ?? 0;
  const payments = store.payments?.status();
  requireThat(input.ranked === undefined || typeof input.ranked === 'boolean', 'INVALID_RANKED');
  const ranked = input.ranked ? 1 : 0;
  if (ranked) { requireIdentity(store, user); requireThat(ratingCategory(input.topic), 'INVALID_RATING_CATEGORY'); }
  // Validation is shared with ordinary rooms, including language and difficulty.
  createRoom(user, { ...input, mode: 'friends', capacity: 2, stake }, now, payments);
  const difficulty = input.topic === 'chess' ? 'normal' : input.difficulty;
  if (row?.room_code) {
    const room = store.load(row.room_code);
    if (['lobby', 'starting', 'playing'].includes(room.status)) return searchView(store, user, now);
    store.db.prepare('DELETE FROM match_queue WHERE user_id=?').run(user.id); row = null;
  }
  requireThat(!store.hasActiveRoom(user.id, undefined, true), 'ACTIVE_ROOM_EXISTS', 409);
  if (row) {
    requireThat(row.topic === input.topic && row.difficulty === difficulty && row.ranked === ranked && row.stake_luna === stake, 'SEARCH_ACTIVE', 409);
    return searchView(store, user, now);
  }
  const candidate = store.db.prepare(`SELECT q.*, w.address FROM match_queue q JOIN sessions s ON s.user_id=q.user_id
    LEFT JOIN wallet_sessions w ON w.token_hash=s.token_hash
    WHERE q.room_code IS NULL AND q.user_id!=? AND q.topic=? AND q.difficulty=? AND q.ranked=? AND q.stake_luna=? AND s.expires_at>?
    AND (?=0 OR (w.address IS NOT NULL AND w.address!=? AND w.address!=?))
    AND (q.ranked=0 OR EXISTS (SELECT 1 FROM wallet_sessions w JOIN nicknames n ON n.user_id=q.user_id WHERE w.token_hash=s.token_hash))
    AND NOT EXISTS (SELECT 1 FROM rooms r JOIN room_members m ON m.code=r.code
      WHERE m.user_id=q.user_id AND r.status IN ('lobby','starting','playing'))
    ORDER BY q.created_at, q.ticket LIMIT 1`).get(user.id, input.topic, difficulty, ranked, stake, now, stake, payments?.address ?? '', user.wallet?.address ?? '');
  const ticket = randomUUID();
  store.db.prepare('INSERT INTO match_queue (user_id,ticket,topic,difficulty,language,name,created_at,last_seen,room_code,ranked,stake_luna) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)')
    .run(user.id, ticket, input.topic, difficulty, input.language, user.name, now, now, ranked, stake);
  if (candidate) {
    const recent = store.db.prepare('SELECT count(*) AS n FROM rooms WHERE created_at>?').get(now - 3600000);
    requireThat(recent.n < 500, 'SERVER_BUSY', 429);
    const nickname = store.db.prepare('SELECT nickname FROM nicknames WHERE user_id=?').get(candidate.user_id)?.nickname;
    const first = { id: candidate.user_id, name: candidate.name, ...(nickname ? { nickname } : {}), ...(candidate.address ? { wallet: { address: candidate.address } } : {}) };
    const room = createRoom(first, { topic: candidate.topic, difficulty, language: candidate.language, mode: 'friends', capacity: 2, stake, paymentNetwork: payments?.network }, now, payments);
    act(room, user, 'join', {}, now);
    room.matchmaking = true; room.ranked = Boolean(ranked); room.rematchPlayers = [first.id, user.id];
    room.lobbyDeadline = now + (stake ? 600000 : 60000);
    store.save(room, 'match_found');
    store.db.prepare('UPDATE match_queue SET room_code=? WHERE user_id IN (?, ?)').run(room.code, first.id, user.id);
  }
  return searchView(store, user, now);
}

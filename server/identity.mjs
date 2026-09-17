import { randomUUID } from 'node:crypto';
import { act, requireThat, roomView } from './game.mjs';

export function nicknameOf(value) {
  requireThat(typeof value === 'string' && value.length <= 24, 'INVALID_NICKNAME');
  const nickname = value.trim().replace(/^@/, '').toLowerCase();
  requireThat(/^[a-z][a-z0-9_]{2,19}$/.test(nickname), 'INVALID_NICKNAME');
  requireThat(!['admin', 'support', 'nimiq', 'nimduel', 'nimbot', 'moderator', 'system'].includes(nickname), 'NICKNAME_RESERVED');
  return nickname;
}
export function requireIdentity(store, user) {
  const account = store.db.prepare(`SELECT n.nickname, w.address FROM nicknames n
    JOIN wallet_accounts w ON w.user_id=n.user_id WHERE n.user_id=?`).get(user.id);
  requireThat(user.wallet && account?.address === user.wallet.address, 'NICKNAME_REQUIRED', 403);
  return account.nickname;
}
export function claimNickname(store, user, value) {
  requireThat(user.wallet, 'VERIFIED_WALLET_REQUIRED', 403);
  const account = store.db.prepare('SELECT address FROM wallet_accounts WHERE user_id=?').get(user.id);
  requireThat(account?.address === user.wallet.address, 'VERIFIED_WALLET_REQUIRED', 403);
  const nickname = nicknameOf(value);
  const own = store.db.prepare('SELECT nickname FROM nicknames WHERE user_id=?').get(user.id);
  if (own) {
    requireThat(own.nickname === nickname, 'NICKNAME_LOCKED', 409);
    return { ...user, nickname, name: '@' + nickname };
  }
  // Existing players may register during onboarding even with a legacy active room.
  // The room keeps its original player snapshot; wallet ownership and funds do not change.
  requireThat(!store.db.prepare('SELECT 1 FROM nicknames WHERE nickname=?').get(nickname), 'NICKNAME_TAKEN', 409);
  store.db.prepare('INSERT INTO nicknames VALUES (?, ?, ?)').run(user.id, nickname, store.clock());
  store.db.prepare('UPDATE sessions SET name=? WHERE user_id=?').run('@' + nickname, user.id);
  store.db.prepare('UPDATE wallet_accounts SET name=? WHERE user_id=?').run('@' + nickname, user.id);
  return { ...user, name: '@' + nickname, nickname };
}
export function lookupPlayer(store, user, value) {
  requireIdentity(store, user);
  const row = store.db.prepare('SELECT nickname FROM nicknames WHERE nickname=?').get(nicknameOf(value));
  return { player: row ? { nickname: row.nickname } : null };
}

function closeInvitation(store, invitation, status, now) {
  store.db.prepare('UPDATE invitations SET status=? WHERE id=?').run(status, invitation.id);
  const room = store.load(invitation.room_code);
  if (room.status === 'lobby' && room.players.length === 1) {
    room.status = 'cancelled'; room.reason = 'INVITE_' + status.toUpperCase(); room.closedAt = now;
    store.save(room, 'invitation_' + status);
  }
}
export function expireInvitations(store, now) {
  const rows = store.db.prepare("SELECT * FROM invitations WHERE status='pending'").all();
  for (const row of rows) {
    const room = store.load(row.room_code);
    if (row.expires_at <= now || room.status !== 'lobby') closeInvitation(store, row, row.expires_at <= now ? 'expired' : 'cancelled', now);
  }
}
export function inviteToRoom(store, room, user, value, now) {
  const from = requireIdentity(store, user);
  requireThat(room.mode === 'friends' && room.capacity === 2 && room.status === 'lobby' && room.players.length === 1, 'INVITE_DUEL_ONLY');
  const target = store.db.prepare('SELECT user_id, nickname FROM nicknames WHERE nickname=?').get(nicknameOf(value));
  requireThat(target, 'PLAYER_NOT_FOUND', 404);
  requireThat(target.user_id !== user.id, 'INVITE_SELF');
  const sent = store.db.prepare('SELECT count(*) AS n FROM invitations WHERE sender_id=? AND created_at>?').get(user.id, now - 3600000);
  requireThat(sent.n < 20, 'INVITE_LIMIT', 429);
  const inbox = store.db.prepare("SELECT count(*) AS n FROM invitations WHERE recipient_id=? AND status='pending' AND expires_at>?").get(target.user_id, now);
  requireThat(inbox.n < 10, 'INVITE_LIMIT', 429);
  room.invitedUserId = target.user_id;
  room.invitedNickname = target.nickname;
  room.lobbyDeadline = Math.min(room.lobbyDeadline, now + 600000);
  store.save(room, 'invite_room');
  store.db.prepare('INSERT INTO invitations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), room.code, user.id, target.user_id, from, target.nickname, now, room.lobbyDeadline, 'pending');
}
export function invitationsView(store, user, now) {
  expireInvitations(store, now);
  const rows = store.db.prepare(`SELECT * FROM invitations WHERE sender_id=? OR recipient_id=?
    ORDER BY created_at DESC, id DESC LIMIT 40`).all(user.id, user.id);
  return { invitations: rows.map(row => {
    const room = store.load(row.room_code);
    return { id: row.id, from: row.sender_nickname, to: row.recipient_nickname,
      incoming: row.recipient_id === user.id, status: row.status,
      topic: room.topic, difficulty: room.difficulty, stakeLuna: room.stakeLuna ?? 0, paymentNetwork: room.paymentNetwork ?? 'testalbatross', expiresAt: row.expires_at,
      ...(room.players.some(p => p.id === user.id) ? { roomCode: room.code } : {}) };
  }) };
}
export function invitationAction(store, user, id, action, now) {
  requireIdentity(store, user);
  expireInvitations(store, now);
  const row = store.db.prepare('SELECT * FROM invitations WHERE id=?').get(id);
  requireThat(row && (row.sender_id === user.id || row.recipient_id === user.id), 'INVITE_NOT_FOUND', 404);
  if (action === 'accept') {
    requireThat(row.recipient_id === user.id, 'INVITE_FORBIDDEN', 403);
    const room = store.load(row.room_code);
    if (row.status === 'accepted') return { room: roomView(room, user.id, now) };
    requireThat(row.status === 'pending', 'INVITE_CLOSED', 409);
    requireThat(!store.hasActiveRoom(user.id, room.code), 'ACTIVE_ROOM_EXISTS', 409);
    act(room, user, 'join', {}, now);
    store.db.prepare("UPDATE invitations SET status='accepted' WHERE id=?").run(id);
    store.save(room, 'invite_accepted');
    return { room: roomView(room, user.id, now) };
  }
  requireThat(action === 'decline' ? row.recipient_id === user.id : action === 'cancel' && row.sender_id === user.id, 'INVITE_FORBIDDEN', 403);
  if (['declined', 'cancelled', 'expired'].includes(row.status)) return { status: row.status };
  requireThat(row.status === 'pending', 'INVITE_CLOSED', 409);
  closeInvitation(store, row, action === 'decline' ? 'declined' : 'cancelled', now);
  return { status: action === 'decline' ? 'declined' : 'cancelled' };
}

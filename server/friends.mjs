import { requireThat } from './game.mjs';
import { nicknameOf, requireIdentity } from './identity.mjs';

export function friendsView(store, user) {
  requireIdentity(store, user);
  const now = store.clock();
  return { friends: store.db.prepare(`SELECT n.nickname,
    CASE WHEN NOT EXISTS (SELECT 1 FROM sessions s JOIN presence p ON p.token_hash=s.token_hash
      JOIN wallet_sessions w ON w.token_hash=s.token_hash
      WHERE s.user_id=f.friend_id AND s.expires_at>? AND p.last_seen>? AND p.last_seen<=?) THEN 'offline'
    WHEN EXISTS (SELECT 1 FROM rooms r JOIN room_members m ON m.code=r.code
      JOIN json_each(r.body, '$.players') player
      WHERE m.user_id=f.friend_id AND r.status IN ('starting','playing')
      AND json_extract(player.value, '$.id')=f.friend_id
      AND json_extract(player.value, '$.status') IN ('waiting','playing')) THEN 'playing'
    ELSE 'online' END AS status FROM friends f
    JOIN nicknames n ON n.user_id=f.friend_id WHERE f.user_id=?
    ORDER BY n.nickname COLLATE NOCASE`).all(now, now - 45000, now, user.id)
      .map(row => ({ nickname: row.nickname, status: row.status })) };
}

export function changeFriend(store, user, value, action) {
  requireIdentity(store, user);
  requireThat(action === 'add' || action === 'remove', 'INVALID_FRIEND_ACTION');
  const target = store.db.prepare('SELECT user_id FROM nicknames WHERE nickname=?').get(nicknameOf(value));
  requireThat(target, 'PLAYER_NOT_FOUND', 404);
  requireThat(target.user_id !== user.id, 'FRIEND_SELF');
  if (action === 'add') {
    const exists = store.db.prepare('SELECT 1 FROM friends WHERE user_id=? AND friend_id=?').get(user.id, target.user_id);
    if (!exists) {
      requireThat(store.db.prepare('SELECT count(*) AS n FROM friends WHERE user_id=?').get(user.id).n < 200, 'FRIEND_LIMIT', 409);
      store.db.prepare('INSERT INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(user.id, target.user_id, store.clock());
    }
  } else store.db.prepare('DELETE FROM friends WHERE user_id=? AND friend_id=?').run(user.id, target.user_id);
  return friendsView(store, user);
}

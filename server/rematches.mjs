import { requireThat } from './game.mjs';

export function syncRematches(store, room) {
  if (!room.rematchOf) return;
  if (room.status === 'lobby') {
    for (const p of room.players) store.db.prepare("UPDATE rematch_requests SET status='accepted' WHERE room_code=? AND recipient_id=? AND status='pending'").run(room.code, p.id);
  } else {
    store.db.prepare("UPDATE rematch_requests SET status=? WHERE room_code=? AND status='pending'")
      .run(room.reason === 'LOBBY_EXPIRED' ? 'expired' : 'cancelled', room.code);
  }
}

export function rematchesView(store, user, now) {
  const rows = store.db.prepare(`SELECT q.room_code, q.previous_code, r.body FROM rematch_requests q
    JOIN rooms r ON r.code=q.room_code WHERE q.recipient_id=? AND q.status='pending'
    ORDER BY r.created_at DESC LIMIT 20`).all(user.id);
  return { requests: rows.flatMap(row => {
    const room = JSON.parse(row.body);
    if (room.status !== 'lobby' || room.lobbyDeadline <= now) return [];
    const sender = room.players.find(p => p.id === room.ownerId);
    return [{ code: room.code, previousCode: row.previous_code, from: sender.name,
      topic: room.topic, difficulty: room.difficulty, capacity: room.capacity,
      stakeLuna: room.stakeLuna ?? 0, paymentNetwork: room.paymentNetwork ?? 'testalbatross', expiresAt: room.lobbyDeadline }];
  }) };
}

export function declineRematch(store, code, user) {
  const row = store.db.prepare('SELECT status FROM rematch_requests WHERE room_code=? AND recipient_id=?').get(code, user.id);
  requireThat(row, 'REMATCH_UNAVAILABLE', 403);
  if (row.status === 'declined') return { declined: true };
  const room = store.load(code);
  requireThat(row.status === 'pending' && room.status === 'lobby' && room.lobbyDeadline > store.clock(), 'REMATCH_CLOSED', 409);
  store.db.prepare("UPDATE rematch_requests SET status='declined' WHERE room_code=? AND recipient_id=?").run(code, user.id);
  room.status = 'cancelled'; room.reason = 'REMATCH_DECLINED'; room.closedAt = store.clock();
  // Preserve all funded members so normal payment settlement refunds each deposit.
  store.save(room, 'rematch_declined');
  return { declined: true };
}

import { requireThat } from './game.mjs';

export const ratingCategory = topic => ({ math: 'math', flags: 'geography', capitals: 'geography', chess: 'chess' })[topic] ?? null;

// Called inside the same transaction as the final game result. One ledger row per room.
export function settleRating(store, room) {
  if (!room.ranked || !room.matchmaking || room.rematchOf || room.status !== 'completed') return;
  const category = ratingCategory(room.topic);
  if (!category || room.players.length !== 2 || room.players.some(p => p.bot || !p.nickname)) return;
  const existing = store.db.prepare('SELECT body FROM rating_matches WHERE room_code=?').get(room.code);
  if (existing) { room.rating = JSON.parse(existing.body); return; }
  const [a, b] = room.players;
  const pair = [a.id, b.id].sort().join('/');
  const repeated = store.db.prepare('SELECT 1 FROM rating_matches WHERE pair=? AND category=? AND rated=1 AND created_at>?')
    .get(pair, category, room.closedAt - 86400000);
  const skipped = !room.winners.length ? 'no_result' : repeated ? 'repeat_pair' : null;
  const result = { category, status: skipped ?? 'rated', players: [] };
  if (!skipped) {
    const score = store.db.prepare('SELECT rating FROM ratings WHERE user_id=? AND category=?');
    const beforeA = score.get(a.id, category)?.rating ?? 1000, beforeB = score.get(b.id, category)?.rating ?? 1000;
    const outcome = room.winners.length === 2 ? 0.5 : room.winners.includes(a.id) ? 1 : 0;
    const delta = Math.round(32 * (outcome - 1 / (1 + 10 ** ((beforeB - beforeA) / 400))));
    result.players = [{ id: a.id, before: beforeA, delta, after: beforeA + delta },
      { id: b.id, before: beforeB, delta: -delta, after: beforeB - delta }];
    for (const p of result.players) {
      const draw = room.winners.length === 2 ? 1 : 0, win = !draw && room.winners.includes(p.id) ? 1 : 0;
      store.db.prepare(`INSERT INTO ratings VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(user_id, category) DO UPDATE SET rating=excluded.rating, games=games+1,
        wins=wins+excluded.wins, draws=draws+excluded.draws, losses=losses+excluded.losses`)
        .run(p.id, category, p.after, win, draw, 1 - win - draw);
    }
  }
  store.db.prepare('INSERT INTO rating_matches VALUES (?, ?, ?, ?, ?, ?)')
    .run(room.code, category, pair, room.closedAt, skipped ? 0 : 1, JSON.stringify(result));
  room.rating = result;
}

export function leaderboard(store, user, category) {
  requireThat(['math', 'geography', 'chess'].includes(category), 'INVALID_RATING_CATEGORY');
  const sql = `SELECT n.nickname, r.rating, r.games, r.wins, r.draws, r.losses,
    RANK() OVER (ORDER BY r.rating DESC) AS rank FROM ratings r JOIN nicknames n ON n.user_id=r.user_id WHERE r.category=?`;
  const players = store.db.prepare(`SELECT * FROM (${sql}) ORDER BY rating DESC, nickname LIMIT 50`).all(category);
  const me = user?.nickname ? store.db.prepare(`SELECT * FROM (${sql}) WHERE nickname=?`).get(category, user.nickname)
    ?? { nickname: user.nickname, rating: 1000, games: 0, wins: 0, draws: 0, losses: 0, rank: null } : null;
  return { category, players, me };
}

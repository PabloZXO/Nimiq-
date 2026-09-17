import { Stockfish } from './stockfish.mjs';
import { applyBotMove, engineFor } from './chess-game.mjs';
import { advance, voidRoom } from './game.mjs';

export class ChessRunner {
  constructor(store, engine = new Stockfish()) {
    this.store = store; this.engine = engine; this.pending = new Map(); this.hints = new Map(); this.closed = false;
  }
  current(code, fen, ply, revision) {
    if (this.closed) return false;
    const room = this.store.load(code);
    return room.status === 'playing' && room.chess?.fen === fen && room.chess.moves.length === ply && (room.chess.revision ?? 0) === revision && room.chess.botDueAt !== null;
  }
  schedule() {
    if (this.closed) return;
    const rows = this.store.db.prepare("SELECT body FROM rooms WHERE status='playing' AND json_extract(body, '$.topic')='chess' AND json_extract(body, '$.mode')='practice' ORDER BY created_at, code").all();
    for (const row of rows) {
      const room = JSON.parse(row.body), state = room.chess;
      if (this.pending.size + this.hints.size >= 16) break;
      if (room.difficulty === 'beginner' || state.botDueAt === null || state.botDueAt > this.store.clock() || this.pending.has(room.code)) continue;
      const code = room.code, fen = state.fen, ply = state.moves.length, revision = state.revision ?? 0;
      const current = () => this.current(code, fen, ply, revision);
      const job = this.engine.choose({ fen, difficulty: room.difficulty,
        moves: state.moves.map(m => m.from + m.to + (m.promotion ?? '')), current })
        .then(move => {
          if (!move || !current()) return;
          this.store.transaction(() => {
            const latest = this.store.load(code);
            applyBotMove(latest, move, fen, ply, this.store.clock());
            this.store.save(latest, 'bot_move');
          });
        }).catch(() => {
          // Never silently substitute the old weak bot or award a win on engine failure.
          if (!current()) return;
          this.store.transaction(() => {
            const latest = this.store.load(code);
            voidRoom(latest, this.store.clock(), 'CHESS_ENGINE_UNAVAILABLE');
            this.store.save(latest, 'bot_unavailable');
          });
        }).finally(() => this.pending.delete(code));
      this.pending.set(code, job);
    }
    for (const row of rows) {
      const room = JSON.parse(row.body), state = room.chess;
      if (this.hints.size + this.pending.size >= 16) break;
      if (state.hint?.status !== 'pending' || this.hints.has(room.code)) continue;
      const code = room.code, fen = state.fen, ply = state.moves.length, revision = state.revision ?? 0, requestedAt = state.hint.requestedAt;
      const current = () => {
        if (this.closed) return false;
        const latest = this.store.load(code);
        return latest.status === 'playing' && latest.mode === 'practice' && latest.chess.fen === fen && latest.chess.moves.length === ply
          && (latest.chess.revision ?? 0) === revision && latest.chess.hint?.status === 'pending' && latest.chess.hint.requestedAt === requestedAt;
      };
      const finish = move => {
        if (!current()) return;
        this.store.transaction(() => {
          const latest = this.store.load(code);
          advance(latest, this.store.clock());
          if (latest.status === 'playing') {
            const legal = move && engineFor(latest).moves({ verbose: true }).find(m => m.from === move.from && m.to === move.to && m.promotion === move.promotion);
            latest.chess.hint = { ...latest.chess.hint, status: legal ? 'ready' : 'error',
              move: legal ? { from: legal.from, to: legal.to, san: legal.san, ...(legal.promotion ? { promotion: legal.promotion } : {}) } : null };
          }
          this.store.save(latest, 'chess_hint');
        });
      };
      const job = this.engine.choose({ fen, difficulty: 'master', current,
        moves: state.moves.map(m => m.from + m.to + (m.promotion ?? '')) })
        .then(finish).catch(() => finish(null)).finally(() => this.hints.delete(code));
      this.hints.set(code, job);
    }
  }
  wait() { return Promise.all([...this.pending.values(), ...this.hints.values()]); }
  close() { this.closed = true; this.engine.close(); }
}

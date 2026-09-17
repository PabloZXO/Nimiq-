import { randomInt } from 'node:crypto';

// Only the explicit beginner level uses random legal moves.
// All higher levels run Stockfish in the separate engine process.
export function chooseBotMove(engine, random = randomInt) {
  const moves = engine.moves({ verbose: true });
  return moves.length ? moves[random(moves.length)] : null;
}

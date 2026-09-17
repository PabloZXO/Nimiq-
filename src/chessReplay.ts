import { Chess } from 'chess.js';

// Reconstruct from the complete legal history, including castling, en passant and promotion.
export function replayPositions(moves: { san: string }[]) {
  const engine = new Chess(), positions = [engine.fen()];
  for (const move of moves) { engine.move(move.san); positions.push(engine.fen()); }
  return positions;
}

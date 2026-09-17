import { Chess } from 'chess.js';
import legacy from './puzzle-catalog.json' with { type: 'json' };
import training from './puzzle-training.json' with { type: 'json' };

export const moveOf = code => ({ from: code.slice(0, 2), to: code.slice(2, 4), ...(code[4] ? { promotion: code[4] } : {}) });
export const trainingCatalog = training;
export const puzzlePools = Object.fromEntries(['easy', 'normal', 'hard'].map(level => [level, training.filter(p => p.difficulty === level)]));
const originals = new Map(legacy.map(p => [p.id, p]));
const byId = new Map(training.map(p => [p.id, p]));
const cache = new Map();

function mateChoices(node) {
  const engine = new Chess(node.fen);
  // Lichess allows multiple mating moves. Accept every immediate checkmate, not just the recorded move.
  for (const move of engine.moves({ verbose: true }).filter(m => m.san.endsWith('#'))) {
    const code = move.from + move.to + (move.promotion ?? '');
    if (node.choices[code]) continue;
    engine.move(move);
    node.choices[code] = { move: code, san: move.san, next: { fen: engine.fen(), choices: {} } };
    engine.undo();
  }
}
export function buildLine(puzzle) {
  const engine = new Chess(puzzle.fen);
  engine.move(moveOf(puzzle.moves[0])); // The export starts BEFORE the opponent's setup move.
  const root = { fen: engine.fen(), choices: {} }; let node = root;
  for (let i = 1; i < puzzle.moves.length; i += 2) {
    const key = puzzle.moves[i], move = engine.move(moveOf(key));
    const choice = { move: key, san: move.san };
    if (puzzle.moves[i + 1]) {
      choice.reply = puzzle.moves[i + 1]; choice.replySan = engine.move(moveOf(choice.reply)).san;
    }
    choice.next = { fen: engine.fen(), choices: {} };
    node.choices[key] = choice; mateChoices(node); node = choice.next;
  }
  if (!engine.isCheckmate()) throw Error('Invalid puzzle ending: ' + puzzle.id);
  return root;
}
export function getPuzzle(id) {
  if (originals.has(id)) return originals.get(id); // Old saved attempts still work.
  if (cache.has(id)) return cache.get(id);
  const puzzle = byId.get(id);
  if (!puzzle) throw Error('Unknown puzzle');
  const entry = { ...puzzle, tree: buildLine(puzzle) };
  if (cache.size >= 256) cache.delete(cache.keys().next().value);
  cache.set(id, entry);
  return entry;
}

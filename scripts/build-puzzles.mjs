// Original small-piece compositions. No external puzzle dataset is used.
import { Chess } from 'chess.js';
import { writeFileSync } from 'node:fs';

export const uci = move => move.from + move.to + (move.promotion ?? '');
export function solver(attacker) {
  const cache = new Map();
  function force(engine, plies) {
    const key = engine.fen().split(' ').slice(0, 4).join(' ') + '/' + plies;
    if (cache.has(key)) return cache.get(key);
    const moves = engine.moves({ verbose: true });
    if (!moves.length) return engine.isCheck() && engine.turn() !== attacker;
    if (plies <= 0 || engine.isInsufficientMaterial()) return false;
    const attack = engine.turn() === attacker;
    let result = !attack;
    for (const move of moves) {
      engine.move(move); const wins = force(engine, plies - 1); engine.undo();
      if (wins === attack) { result = attack; break; }
    }
    cache.set(key, result); return result;
  }
  return force;
}

export function buildTree(fen, mate) {
  const engine = new Chess(fen), attacker = engine.turn(), force = solver(attacker);
  if (!force(engine, mate * 2 - 1) || (mate > 1 && force(engine, mate * 2 - 3))) throw Error('Wrong mate distance: ' + fen);
  function tree(remaining) {
    const node = { fen: engine.fen(), choices: {} };
    for (const move of engine.moves({ verbose: true })) {
      engine.move(move);
      if (force(engine, remaining - 1)) {
        const choice = { move: uci(move), san: move.san };
        if (engine.isCheckmate()) choice.next = { fen: engine.fen(), choices: {} };
        else {
          // Choose the defense that delays mate longest. All defenses have been proved losing.
          let reply, distance = -1;
          for (const defense of engine.moves({ verbose: true })) {
            engine.move(defense);
            let d = 1; while (d < remaining - 2 && !force(engine, d)) d += 2;
            engine.undo();
            if (d > distance) { distance = d; reply = defense; }
          }
          engine.move(reply); choice.reply = uci(reply); choice.replySan = reply.san;
          choice.next = tree(remaining - 2); engine.undo();
        }
        node.choices[uci(move)] = choice;
      }
      engine.undo();
    }
    return node;
  }
  return tree(mate * 2 - 1);
}

if (process.argv[1]?.endsWith('build-puzzles.mjs')) {
  const seeds = [
    '7k/8/5KQ1/8/8/8/8/8 w - - 0 1',
    '6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1',
    '7k/8/5K2/8/4Q3/8/8/8 w - - 0 1',
    '7k/8/5K2/8/8/8/8/R7 w - - 0 1',
    '7k/8/4K3/8/4Q3/8/8/8 w - - 0 1',
    '7k/8/4K3/8/8/3Q4/8/8 w - - 0 1',
  ];
  const catalog = [];
  for (const [index, seed] of seeds.entries()) for (const mirror of [false, true]) for (const black of [false, true]) {
    const original = new Chess(seed), transformed = new Chess(); transformed.clear();
    for (const piece of original.board().flat().filter(Boolean)) {
      const file = 'abcdefgh'.indexOf(piece.square[0]), rank = Number(piece.square[1]);
      transformed.put({ type: piece.type, color: black ? piece.color === 'w' ? 'b' : 'w' : piece.color },
        'abcdefgh'[mirror ? 7 - file : file] + (black ? 9 - rank : rank));
    }
    const fen = transformed.fen().split(' ')[0] + (black ? ' b' : ' w') + ' - - 0 1';
    const mate = Math.floor(index / 2) + 1;
    catalog.push({ id: `original-${index + 1}-${Number(mirror)}${Number(black)}`, mate, tree: buildTree(fen, mate) });
    console.log('built', catalog.at(-1).id, 'mate', mate);
  }
  writeFileSync('server/puzzle-catalog.json', JSON.stringify(catalog) + '\n');
}

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import levels from '../shared/chess-levels.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const engineScript = join(dirname(require.resolve('stockfish')), 'bin', 'stockfish-19-lite-single.js');

// A single persistent, single-threaded child owns the CPU-heavy WASM engine.
// Jobs are serialized; no engine work runs on the HTTP/game-clock event loop.
export class Stockfish {
  constructor({ script = engineScript } = {}) {
    this.script = script; this.child = null; this.waiters = new Set(); this.closed = false;
    this.tail = Promise.resolve();
  }
  fail(error, child = this.child) {
    if (child !== this.child) return;
    this.child = null;
    for (const waiter of [...this.waiters]) waiter.reject(error);
    child?.kill();
  }
  waitFor(match, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('CHESS_ENGINE_TIMEOUT')), timeoutMs);
      const finish = fn => value => { clearTimeout(timer); this.waiters.delete(waiter); fn(value); };
      const waiter = { match, resolve: finish(resolve), reject: finish(reject) };
      this.waiters.add(waiter);
    });
  }
  send(command) {
    if (!this.child?.stdin.writable) throw new Error('CHESS_ENGINE_UNAVAILABLE');
    this.child.stdin.write(command + '\n');
  }
  async start() {
    if (this.closed) throw new Error('CHESS_ENGINE_CLOSED');
    if (this.child) return;
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    const child = spawn(process.execPath, [this.script], { windowsHide: true, env, stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    child.on('error', () => this.fail(new Error('CHESS_ENGINE_UNAVAILABLE'), child));
    child.on('exit', () => this.fail(new Error('CHESS_ENGINE_EXITED'), child));
    child.stdin.on('error', () => this.fail(new Error('CHESS_ENGINE_UNAVAILABLE'), child));
    const lines = createInterface({ input: child.stdout });
    child.once('close', () => lines.close());
    lines.on('line', line => {
      if (child !== this.child) return;
      for (const waiter of [...this.waiters]) if (waiter.match(line)) waiter.resolve(line);
    });
    const initialized = this.waitFor(line => line === 'uciok', 10000);
    this.send('uci'); await initialized;
    this.send('setoption name Hash value 32');
    this.send('setoption name UCI_LimitStrength value false');
    const ready = this.waitFor(line => line === 'readyok', 10000);
    this.send('isready'); await ready;
  }
  choose({ fen, moves, difficulty, current = () => true }) {
    const work = async () => {
      if (!current()) return null;
      const level = typeof difficulty === 'string' && Object.hasOwn(levels, difficulty) ? levels[difficulty] : null;
      if (!level || level.skill === null) throw new Error('INVALID_DIFFICULTY');
      // Only server-built FEN / UCI moves may reach this protocol boundary.
      if (typeof fen !== 'string' || /[\r\n]/.test(fen) || fen.length > 120) throw new Error('CHESS_INVALID_POSITION');
      if (moves && (!Array.isArray(moves) || moves.some(move => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)))) throw new Error('CHESS_INVALID_POSITION');
      await this.start();
      if (!current()) return null;
      this.send('ucinewgame');
      this.send(`setoption name Skill Level value ${level.skill}`);
      const ready = this.waitFor(line => line === 'readyok', 5000);
      this.send('isready'); await ready;
      this.send(moves ? `position startpos${moves.length ? ' moves ' + moves.join(' ') : ''}` : `position fen ${fen}`);
      const result = this.waitFor(line => line.startsWith('bestmove '), level.moveMs + 5000);
      this.send(`go movetime ${level.moveMs}`);
      const move = (await result).split(/\s+/)[1];
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) throw new Error('CHESS_ENGINE_INVALID_MOVE');
      return { from: move.slice(0, 2), to: move.slice(2, 4), ...(move.length === 5 ? { promotion: move[4] } : {}) };
    };
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
  close() { this.closed = true; this.fail(new Error('CHESS_ENGINE_CLOSED')); }
}

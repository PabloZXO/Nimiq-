import type { Room } from './types';

export type Sound = 'tap' | 'start' | 'move' | 'capture' | 'check' | 'correct' | 'wrong' | 'finish' | 'win' | 'undo';
const key = 'nimduel-sound';
let enabled = true;
try { enabled = localStorage.getItem(key) !== 'off'; } catch { /* Optional preference. */ }
let context: AudioContext | null = null;
const active = new Set<OscillatorNode>();
let lastPlayed = -Infinity;
export function soundEnabled() { return enabled; }
export function silence() {
  for (const oscillator of active) { try { oscillator.stop(); } catch { /* Already ended. */ } }
  active.clear();
}
export function setSoundEnabled(value: boolean) {
  enabled = value;
  try { localStorage.setItem(key, value ? 'on' : 'off'); } catch { /* Optional preference. */ }
  if (!value) silence();
}
// Called only from a trusted tap/keypress. Unsupported or blocked audio never interrupts a game.
export function unlockSound() {
  if (!enabled || document.visibilityState !== 'visible') return;
  try {
    const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state === 'suspended') void context.resume().catch(() => {});
  } catch { /* Audio is optional. */ }
}
const notes: Record<Sound, number[]> = {
  tap: [440], start: [392, 523], move: [280], capture: [220, 330], check: [440, 587],
  correct: [660], wrong: [196], finish: [330, 262], win: [523, 659, 784], undo: [330, 247],
};
export function playSound(sound: Sound) {
  if (!enabled || document.visibilityState !== 'visible' || context?.state !== 'running') return;
  const now = performance.now();
  if (now - lastPlayed < 90) return;
  lastPlayed = now;
  try {
    silence();
    const start = context.currentTime;
    notes[sound].forEach((frequency, index) => {
      const oscillator = context!.createOscillator(), gain = context!.createGain();
      const at = start + index * .075, duration = sound === 'tap' || sound === 'move' ? .055 : .105;
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(sound === 'tap' ? .018 : .035, at + .008);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      oscillator.connect(gain); gain.connect(context!.destination); active.add(oscillator);
      oscillator.onended = () => { active.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at); oscillator.stop(at + duration + .01);
    });
  } catch { /* No gameplay dependency on the audio device. */ }
}

// Only new server-confirmed events make sounds: no polling, reload or replay chatter.
export function roomSound(previous: Room | null, next: Room): Sound | null {
  if (!previous || previous.code !== next.code) return null;
  if (next.status === 'completed' && previous.status !== 'completed')
    return next.winners.includes(next.me.id) && next.winners.length === 1 ? 'win' : 'finish';
  if (next.status === 'playing' && previous.status !== 'playing') return 'start';
  if (next.status !== 'playing') return null;
  if (next.topic === 'chess' && next.chess && previous.chess) {
    if (next.chess.moves.length < previous.chess.moves.length) return 'undo';
    if (next.chess.moves.length > previous.chess.moves.length) {
      const san = next.chess.moves.at(-1)!.san;
      return next.chess.inCheck ? 'check' : san.includes('x') ? 'capture' : 'move';
    }
  } else if (next.topic === 'puzzles' && next.puzzle && previous.puzzle) {
    if (next.puzzle.misses > previous.puzzle.misses) return 'wrong';
    if (next.puzzle.ply > previous.puzzle.ply) return 'correct';
  } else if ((next.me.answered ?? 0) > (previous.me.answered ?? 0) && next.feedback && !next.feedback.skipped)
    return next.feedback.correct ? 'correct' : 'wrong';
  return null;
}

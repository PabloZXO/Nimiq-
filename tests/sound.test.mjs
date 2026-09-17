import test from 'node:test';
import assert from 'node:assert/strict';
import { roomSound, playSound, unlockSound, setSoundEnabled, silence } from '../src/sound.ts';

const base = { code: 'ABC', topic: 'chess', status: 'playing', me: { id: 'me', answered: 0 }, winners: [], chess: { moves: [], inCheck: false } };
test('sound events are quiet on polling/reload/replay and distinguish gameplay transitions', () => {
  assert.equal(roomSound(null, base), null); assert.equal(roomSound(base, structuredClone(base)), null);
  assert.equal(roomSound(base, { ...base, code: 'NEW' }), null);
  const played = { ...base, chess: { moves: [{ san: 'e4' }], inCheck: false } };
  assert.equal(roomSound(base, played), 'move'); assert.equal(roomSound(played, base), 'undo');
  assert.equal(roomSound(base, { ...played, chess: { moves: [{ san: 'Qxh7+' }], inCheck: true } }), 'check');
  assert.equal(roomSound(base, { ...played, chess: { moves: [{ san: 'exd5' }], inCheck: false } }), 'capture');
  const end = { ...played, status: 'completed', winners: ['me'] };
  assert.equal(roomSound(played, end), 'win'); assert.equal(roomSound(end, structuredClone(end)), null);
  assert.equal(roomSound({ ...base, status: 'starting' }, base), 'start');
  for (const topic of ['math','flags','capitals','mixed']) {
    const quiz = { ...base, topic }, correct = { ...quiz, me: { id: 'me', answered: 1 }, feedback: { correct: true } };
    assert.equal(roomSound(quiz,correct),'correct');
    assert.equal(roomSound(quiz,{ ...correct, feedback: { correct: false } }),'wrong');
    assert.equal(roomSound(quiz,{ ...correct, feedback: { skipped: true } }),null);
  }
  const puzzle = { ...base, topic: 'puzzles', puzzle: { ply: 0, misses: 0 } };
  assert.equal(roomSound(puzzle,{ ...puzzle,puzzle:{ply:0,misses:1} }),'wrong');
  assert.equal(roomSound(puzzle,{ ...puzzle,puzzle:{ply:1,misses:0} }),'correct');
});
test('audio waits for interaction, remains quiet when muted or hidden, and uses short low-volume tones', () => {
  let created=0,started=0,stopped=0; const gains=[],ends=[];
  globalThis.document={visibilityState:'visible'};
  globalThis.window={AudioContext:class {
    constructor(){created++;this.state='running';this.currentTime=0;this.destination={};}
    createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},disconnect(){},start(){started++;},stop(at){stopped++;if(at!==undefined)ends.push(at);}};}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(v){gains.push(v);},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }};
  setSoundEnabled(true);playSound('win');assert.equal(created,0);assert.equal(started,0);
  unlockSound();playSound('win');assert.equal(started,3);assert.ok(Math.max(...gains)<=.035);assert.ok(Math.max(...ends)<.3);
  setSoundEnabled(false);assert.ok(stopped>=6);playSound('move');assert.equal(started,3);
  setSoundEnabled(true);document.visibilityState='hidden';playSound('win');assert.equal(started,3);silence();
  delete globalThis.document;delete globalThis.window;
});

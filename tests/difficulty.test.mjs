import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { Store } from '../server/store.mjs';
import { arithmetic, questionDeck } from '../server/questions.mjs';
import { chooseBotMove } from '../server/chess-bot.mjs';
import { familiarCountries, flagSimilarity, regionOf } from '../server/geography-levels.mjs';
import { countryCodes } from '../shared/capitals.mjs';
import { languages, messages } from '../src/i18n.ts';

test('standard levels persist and expose translated labels; other games reject chess-only levels', () => {
  const store = new Store(':memory:');
  try {
    for (const topic of ['math', 'flags', 'capitals', 'chess']) for (const difficulty of ['easy', 'normal', 'hard']) {
      const user = store.createSession(`${topic}-${difficulty}`).user;
      const view = store.create(user, { topic, difficulty, language: 'en', mode: 'practice' });
      assert.equal(view.difficulty, difficulty);
      assert.equal(store.load(view.code).difficulty, difficulty);
      store.action(view.code, user, topic === 'chess' ? 'resign' : 'finish', {});
      for (const language of Object.keys(languages)) {
        assert.ok(messages[language][difficulty]);
        assert.ok(messages[language][`${topic}Level_${difficulty}`]);
      }
    }
    assert.throws(() => store.create(store.createSession('invalid').user, { topic: 'flags', difficulty: 'expert', language: 'en', mode: 'practice' }), /INVALID_DIFFICULTY/);
  } finally { store.close(); }
});
test('easy arithmetic has small operands and multiplication no greater than 25', () => {
  for (let i = 0; i < 400; i++) {
    const q = arithmetic(i, 'easy'), [a, op, b] = q.prompt.split(' ');
    assert.equal(Number(q.answer), op === '+' ? +a + +b : op === '−' ? +a - +b : op === '×' ? +a * +b : +a / +b);
    if (op === '×') { assert.ok(+a <= 5 && +b <= 5); assert.ok(+q.answer <= 25); }
    if (op === '+') assert.ok(+q.answer <= 20);
  }
});
test('geography levels keep full coverage on medium/hard and unique questions on easy', () => {
  assert.ok(countryCodes.every(c => regionOf(c) >= 0));
  for (const topic of ['flags', 'capitals']) for (const difficulty of ['easy', 'normal', 'hard']) for (const lang of Object.keys(languages)) {
    const count = difficulty === 'easy' ? 30 : topic === 'flags' ? 195 : 194;
    const seen = new Set();
    for (const q of questionDeck(topic, difficulty, lang, count)) {
      const answer = q.options.find(o => o.id === q.answer), code = q.countryCode ?? answer.countryCode;
      assert.equal(new Set(q.options.map(o => o.label)).size, 4);
      assert.equal(answer.label, q.answerLabel); seen.add(code);
      if (difficulty === 'easy') assert.ok(familiarCountries.includes(code));
      if (topic === 'capitals') assert.notEqual(code, 'ZA');
      if (topic === 'flags' && difficulty === 'hard') {
        const wrong = q.options.filter(o => o.id !== q.answer);
        const omitted = countryCodes.filter(c => !q.options.some(o => o.countryCode === c));
        assert.ok(wrong.every(o => omitted.every(c => flagSimilarity(code, o.countryCode) >= flagSimilarity(code, c))));
      }
      if (topic === 'capitals' && difficulty === 'hard') {
        assert.ok(q.options.every(o => regionOf(o.capitalId.slice(0, 2)) === regionOf(code)));
      }
    }
    assert.equal(seen.size, count);
  }
});
test('beginner bot returns a legal move without mutating the position or repetition history', () => {
  const engine = new Chess(); engine.move('e4'); engine.move('e5');
  const fen = engine.fen(), history = engine.history();
  const move = chooseBotMove(engine, () => 0);
  assert.equal(move.san, engine.moves()[0]); assert.equal(engine.fen(), fen); assert.deepEqual(engine.history(), history);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { capitals, countryCodes } from '../shared/capitals.mjs';
import assets from '../server/flag-assets.json' with { type: 'json' };
import { questionDeck, publicQuestion } from '../server/questions.mjs';
import { act, createRoom, roomView } from '../server/game.mjs';
import { capitalLabel, capitalPrompt, countryLabel, languages } from '../src/i18n.ts';

test('195 unique country flags are local, content-addressed SVGs; capitals exclude South Africa', () => {
  assert.equal(countryCodes.length, 195);
  assert.equal(new Set(countryCodes).size, 195);
  assert.deepEqual(Object.keys(assets).sort(), [...countryCodes].sort());
  assert.ok(countryCodes.includes('ZA'));
  assert.equal(new Set(capitals.map(c => c.countryCode)).size, 194);
  assert.equal(capitals.length, 196);
  assert.ok(!capitals.some(c => c.countryCode === 'ZA'));
  for (const path of Object.values(assets)) {
    const raw = readFileSync(new URL(`../public${path}`, import.meta.url));
    assert.equal(path, `/flags/${createHash('sha256').update(raw).digest('hex').slice(0,20)}.svg`);
    const svg = raw.toString();
    assert.match(svg, /<svg\b/);
    assert.doesNotMatch(svg, /<(?:script|foreignObject|iframe|image)\b|\bon\w+\s*=/i);
    assert.doesNotMatch(svg, /(?:href\s*=\s*["'](?:https?:|\/\/)|url\(\s*["']?https?:)/i);
  }
});

test('complete country coverage and distinct valid choices in every language, without repeats within a round', () => {
  for (const lang of Object.keys(languages)) for (const topic of ['flags', 'capitals']) {
    const count = topic === 'flags' ? 195 : 194;
    const deck = questionDeck(topic, 'normal', lang, count);
    const seen = new Set();
    for (const q of deck) {
      assert.equal(q.kind, topic);
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options.map(o => o.id)).size, 4);
      assert.equal(new Set(q.options.map(o => o.label)).size, 4);
      const answer = q.options.find(o => o.id === q.answer);
      assert.equal(answer.label, q.answerLabel);
      assert.equal(Object.hasOwn(publicQuestion(q), 'answer'), false);
      assert.equal(Object.hasOwn(publicQuestion(q), 'answerLabel'), false);
      seen.add(topic === 'flags' ? answer.countryCode : q.countryCode);
      if (topic === 'capitals') {
        assert.notEqual(q.countryCode, 'ZA');
        assert.ok(capitalPrompt(q, lang));
        for (const option of q.options) {
          const capital = capitals.find(c => c.id === option.capitalId);
          assert.equal(option.label, capital.names[lang]);
          if (option.id !== q.answer) assert.notEqual(capital.countryCode, q.countryCode);
          for (const displayLang of Object.keys(languages)) {
            assert.equal(capitalLabel(option.label, displayLang), capital.names[displayLang]);
          }
        }
      } else {
        assert.equal(q.visual.src, assets[answer.countryCode]);
        assert.equal(countryLabel(answer.label, lang, answer.countryCode), answer.label);
      }
    }
    assert.equal(seen.size, count);
  }
});

test('capital exceptions are explicit and every city is translated in six languages', () => {
  for (const capital of capitals) {
    assert.deepEqual(Object.keys(capital.names), Object.keys(languages));
    assert.ok(Object.values(capital.names).every(n => n.trim()));
  }
  const get = id => capitals.find(c => c.id === id);
  assert.equal(get('GQ').names.en, 'Ciudad de la Paz');
  assert.equal(get('NR').role, 'governmentDistrict');
  assert.equal(get('CH').role, 'federalCity');
  assert.equal(get('BO').role, 'constitutional');
  assert.equal(get('BO-seat').role, 'governmentSeat');
  assert.equal(get('SZ-legislative').role, 'royalLegislative');
  assert.equal(get('LK').role, 'legislative');
});

test('capital practice validates opaque choices, scores correctly and translates completed reviews', () => {
  const user = { id: 'capital-player', name: 'Player' };
  const room = createRoom(user, { topic: 'capitals', language: 'uk', difficulty: 'normal', mode: 'practice' }, 1000);
  act(room, user, 'ready', { rulesVersion: room.rulesVersion }, 1000);
  act(room, user, 'start', {}, 1000);
  const first = room.players[0].questions[0];
  assert.throws(() => act(room, user, 'answer', { questionId: first.id, value: first.answerLabel, requestId: randomUUID() }, 1001), /INVALID_ANSWER/);
  for (let i = 0; i < 3; i++) {
    const q = room.players[0].questions[i];
    const value = i === 0 ? q.answer : i === 1 ? q.options.find(o => o.id !== q.answer).id : null;
    act(room, user, 'answer', { questionId: q.id, value, requestId: randomUUID() }, 1002 + i);
  }
  assert.equal(room.players[0].score, 0);
  act(room, user, 'finish', {}, 1006);
  const view = roomView(room, user.id, 1006);
  assert.equal(view.status, 'completed');
  assert.equal(view.review.length, 3);
  assert.equal(view.review[0].submitted, first.answerLabel);
  assert.equal(view.review[2].submitted, null);
  assert.ok(capitalLabel(view.review[0].answer, 'de'));
});

test('group capital rounds hide results until everyone finishes, including late starters', () => {
  const users = Array.from({ length: 3 }, (_, i) => ({ id: `player-${i}`, name: `Player ${i}` }));
  const room = createRoom(users[0], { topic: 'capitals', language: 'es', difficulty: 'normal', mode: 'friends', capacity: 3 }, 1000);
  for (const user of users.slice(1)) act(room, user, 'join', {}, 1000);
  for (const user of users) act(room, user, 'ready', { rulesVersion: room.rulesVersion }, 1000);
  for (const [i, user] of users.entries()) {
    act(room, user, 'start', {}, 1001 + i * 30000);
    const q = room.players[i].questions[0];
    act(room, user, 'answer', { questionId: q.id, value: q.answer, requestId: randomUUID() }, 1002 + i * 30000);
    if (i < 2) assert.deepEqual(roomView(room, user.id, 1002 + i * 30000).review, []);
    act(room, user, 'finish', {}, 1003 + i * 30000);
  }
  assert.equal(room.status, 'completed');
  assert.deepEqual([...room.winners].sort(), users.map(u => u.id).sort());
});

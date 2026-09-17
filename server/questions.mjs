import { familiarCountries, flagSimilarity, regionOf } from './geography-levels.mjs';
import { randomInt, randomUUID } from 'node:crypto';

import { capitals, countryCodes } from '../shared/capitals.mjs';
import flagAssets from './flag-assets.json' with { type: 'json' };

function shuffle(items) {
  const values = [...items];
  for (let i = values.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

export function arithmetic(index, difficulty = 'normal') {
  const large = difficulty === 'hard', easy = difficulty === 'easy';
  const a = randomInt(large ? 20 : 2, large ? 100 : easy ? 11 : 21);
  const b = randomInt(2, large ? 20 : easy ? 6 : 13);
  const operation = index % 4;
  const values = [
    [`${a} + ${b}`, a + b],
    [`${a + b} − ${b}`, a],
    [`${large ? a : b} × ${large ? b : randomInt(2, easy ? 6 : 10)}`, 0],
    [`${a * b} ÷ ${b}`, a],
  ];
  const [prompt, result] = values[operation];
  const answer = operation === 2 ? prompt.split(' × ').map(Number).reduce((x, y) => x * y) : result;
  return { id: randomUUID(), kind: 'math', prompt, answer: String(answer) };
}

export function questionDeck(topic, difficulty, language, count = 30) {
  if (topic === 'mixed') {
    const topics = ['math', 'flags', 'capitals'];
    const decks = topics.map((kind, i) => questionDeck(kind, difficulty, language, Math.floor(count / 3) + (i < count % 3 ? 1 : 0)));
    // Same topic cadence for every player, including those who do not reach question 30.
    return Array.from({ length: count }, (_, i) => decks[i % 3][Math.floor(i / 3)]);
  }
  if (topic === 'math') return Array.from({ length: count }, (_, i) => arithmetic(i, difficulty));
  const names = new Intl.DisplayNames([language], { type: 'region' });
  // Capitals cycle through countries, so countries with multiple seats are not overrepresented.
  const available = topic === 'flags' ? countryCodes : countryCodes.filter(code => capitals.some(c => c.countryCode === code));
  const pool = difficulty === 'easy' ? available.filter(code => familiarCountries.includes(code)) : available;
  const order = shuffle(pool);
  return Array.from({ length: count }, (_, i) => {
    const code = order[i % order.length];
    if (topic === 'flags') {
      const distractors = shuffle(pool.filter(c => c !== code));
      if (difficulty !== 'normal') distractors.sort((a, b) => (flagSimilarity(code, b) - flagSimilarity(code, a)) * (difficulty === 'hard' ? 1 : -1));
      const options = shuffle([code, ...distractors.slice(0, 3)])
        .map(countryCode => ({ id: randomUUID(), label: names.of(countryCode), countryCode }));
      return { id: randomUUID(), kind: 'flags', visual: { type: 'image', src: flagAssets[code] },
        options, answer: options.find(o => o.countryCode === code).id, answerLabel: names.of(code) };
    }
    const entries = capitals.filter(c => c.countryCode === code);
    const target = difficulty === 'easy' ? entries[0] : shuffle(entries)[0];
    // Never offer another seat of the same country, or a duplicate city name, as a wrong answer.
    // Jerusalem and East Jerusalem are also kept out of each other's distractors.
    const candidates = shuffle(capitals.filter(c => pool.includes(c.countryCode) && c.countryCode !== code &&
      !(['IL', 'PS'].includes(code) && ['IL', 'PS'].includes(c.countryCode))));
    if (difficulty !== 'normal') candidates.sort((a, b) => (Number(regionOf(b.countryCode) === regionOf(code)) - Number(regionOf(a.countryCode) === regionOf(code))) * (difficulty === 'hard' ? 1 : -1));
    const choices = [target];
    for (const candidate of candidates) {
      if (choices.every(c => c.names[language] !== candidate.names[language])) choices.push(candidate);
      if (choices.length === 4) break;
    }
    const options = shuffle(choices).map(c => ({ id: randomUUID(), label: c.names[language], capitalId: c.id }));
    return { id: randomUUID(), kind: 'capitals', countryCode: code, capitalRole: target.role,
      options, answer: options.find(o => o.capitalId === target.id).id, answerLabel: target.names[language] };
  });
}

// Reuse the exercise, never its public identifiers or option positions.
export function retryQuestion(question) {
  const copy = structuredClone(question);
  copy.id = randomUUID();
  if (copy.options) {
    copy.options = shuffle(copy.options).map(option => {
      const id = randomUUID();
      if (option.id === question.answer) copy.answer = id;
      return { ...option, id };
    });
  }
  return copy;
}

export function publicQuestion(question) {
  if (!question) return null;
  const { answer, answerLabel, ...safe } = question;
  return safe;
}

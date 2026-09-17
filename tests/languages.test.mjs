import test from 'node:test';
import assert from 'node:assert/strict';
import { messages, languages, resolveLanguage, countryLabel, errorText } from '../src/i18n.ts';
import { Store } from '../server/store.mjs';
import { questionDeck } from '../server/questions.mjs';
import { challengeMessage, messageDigest, verifyWalletSignature } from '../server/wallet-auth.mjs';
import { KeyPair } from '@nimiq/core';

test('six complete languages; saved choice overrides host, regional language tags are recognized', () => {
  assert.deepEqual(Object.keys(languages), ['en','es','fr','de','pt','uk']);
  for (const code of Object.keys(languages)) {
    assert.deepEqual(Object.keys(messages[code]).sort(), Object.keys(messages.en).sort());
    assert.ok(Object.values(messages[code]).every(value => typeof value === 'string' && value.trim()));
    assert.equal(errorText(new Error('DEPOSIT_REQUIRED'), code), messages[code].error_DEPOSIT_REQUIRED);
  }
  assert.equal(resolveLanguage('es', 'de', 'uk'), 'es');
  assert.equal(resolveLanguage(null, 'pt-BR', 'en'), 'pt');
  assert.equal(resolveLanguage('invalid', 'fr-FR', 'en'), 'fr');
  assert.equal(resolveLanguage(null, null, 'de-DE'), 'de');
  assert.equal(resolveLanguage(null, 'ja', 'zh'), 'en');
});
test('all six languages create flag rounds with matching country labels and localized reviews', () => {
  const store = new Store(':memory:');
  try {
    for (const language of Object.keys(languages)) {
      const session = store.createSession(language);
      const room = store.create(session.user, { topic: 'flags', difficulty: 'normal', language, mode: 'practice' });
      const names = new Intl.DisplayNames([language], { type: 'region' });
      for (const option of room.question.options) assert.equal(option.label, names.of(option.countryCode));
      const q = store.load(room.code).players[0].questions[0];
      assert.equal(q.options.find(o => o.id === q.answer).label, q.answerLabel);
      assert.equal(countryLabel('Germany', language, 'DE'), names.of('DE'));
      assert.equal(countryLabel('Німеччина', language), names.of('DE'));
      assert.ok(questionDeck('flags','normal',language).every(q => q.options.some(o => o.id === q.answer)));
    }
    assert.throws(() => store.create(store.createSession('bad').user, { topic: 'flags', difficulty: 'normal', language: '__proto__', mode: 'practice' }), /INVALID_LANGUAGE/);
  } finally { store.close(); }
});
test('localized signing messages preserve UTF-8 signature verification in every language', () => {
  const key = KeyPair.generate(), pub = key.publicKey, addr = key.toAddress();
  try {
    for (const language of Object.keys(languages)) {
      const message = challengeMessage({ id: 'a'.repeat(64), address: addr.toUserFriendlyAddress(), origin: 'https://example.test', issuedAt: Date.now(), expiresAt: Date.now()+300000, language });
      assert.ok(message.startsWith(messages[language].signInTitle));
      const signature = key.sign(messageDigest(message));
      try { assert.equal(verifyWalletSignature(message, addr.toUserFriendlyAddress(), { publicKey: pub.toHex(), signature: signature.toHex() }), addr.toUserFriendlyAddress()); }
      finally { signature.free(); }
    }
  } finally { addr.free(); pub.free(); key.free(); }
});

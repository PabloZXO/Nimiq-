import { KeyPair } from '@nimiq/core';
import { messageDigest } from '../../server/wallet-auth.mjs';

// Real cryptographic authentication for isolated fixtures; no production keys or funds.
export function identify(store, session, nickname, origin = 'http://localhost:5173') {
  const key = KeyPair.generate(), address = key.toAddress(), publicKey = key.publicKey;
  let signature;
  try {
    const challenge = store.walletChallenge(session.user, session.token, origin, { address: address.toUserFriendlyAddress(), language: 'en' });
    signature = key.sign(messageDigest(challenge.message));
    const verified = store.verifyWallet(session.user, session.token, origin, { challengeId: challenge.id, publicKey: publicKey.toHex(), signature: signature.toHex() });
    return { ...verified, user: nickname ? store.claimNickname(verified.user, nickname) : verified.user };
  } finally { signature?.free(); publicKey.free(); address.free(); key.free(); }
}

import { createHash } from 'node:crypto';
import { Address, PublicKey, Signature } from '@nimiq/core';
import { GameError, requireThat } from './game.mjs';
import messages from '../shared/locales.json' with { type: 'json' };

export const CHALLENGE_TTL_MS = 5 * 60_000;
export const WALLET_SESSION_TTL_MS = 24 * 60 * 60_000;

export function canonicalAddress(value) {
  requireThat(typeof value === 'string' && value.length <= 64, 'INVALID_WALLET_ADDRESS');
  let address;
  try { address = Address.fromString(value); return address.toUserFriendlyAddress(); }
  catch { throw new GameError('INVALID_WALLET_ADDRESS'); }
  finally { address?.free(); }
}

export function challengeMessage({ id, address, origin, issuedAt, expiresAt, language }) {
  const { signInTitle: title, signInPurpose: purpose } = messages[language] ?? messages.en;
  return [title, '', purpose, '', `Origin: ${origin}`, `Address: ${address}`, `Nonce: ${id}`,
    `Issued at: ${new Date(issuedAt).toISOString()}`, `Expires at: ${new Date(expiresAt).toISOString()}`,
    'Purpose: nimduel-wallet-login-v1'].join('\n');
}

export function messageDigest(message) {
  const bytes = Buffer.from(message, 'utf8');
  // Nimiq WalletAccount::prepare_message_for_signature uses UTF-8 BYTE length.
  return createHash('sha256').update('\x16Nimiq Signed Message:\n').update(String(bytes.length)).update(bytes).digest();
}

export function verifyWalletSignature(message, address, proof) {
  requireThat(proof && typeof proof.publicKey === 'string' && /^(?:0x)?[a-fA-F0-9]{64}$/.test(proof.publicKey), 'INVALID_SIGNATURE');
  requireThat(typeof proof.signature === 'string' && /^(?:0x)?[a-fA-F0-9]{128}$/.test(proof.signature), 'INVALID_SIGNATURE');
  let key; let signature; let derived;
  try {
    key = PublicKey.fromHex(proof.publicKey.replace(/^0x/, ''));
    signature = Signature.fromHex(proof.signature.replace(/^0x/, ''));
    derived = key.toAddress();
    requireThat(derived.toUserFriendlyAddress() === address, 'WALLET_ADDRESS_MISMATCH', 403);
    requireThat(key.verify(signature, messageDigest(message)), 'INVALID_SIGNATURE', 403);
    return address;
  } catch (error) {
    if (error instanceof GameError) throw error;
    throw new GameError('INVALID_SIGNATURE', 403);
  } finally { derived?.free(); key?.free(); signature?.free(); }
}

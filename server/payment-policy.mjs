import { paymentNetwork, roomNetwork } from './payment-network.mjs';
import { createHash } from 'node:crypto';
import { requireThat } from './game.mjs';
import { canonicalAddress } from './wallet-auth.mjs';
import { HashedTimeLockedContract } from '@nimiq/core';

export const TESTNET_ID = 5;
export const TESTNET_NAME = 'testalbatross';
export const PAYMENT_RULES_VERSION = 'test-nim-v1';
export const MAX_STAKE_LUNA = 10_000_000;

function amount(value) {
  requireThat(Number.isSafeInteger(value) && value > 0, 'INVALID_PAYMENT_AMOUNT');
  return value;
}

export function paymentMemo(intentId) {
  requireThat(typeof intentId === 'string' && /^[a-f0-9]{32}$/.test(intentId), 'INVALID_PAYMENT_INTENT');
  return `NimDuel:${intentId}`;
}

// Only call for independently verified chain evidence, never browser-supplied transactions.
// Nimiq Pay can pay from an HTLC with an early-resolve proof signed by its creator.
// Refund that creator, never the spent contract address or the co-signing service.
export function depositSender(tx) {
  if (tx.senderType === 'basic') return canonicalAddress(tx.sender);
  requireThat(tx.senderType === 'htlc', 'UNSUPPORTED_PAYMENT_TYPE');
  const raw = tx.proof?.raw;
  requireThat(typeof raw === 'string' && /^(?:[a-f0-9]{2})+$/i.test(raw) && raw.length <= 8192, 'UNSUPPORTED_PAYMENT_TYPE');
  let proof;
  try { proof = HashedTimeLockedContract.proofToPlain(Buffer.from(raw, 'hex')); }
  catch { requireThat(false, 'UNSUPPORTED_PAYMENT_TYPE'); }
  requireThat(proof.type === 'early-resolve', 'UNSUPPORTED_PAYMENT_TYPE');
  return canonicalAddress(proof.creator);
}

// The caller must obtain tx through the independently synced Nimiq light client.
// A transaction supplied by the browser must never be passed here as chain evidence.
export function classifyDeposit(tx, intent, finalizedHeight) {
  requireThat(tx.network === paymentNetwork(intent.network).name, 'WRONG_PAYMENT_NETWORK');
  requireThat(tx.state === 'confirmed' && tx.executionResult === true, 'PAYMENT_NOT_CONFIRMED', 409);
  requireThat(Number.isSafeInteger(finalizedHeight) && Number.isSafeInteger(tx.blockHeight) && tx.blockHeight <= finalizedHeight, 'PAYMENT_NOT_FINAL', 409);
  requireThat(typeof tx.transactionHash === 'string' && /^[a-f0-9]{64}$/.test(tx.transactionHash), 'INVALID_TRANSACTION_HASH');
  requireThat(tx.recipientType === 'basic' && tx.flags === 0, 'UNSUPPORTED_PAYMENT_TYPE');
  requireThat(depositSender(tx) === intent.sender, 'WRONG_PAYMENT_SENDER');
  requireThat(canonicalAddress(tx.recipient) === intent.recipient, 'WRONG_PAYMENT_RECIPIENT');
  requireThat(tx.data?.raw === Buffer.from(paymentMemo(intent.id)).toString('hex'), 'WRONG_PAYMENT_MEMO');
  amount(tx.value); amount(intent.amountLuna);
  requireThat(Number.isSafeInteger(tx.timestamp) && tx.timestamp > 1_000_000_000_000, 'INVALID_PAYMENT_TIMESTAMP');
  const reason = tx.value !== intent.amountLuna ? 'AMOUNT_MISMATCH'
    : tx.timestamp >= intent.expiresAt || intent.closed ? 'LATE_DEPOSIT' : null;
  return { transactionHash: tx.transactionHash, amountLuna: tx.value,
    disposition: reason ? 'refund_required' : 'funded', reason };
}

export function settlementPlan(room, deposits) {
  const network = paymentNetwork(roomNetwork(room));
  requireThat(room.paymentRulesVersion === network.rules || (network.name === 'mainalbatross' && room.paymentRulesVersion === 'nim-v1'), 'UNSUPPORTED_PAYMENT_RULES');
  requireThat(['completed', 'void', 'cancelled'].includes(room.status), 'MATCH_NOT_FINAL', 409);
  requireThat(typeof room.code === 'string' && /^[A-F0-9]{10}$/.test(room.code), 'INVALID_ROOM');
  requireThat(deposits.length > 0 && deposits.length <= 8, 'INVALID_DEPOSITS');
  requireThat(new Set(deposits.map(d => d.playerId)).size === deposits.length, 'DUPLICATE_DEPOSITOR');
  requireThat(new Set(deposits.map(d => canonicalAddress(d.address))).size === deposits.length, 'DUPLICATE_WALLET');
  requireThat(deposits.every(d => amount(d.amountLuna) && d.amountLuna === room.stakeLuna), 'UNEQUAL_STAKES');
  requireThat(room.stakeLuna <= MAX_STAKE_LUNA, 'STAKE_TOO_LARGE');
  requireThat(deposits.every(d => room.players.some(p => p.id === d.playerId)), 'UNKNOWN_DEPOSITOR');
  const refund = room.status !== 'completed' || room.reason === 'ALL_FORFEIT';
  if (!refund) requireThat(deposits.length === room.players.length, 'MISSING_DEPOSIT');
  const ordered = [...deposits].map(d => ({ ...d, address: canonicalAddress(d.address) })).sort((a, b) => a.address.localeCompare(b.address));
  const total = ordered.reduce((sum, d) => sum + BigInt(d.amountLuna), 0n);
  let transfers;
  if (refund) transfers = ordered.map(d => ({ playerId: d.playerId, address: d.address, amountLuna: d.amountLuna, kind: 'refund' }));
  else {
    requireThat(Array.isArray(room.winners) && room.winners.length > 0 && new Set(room.winners).size === room.winners.length, 'INVALID_WINNERS');
    const winners = ordered.filter(d => room.winners.includes(d.playerId));
    requireThat(winners.length === room.winners.length && winners.every(d => room.players.find(p => p.id === d.playerId)?.status === 'finished'), 'INVALID_WINNERS');
    const share = total / BigInt(winners.length); const remainder = Number(total % BigInt(winners.length));
    transfers = winners.map((d, i) => ({ playerId: d.playerId, address: d.address, amountLuna: Number(share) + (i < remainder ? 1 : 0), kind: 'prize' }));
  }
  requireThat(transfers.reduce((sum, p) => sum + BigInt(p.amountLuna), 0n) === total, 'UNBALANCED_SETTLEMENT');
  // Deposits here contain only the stake. Fee contributions are accounted separately.
  const plan = { roomCode: room.code, rulesVersion: room.paymentRulesVersion, networkId: network.id,
    reason: refund ? room.reason ?? room.status : 'RESULT', totalLuna: Number(total), transfers };
  return { ...plan, decisionHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex') };
}

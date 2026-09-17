import { Client, ClientConfiguration, KeyPair, Address, TransactionBuilder, Transaction, Policy } from '@nimiq/core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paymentNetwork } from './payment-network.mjs';
import { requireThat } from './game.mjs';

export const TESTNET_SEEDS = [1, 2, 3, 4].map(n => `/dns4/seed${n}.pos.nimiq-testnet.com/tcp/8443/wss`);
import { PAYOUT_FEE_LUNA } from './payment-fees.mjs';
export { PAYOUT_FEE_LUNA } from './payment-fees.mjs';

export async function loadTestKey(path, create = false) {
  requireThat(process.env.PAYMENT_NETWORK === 'testalbatross', 'TESTNET_REQUIRED');
  return loadTreasuryKey(path, 'testalbatross', create);
}

export async function loadTreasuryKey(path, network, create = false) {
  paymentNetwork(network);
  requireThat(path, 'TREASURY_PATH_REQUIRED');
  try { return KeyPair.deserialize(await readFile(path)); }
  catch (e) {
    if (e.code !== 'ENOENT' || !create) throw e;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const key = KeyPair.generate();
    try { await writeFile(path, key.serialize(), { flag: 'wx', mode: 0o600 }); return key; }
    catch (error) { key.free(); throw error; }
  }
}

export class NimiqChain {
  constructor(key, network) { this.network = paymentNetwork(network); this.key = key; const address = key.toAddress(); this.address = address.toUserFriendlyAddress(); address.free(); this.synced = false; }
  async connect() {
    const config = new ClientConfiguration();
    config.network(this.network.client); if (this.network.name === 'testalbatross') config.seedNodes(TESTNET_SEEDS); config.desiredPeerCount(12); config.logLevel('error');
    try { this.client = await Client.create(config.build()); } finally { config.free(); }
    await this.client.addConsensusChangedListener(state => { this.synced = state === 'established'; });
    await this.client.waitForConsensusEstablished();
    requireThat(await this.client.getNetworkId() === this.network.id, 'WRONG_PAYMENT_NETWORK'); this.synced = true;
  }
  async head() {
    requireThat(this.synced && await this.client.getNetworkId() === this.network.id, 'PAYMENTS_UNAVAILABLE', 503);
    const block = await this.client.getHeadBlock();
    requireThat(Number.isSafeInteger(block.timestamp) && Math.abs(Date.now() - block.timestamp) < 120_000, 'CHAIN_STALE', 503);
    return { height: block.height, finalizedHeight: Policy.lastMacroBlock(block.height) };
  }
  async history() {
    const result = []; let cursor;
    for (let page = 0; page < 100; page++) {
      // Returned history has verified inclusion proofs; one history-serving peer is sufficient.
      const transactions = await this.client.getTransactionsByAddress(this.address, 0, undefined, cursor, 100, 1);
      result.push(...transactions);
      if (transactions.length < 100) return result;
      const next = transactions.at(-1).transactionHash;
      requireThat(next !== cursor, 'CHAIN_HISTORY_STALLED', 503); cursor = next;
    }
    throw new Error('CHAIN_HISTORY_LIMIT');
  }
  async balance() { const account = await this.client.getAccount(this.address); return account?.balance ?? 0; }
  async sign(address, amountLuna) {
    const { height } = await this.head();
    const sender = Address.fromString(this.address), recipient = Address.fromString(address);
    let tx;
    try {
      tx = TransactionBuilder.newBasic(sender, recipient, BigInt(amountLuna), BigInt(PAYOUT_FEE_LUNA), height, this.network.id);
      this.key.signTransaction(tx); tx.verify(await this.client.getProtocolVersion(), this.network.id);
      return { hash: tx.hash(), raw: tx.toHex(), fee: PAYOUT_FEE_LUNA, validUntil: height + Policy.TRANSACTION_VALIDITY_WINDOW_BLOCKS };
    } finally { tx?.free(); sender.free(); recipient.free(); }
  }
  async broadcast(raw) {
    const tx = Transaction.fromAny(raw);
    try { requireThat(tx.networkId === this.network.id, 'WRONG_PAYMENT_NETWORK'); return await this.client.sendTransaction(tx.toHex()); }
    finally { tx.free(); }
  }
  async close() { this.synced = false; if (this.client) await this.client.disconnectNetwork(); this.key.free(); }
}

// The development helper remains explicitly Testnet-only.
export class Testnet extends NimiqChain {
  constructor(key) { super(key, 'testalbatross'); }
  async connect() {
    requireThat(process.env.PAYMENT_NETWORK === 'testalbatross', 'TESTNET_REQUIRED');
    return super.connect();
  }
}

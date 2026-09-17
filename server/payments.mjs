import { roomNetwork } from './payment-network.mjs';
import { Ledger } from './ledger.mjs';
import { NimiqChain, loadTreasuryKey, PAYOUT_FEE_LUNA } from './testnet.mjs';
import { member, requireThat } from './game.mjs';
import { depositSender } from './payment-policy.mjs';
import { feeContribution } from './payment-fees.mjs';

export class Payments {
  constructor(store, ledger, chain) { this.store = store; this.ledger = ledger; this.chain = chain; this.lastSuccess = 0; this.reserve = 0; this.running = false; this.needsReview = false; }
  status() {
    const mainnet = this.chain.network?.name === 'mainalbatross', minimum = mainnet ? 0 : 100_000;
    return { network: this.chain.network?.name ?? 'testalbatross', address: this.chain.address, feeContributionLuna: mainnet ? PAYOUT_FEE_LUNA : 0,
    ready: !this.needsReview && this.chain.synced && Date.now() - this.lastSuccess < 60_000 && this.reserve >= minimum,
    reason: this.needsReview ? 'review' : !this.chain.synced ? 'syncing' : this.reserve < minimum ? 'reserve' : Date.now() - this.lastSuccess >= 60_000 ? 'unavailable' : null }; }
  async intent(code, user, input = {}) {
    requireThat(this.status().ready, 'PAYMENTS_UNAVAILABLE', 503);
    this.store.view(code, user.id);
    const room = this.store.load(code), p = member(room, user.id);
    requireThat(roomNetwork(room) === this.status().network, 'WRONG_PAYMENT_NETWORK');
    requireThat(!feeContribution(room) || input.feeContributionLuna === feeContribution(room), 'PAYMENT_NETWORK_CHANGED', 409);
    requireThat(feeContribution(room) || this.reserve >= 100_000, 'PAYMENTS_UNAVAILABLE', 503);
    requireThat(room.stakeLuna && room.status === 'lobby', 'ROOM_LOCKED', 409);
    requireThat(room.players.length === room.capacity, 'WAIT_FOR_PLAYERS', 409);
    requireThat(user.wallet?.address === p.walletAddress, 'VERIFIED_WALLET_REQUIRED', 403);
    return this.ledger.intent(room, p);
  }
  async view(code, user) { const room = this.store.load(code); member(room, user.id); return this.ledger.view(code, user.id); }
  async cycle() {
    if (this.running) return;
    this.running = true;
    try {
      const head = await this.chain.head();
      const transactions = await this.chain.history();
      const intents = new Map((await this.ledger.intents()).map(i => [i.id, i]));
      for (const tx of transactions) {
        if (tx.state !== 'confirmed' || tx.executionResult !== true || tx.blockHeight > head.finalizedHeight || tx.recipient !== this.chain.address) continue;
        const memo = Buffer.from(tx.data?.raw ?? '', 'hex').toString('utf8');
        const intent = intents.get(memo.startsWith('NimDuel:') ? memo.slice(8) : '');
        if (!intent || tx.recipientType !== 'basic' || tx.flags !== 0) continue;
        try { depositSender(tx); } catch (error) { if (error.code === 'UNSUPPORTED_PAYMENT_TYPE') continue; throw error; }
        const room = this.store.load(intent.roomCode);
        requireThat(roomNetwork(room) === this.status().network, 'WRONG_PAYMENT_NETWORK');
        await this.ledger.recordDeposit(tx, intent, head.finalizedHeight, room.status !== 'lobby' || Date.now() >= room.lobbyDeadline);
      }
      for (const room of this.store.paidRooms()) {
        if (roomNetwork(room) !== this.status().network) continue;
        if (room.status === 'lobby') this.store.markFunded(room.code, await this.ledger.funded(room.code));
        if (['completed', 'void', 'cancelled'].includes(room.status)) await this.ledger.settle(room);
      }
      const history = new Map(transactions.map(tx => [tx.transactionHash, tx]));
      for (const payout of await this.ledger.payouts()) {
        const tx = payout.tx_hash && history.get(payout.tx_hash);
        if (tx?.state === 'confirmed' && tx.blockHeight <= head.finalizedHeight) await this.ledger.confirm(payout, tx, head.finalizedHeight);
      }
      const jobs = await this.ledger.payouts();
      this.needsReview = jobs.some(p => p.status === 'review');
      this.reserve = Number(await this.chain.balance()) - await this.ledger.obligations() - jobs.length * PAYOUT_FEE_LUNA - (await this.ledger.pendingRoomFees?.() ?? 0);
      // A single in-flight transaction also makes balance reconciliation conservative.
      const pending = jobs.find(p => p.status === 'signed' || p.status === 'review');
      if (pending) {
        if (head.height >= Number(pending.valid_until)) { await this.ledger.review(pending.id); this.needsReview = true; }
        else if (pending.status === 'signed') await this.chain.broadcast(pending.raw_tx);
      } else if (jobs.length && this.reserve >= 0) {
        const payout = jobs[0];
        const signed = await this.chain.sign(payout.address, Number(payout.amount_luna));
        const saved = await this.ledger.signed(payout.id, signed);
        // The committed bytes are always used, including if another process already signed the job.
        if (saved.status === 'signed') await this.chain.broadcast(saved.raw_tx);
      }
      this.lastSuccess = Date.now();
    } finally { this.running = false; }
  }
  async start() {
    await this.chain.connect();
    const run = () => this.cycle().catch(error => { this.lastSuccess = 0; console.error('Payment check failed:', error.code ?? error.name); });
    await run(); this.timer = setInterval(run, 15_000);
  }
  async close() { clearInterval(this.timer); await this.chain.close(); await this.ledger.close(); }
}

export async function configuredPayments(store) {
  const mode = process.env.PAYMENTS_ENABLED;
  if (!mode || mode === 'disabled') return null;
  requireThat(['testnet', 'mainnet'].includes(mode), 'INVALID_PAYMENT_NETWORK');
  const network = mode === 'mainnet' ? 'mainalbatross' : 'testalbatross';
  requireThat(process.env.PAYMENT_NETWORK === network && process.env.PAYMENT_DATABASE_URL && process.env.TREASURY_KEY_PATH, 'PAYMENT_CONFIGURATION_REQUIRED');
  const make = async (network, database, keyPath) => {
    const key = await loadTreasuryKey(keyPath, network);
    const ledger = new Ledger(database, network); await ledger.init();
    return new Payments(store, ledger, new NimiqChain(key, network));
  };
  const active = await make(network, process.env.PAYMENT_DATABASE_URL, process.env.TREASURY_KEY_PATH);
  let legacy;
  if (network === 'mainalbatross' && process.env.LEGACY_PAYMENT_DATABASE_URL) {
    requireThat(process.env.LEGACY_TREASURY_KEY_PATH && process.env.LEGACY_PAYMENT_DATABASE_URL !== process.env.PAYMENT_DATABASE_URL, 'PAYMENT_CONFIGURATION_REQUIRED');
    legacy = await make('testalbatross', process.env.LEGACY_PAYMENT_DATABASE_URL, process.env.LEGACY_TREASURY_KEY_PATH);
    requireThat(legacy.chain.address !== active.chain.address, 'TREASURY_NETWORK_COLLISION');
  }
  // Old Testnet rooms keep their receipts, refunds and late-deposit processing.
  // New payment intents may only target the active network.
  const service = {
    status: () => active.status(),
    intent: (code, user, input) => active.intent(code, user, input),
    view: (code, user) => {
      const room = store.load(code); member(room, user.id);
      const worker = roomNetwork(room) === network ? active : legacy;
      requireThat(worker, 'PAYMENTS_UNAVAILABLE', 503);
      return worker.view(code, user);
    },
    close: async () => { await active.close(); await legacy?.close(); },
  };
  store.payments = service;
  for (const worker of [active, legacy].filter(Boolean)) worker.start().catch(error => console.error('Payments unavailable:', worker.status().network, error.code ?? error.name));
  return service;
}

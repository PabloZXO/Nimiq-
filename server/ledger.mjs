import { paymentNetwork, roomNetwork } from './payment-network.mjs';
import { feeContribution, PAYOUT_FEE_LUNA } from './payment-fees.mjs';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { requireThat } from './game.mjs';
import { classifyDeposit, depositSender, paymentMemo, settlementPlan } from './payment-policy.mjs';

// One transaction lock serializes financial decisions across processes. No chain I/O inside it.
export class Ledger {
  constructor(connectionString, network = 'testalbatross') { this.network = paymentNetwork(network); this.pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000 }); this.pool.on('error', () => console.error('Payment database connection lost')); }
  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS payment_intents (
        id TEXT PRIMARY KEY, room_code TEXT NOT NULL, player_id TEXT NOT NULL, sender TEXT NOT NULL,
        recipient TEXT NOT NULL, amount_luna BIGINT NOT NULL CHECK(amount_luna > 0), expires_at BIGINT NOT NULL,
        UNIQUE(room_code, player_id)
      );
      CREATE TABLE IF NOT EXISTS deposits (
        hash TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES payment_intents(id),
        amount_luna BIGINT NOT NULL CHECK(amount_luna > 0), disposition TEXT NOT NULL,
        evidence JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_funded_deposit ON deposits(intent_id) WHERE disposition='funded';
      CREATE TABLE IF NOT EXISTS settlements (room_code TEXT PRIMARY KEY, decision_hash TEXT NOT NULL, plan JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS payouts (
        id TEXT PRIMARY KEY, room_code TEXT NOT NULL, player_id TEXT NOT NULL, address TEXT NOT NULL,
        amount_luna BIGINT NOT NULL CHECK(amount_luna > 0), kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued', tx_hash TEXT UNIQUE, raw_tx TEXT, fee BIGINT,
        valid_until BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS journal (
        id TEXT PRIMARY KEY, entries JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK(jsonb_typeof(entries)='array')
      );
    `);
    await this.pool.query('ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS fee_luna BIGINT NOT NULL DEFAULT 0 CHECK(fee_luna >= 0)');
    // A database belongs to one chain forever. Never reinterpret Testnet liabilities as NIM.
    await this.transaction(async db => {
      await db.query('CREATE TABLE IF NOT EXISTS payment_network (id INTEGER PRIMARY KEY CHECK(id=1), network TEXT NOT NULL)');
      const binding = (await db.query('SELECT network FROM payment_network WHERE id=1')).rows[0];
      if (!binding) {
        const populated = (await db.query('SELECT EXISTS(SELECT 1 FROM payment_intents) OR EXISTS(SELECT 1 FROM journal) AS yes')).rows[0].yes;
        requireThat(!populated || this.network.name === 'testalbatross', 'PAYMENT_DATABASE_NETWORK_MISMATCH');
        await db.query('INSERT INTO payment_network VALUES(1,$1)', [this.network.name]);
      } else requireThat(binding.network === this.network.name, 'PAYMENT_DATABASE_NETWORK_MISMATCH');
    });
  }
  async transaction(fn) {
    const db = await this.pool.connect();
    try { await db.query('BEGIN'); await db.query('SELECT pg_advisory_xact_lock(73129017)'); const result = await fn(db); await db.query('COMMIT'); return result; }
    catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  }
  async journal(db, id, entries) {
    requireThat(entries.every(e => Number.isSafeInteger(e.luna)) && entries.reduce((sum, e) => sum + BigInt(e.luna), 0n) === 0n, 'UNBALANCED_JOURNAL');
    await db.query('INSERT INTO journal(id,entries) VALUES($1,$2)', [id, JSON.stringify(entries)]);
  }
  intentView(row) { return { network: this.network.name, id: row.id, roomCode: row.room_code, playerId: row.player_id, sender: row.sender, recipient: row.recipient, amountLuna: Number(row.amount_luna), feeContributionLuna: Number(row.fee_luna), expiresAt: Number(row.expires_at), memo: paymentMemo(row.id) }; }
  async intent(room, player) {
    requireThat(roomNetwork(room) === this.network.name, 'WRONG_PAYMENT_NETWORK');
    return this.transaction(async db => {
      const fee = feeContribution(room);
      await db.query(`INSERT INTO payment_intents(id,room_code,player_id,sender,recipient,amount_luna,expires_at,fee_luna) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(room_code,player_id) DO NOTHING`,
        [randomBytes(16).toString('hex'), room.code, player.id, player.walletAddress, room.treasuryAddress, room.stakeLuna + fee, room.lobbyDeadline, fee]);
      const { rows } = await db.query('SELECT * FROM payment_intents WHERE room_code=$1 AND player_id=$2', [room.code, player.id]);
      return this.intentView(rows[0]);
    });
  }
  async intents() { return (await this.pool.query('SELECT * FROM payment_intents')).rows.map(row => this.intentView(row)); }
  async recordDeposit(tx, intent, finalizedHeight, closed) {
    requireThat((intent.network ?? 'testalbatross') === this.network.name, 'WRONG_PAYMENT_NETWORK');
    const sender = depositSender(tx), wrongSender = sender !== intent.sender;
    // A payment from a different wallet never funds this player. Return it to its actual sender.
    const checked = classifyDeposit(tx, { ...intent, sender, closed: closed || wrongSender }, finalizedHeight);
    return this.transaction(async db => {
      if ((await db.query('SELECT 1 FROM deposits WHERE hash=$1', [checked.transactionHash])).rowCount) return;
      const duplicate = (await db.query("SELECT 1 FROM deposits WHERE intent_id=$1 AND disposition='funded'", [intent.id])).rowCount;
      const settled = (await db.query('SELECT 1 FROM settlements WHERE room_code=$1', [intent.roomCode])).rowCount;
      const refund = closed || wrongSender || duplicate || settled || checked.disposition === 'refund_required';
      await db.query('INSERT INTO deposits(hash,intent_id,amount_luna,disposition,evidence) VALUES($1,$2,$3,$4,$5)',
        [checked.transactionHash, intent.id, checked.amountLuna, refund ? 'refund_required' : 'funded', JSON.stringify(tx)]);
      // Incorrect/late transfers pay for their own return. Dust remains a liability,
      // without creating an unfunded transaction that could drain other players' money.
      const held = refund && intent.feeContributionLuna > 0 && checked.amountLuna <= PAYOUT_FEE_LUNA;
      const fee = held ? 0 : (intent.feeContributionLuna ?? 0);
      const net = checked.amountLuna - fee;
      const liability = refund ? `payout:deposit:${checked.transactionHash}` : `room:${intent.roomCode}`;
      const entries = [{ account: this.network.asset, luna: checked.amountLuna }, { account: liability, luna: -net }];
      if (fee) entries.push({ account: 'reserve:contributions', luna: -fee });
      await this.journal(db, `deposit:${checked.transactionHash}`, entries);
      if (refund) await db.query('INSERT INTO payouts(id,room_code,player_id,address,amount_luna,kind,status) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [`deposit:${checked.transactionHash}`, intent.roomCode, wrongSender ? `unmatched:${sender}` : intent.playerId, sender, net, 'refund', held ? 'below_fee' : 'queued']);
    });
  }
  async funded(roomCode) {
    return (await this.pool.query(`SELECT i.player_id,i.sender,d.amount_luna-i.fee_luna AS amount_luna,d.hash FROM deposits d JOIN payment_intents i ON i.id=d.intent_id
      WHERE i.room_code=$1 AND d.disposition='funded'`, [roomCode])).rows.map(r => ({ playerId: r.player_id, address: r.sender, amountLuna: Number(r.amount_luna), hash: r.hash }));
  }
  async settle(room) {
    requireThat(roomNetwork(room) === this.network.name, 'WRONG_PAYMENT_NETWORK');
    return this.transaction(async db => {
      const previous = (await db.query('SELECT plan FROM settlements WHERE room_code=$1', [room.code])).rows[0];
      // Terminal game records are immutable; subsequent deposits get their own refund jobs.
      const rows = (await db.query(`SELECT i.player_id,i.sender,d.amount_luna-i.fee_luna AS amount_luna FROM deposits d JOIN payment_intents i ON i.id=d.intent_id
        WHERE i.room_code=$1 AND d.disposition='funded'`, [room.code])).rows;
      if (!rows.length) return null;
      const plan = settlementPlan(room, rows.map(r => ({ playerId: r.player_id, address: r.sender, amountLuna: Number(r.amount_luna) })));
      if (previous) { requireThat(previous.plan.decisionHash === plan.decisionHash, 'SETTLEMENT_CONFLICT'); return previous.plan; }
      await db.query('INSERT INTO settlements VALUES($1,$2,$3)', [room.code, plan.decisionHash, JSON.stringify(plan)]);
      const entries = [{ account: `room:${room.code}`, luna: plan.totalLuna }];
      for (const transfer of plan.transfers) {
        const id = `room:${room.code}:${transfer.playerId}`;
        await db.query('INSERT INTO payouts(id,room_code,player_id,address,amount_luna,kind) VALUES($1,$2,$3,$4,$5,$6)',
          [id, room.code, transfer.playerId, transfer.address, transfer.amountLuna, transfer.kind]);
        entries.push({ account: `payout:${id}`, luna: -transfer.amountLuna });
      }
      await this.journal(db, `settlement:${room.code}`, entries); return plan;
    });
  }
  async payouts() { return (await this.pool.query("SELECT * FROM payouts WHERE status NOT IN ('confirmed','below_fee') ORDER BY updated_at,id")).rows; }
  async pendingRoomFees() {
    // Every funded, unsettled seat must retain enough for its own cancellation refund.
    const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM deposits d JOIN payment_intents i ON i.id=d.intent_id
      WHERE d.disposition='funded' AND NOT EXISTS(SELECT 1 FROM settlements s WHERE s.room_code=i.room_code)`);
    return rows[0].n * PAYOUT_FEE_LUNA;
  }
  async obligations() {
    const { rows } = await this.pool.query(`SELECT COALESCE(-sum((entry->>'luna')::numeric),0) AS total FROM journal,
      jsonb_array_elements(entries) entry WHERE entry->>'account' LIKE 'room:%' OR entry->>'account' LIKE 'payout:%'`);
    return Number(rows[0].total);
  }
  async signed(id, signed) {
    return this.transaction(async db => {
      await db.query("UPDATE payouts SET status='signed',tx_hash=$2,raw_tx=$3,fee=$4,valid_until=$5,updated_at=now() WHERE id=$1 AND status='queued'", [id, signed.hash, signed.raw, signed.fee, signed.validUntil]);
      return (await db.query('SELECT * FROM payouts WHERE id=$1', [id])).rows[0];
    });
  }
  async confirm(payout, tx, finalizedHeight) {
    requireThat(tx.network === this.network.name && tx.state === 'confirmed' && tx.executionResult === true && tx.blockHeight <= finalizedHeight
      && tx.transactionHash === payout.tx_hash && tx.recipient === payout.address && tx.value === Number(payout.amount_luna) && tx.fee === Number(payout.fee), 'INVALID_PAYOUT_PROOF');
    return this.transaction(async db => {
      const updated = await db.query("UPDATE payouts SET status='confirmed',updated_at=now() WHERE id=$1 AND status != 'confirmed' RETURNING id", [payout.id]);
      if (!updated.rowCount) return;
      await this.journal(db, `payout:${payout.id}`, [{ account: `payout:${payout.id}`, luna: Number(payout.amount_luna) },
        { account: 'expense:fees', luna: Number(payout.fee) }, { account: this.network.asset, luna: -Number(payout.amount_luna) - Number(payout.fee) }]);
    });
  }
  async review(id) { await this.pool.query("UPDATE payouts SET status='review',updated_at=now() WHERE id=$1 AND status='signed'", [id]); }
  async view(code, playerId) {
    const intents = await this.pool.query('SELECT i.*,d.hash FROM payment_intents i LEFT JOIN deposits d ON d.intent_id=i.id AND d.disposition=\'funded\' WHERE i.room_code=$1 AND i.player_id=$2', [code, playerId]);
    const payouts = await this.pool.query('SELECT kind,status,amount_luna,tx_hash FROM payouts WHERE room_code=$1 AND player_id=$2', [code, playerId]);
    return { intent: intents.rows[0] ? { ...this.intentView(intents.rows[0]), fundedHash: intents.rows[0].hash ?? null } : null,
      payouts: payouts.rows.map(r => ({ kind: r.kind, status: r.status, amountLuna: Number(r.amount_luna), hash: r.tx_hash })) };
  }
  async close() { await this.pool.end(); }
}

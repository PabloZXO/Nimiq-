import { Testnet, loadTestKey } from '../server/testnet.mjs';
const timeout = setTimeout(() => process.exit(1), 90000);
const chain = new Testnet(await loadTestKey(process.env.TREASURY_KEY_PATH));
try {
  await chain.connect(); console.log('Testnet connected');
  for (const [name, request] of [
    ['head', () => chain.head()],
    ['history-one-peer', () => chain.client.getTransactionsByAddress(chain.address, 0, undefined, undefined, 100, 1)],
    ['balance', () => chain.balance()],
  ]) {
    try { console.log(name, JSON.stringify(await request())); } catch (e) { console.log(name, e.message); }
  }
} finally { await chain.close(); clearTimeout(timeout); process.exit(0); }

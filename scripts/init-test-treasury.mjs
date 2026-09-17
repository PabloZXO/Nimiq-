import { loadTestKey } from '../server/testnet.mjs';

// Explicit operator command only; never run automatically when a key is missing.
if (process.argv[2] !== '--create-testnet' || !process.env.TREASURY_KEY_PATH) throw new Error('Explicit testnet setup required');
const key = await loadTestKey(process.env.TREASURY_KEY_PATH, true);
const address = key.toAddress();
console.log(JSON.stringify({ network: 'testalbatross', address: address.toUserFriendlyAddress() }));
address.free(); key.free();

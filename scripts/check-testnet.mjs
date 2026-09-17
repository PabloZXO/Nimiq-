import { Client, ClientConfiguration } from '@nimiq/core';

// Read-only network check. Never selects mainnet and never creates or sends a transaction.
const timeout = setTimeout(() => { console.error('Testnet connection timed out'); process.exit(1); }, 150_000);
let client;
try {
  const config = new ClientConfiguration();
  config.network('TestAlbatross'); config.logLevel('error'); config.desiredPeerCount(3);
  config.seedNodes([1, 2, 3, 4].map(n => `/dns4/seed${n}.pos.nimiq-testnet.com/tcp/8443/wss`));
  client = await Client.create(config.build()); config.free();
  await client.addConsensusChangedListener(state => console.log('Testnet consensus:', state));
  await client.addPeerChangedListener((_id, reason, count) => console.log(`Testnet peers: ${count} (${reason})`));
  await client.waitForConsensusEstablished();
  console.log(JSON.stringify({ network: 'TestAlbatross', networkId: await client.getNetworkId(),
    height: await client.getHeadHeight(), protocolVersion: await client.getProtocolVersion(), consensus: true }));
  await client.disconnectNetwork(); clearTimeout(timeout); process.exit(0);
} catch (error) {
  console.error('Testnet check failed:', error.code ?? error.name ?? 'Network error');
  clearTimeout(timeout); process.exit(1);
}

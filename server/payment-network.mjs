export const NETWORKS = Object.freeze({
  testalbatross: Object.freeze({ name: 'testalbatross', id: 5, client: 'TestAlbatross', rules: 'test-nim-v1', asset: 'asset:testnet' }),
  mainalbatross: Object.freeze({ name: 'mainalbatross', id: 24, client: 'MainAlbatross', rules: 'nim-shared-fees-v2', asset: 'asset:mainnet' }),
});

export function paymentNetwork(name = 'testalbatross') {
  if (!Object.hasOwn(NETWORKS, name)) throw new Error('INVALID_PAYMENT_NETWORK');
  return NETWORKS[name];
}

// Rooms created before network isolation were exclusively Testnet.
export const roomNetwork = room => room.paymentNetwork ?? 'testalbatross';

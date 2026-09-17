import { KeyPair, SignatureProof, HashedTimeLockedContract } from '@nimiq/core';

// Synthetic proof bytes only; these temporary keys never hold funds.
export function htlcProof() {
  function signer() {
    const key = KeyPair.generate(), publicKey = key.publicKey, address = key.toAddress();
    const signature = key.sign(new Uint8Array(32)), proof = SignatureProof.singleSig(publicKey, signature);
    try { return { address: address.toUserFriendlyAddress(), bytes: proof.serialize() }; }
    finally { proof.free(); signature.free(); address.free(); publicKey.free(); key.free(); }
  }
  const recipient = signer(), creator = signer();
  // Core's early-resolve variant (1): recipient signature proof followed by creator proof.
  const bytes = new Uint8Array([1, ...recipient.bytes, ...creator.bytes]);
  const proof = HashedTimeLockedContract.proofToPlain(bytes);
  return { creator: creator.address, signer: recipient.address, proof,
    timeout: HashedTimeLockedContract.proofToPlain(new Uint8Array([2, ...creator.bytes])) };
}

import { Wallet } from 'ethers';

/**
 * Persistent ECIES identity for a human who registers as an executor via the
 * A2A dashboard.
 *
 * The backend now REQUIRES a pubkey at /a2a/register — without one, a poster
 * can't ECIES-wrap an encrypted brief to the executor, so it could never
 * decrypt a task and would only ever spin on NEEDS_WRAP. Deployed agents get a
 * keypair at deploy time; a human registering by hand has no such key, so we
 * generate one here.
 *
 * The keypair is generated once per wallet address and the private key is
 * persisted locally (never sent to the backend — only the public key is). It is
 * reused on every re-registration: regenerating it would change the pubkey and
 * orphan any briefs already wrapped to the previous one. This mirrors how a
 * deployed agent holds a stable identity key.
 *
 * Note: decryption of an assigned brief is an agent-side (worker) path today;
 * this just makes manual registration valid and wrappable.
 */

const PREFIX = 'blindmarket:execIdentity:';

/** Uncompressed secp256k1 pubkey hex (130 chars, leading 04, no 0x prefix) —
 *  the exact shape the backend register schema expects. Typed structurally so
 *  it accepts both Wallet (new Wallet(pk)) and HDNodeWallet (createRandom()). */
function pubKeyHexFrom(wallet: { signingKey: { publicKey: string } }): string {
  return wallet.signingKey.publicKey.slice(2);
}

export function getOrCreateExecutorIdentity(address: string): {
  privateKey: string;
  publicKey: string;
} {
  const storageKey = PREFIX + address.toLowerCase();
  const existing = localStorage.getItem(storageKey);
  if (existing) {
    try {
      const w = new Wallet(existing);
      return { privateKey: existing, publicKey: pubKeyHexFrom(w) };
    } catch {
      // Corrupt stored value — fall through and regenerate.
    }
  }
  const w = Wallet.createRandom();
  try {
    localStorage.setItem(storageKey, w.privateKey);
  } catch {
    // Storage full/disabled — registration can still proceed this session, but
    // a later re-register would mint a different pubkey. Surfaced by the caller.
  }
  return { privateKey: w.privateKey, publicKey: pubKeyHexFrom(w) };
}

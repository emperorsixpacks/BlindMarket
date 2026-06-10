import { createECDH, createHash } from 'crypto';
import { eciesEncrypt, eciesDecrypt } from './crypto.js';
import { config } from '../config.js';

/**
 * Key custody & late-joiner re-wrap.  (design: docs/TEE-REWRAP-SPEC.md)
 *
 * Problem: every task posted from the UI is encrypted, and the brief's AES key
 * is ECIES-wrapped only to executors known AT POST TIME. An agent that
 * registers later has no slice and gets stuck on 403 NEEDS_WRAP — its only
 * recovery is the poster's browser (humans) or the posting agent's short wrap
 * loop. Neither serves "a human posts a seed task; an agent shows up two days
 * later" with no poster present.
 *
 * Fix: at post time the AES key is *also* sealed to a platform-held custody
 * key. When a late agent wins a task, the backend unwraps from custody and
 * re-wraps to that agent's pubkey — so the agent can decrypt with no poster in
 * the loop. The worker decrypt path is unchanged (same `eciesDecrypt`).
 *
 * The re-wrap backend is swappable behind this interface so the trust posture
 * can harden without re-architecting:
 *   - `local`     : the operator holds the custody key. The operator CAN read
 *                   every sealed brief key (see the startup warning). Interim.
 *   - `tdx`       : key sealed inside your own Intel TDX enclave (attested).
 *   - `zg-oracle` : 0G's ERC-7857 re-encryption oracle, if 0G exposes it.
 * Only `local` is implemented today.
 */
export interface KeyCustodyService {
  /** The active key posters seal the AES key to: { keyId, uncompressed secp256k1 pubkey (no 0x) }. */
  getActiveKey(): Promise<{ keyId: string; publicKey: string }>;
  /** Attestation quote for the attested backends; null for `local`. */
  getAttestation(): Promise<string | null>;
  /**
   * Unwrap the AES key from `blobHex` (sealed to custody key `keyId`) and
   * re-wrap it to `recipientPubKeyHex`. The plaintext AES key never leaves this
   * call. Returns the wrapped slice as hex (no 0x), worker-decryptable with the
   * recipient's private key. Throws if `keyId` is not the active key.
   */
  rewrap(keyId: string, blobHex: string, recipientPubKeyHex: string): Promise<string>;
}

/** Derive the uncompressed secp256k1 pubkey (hex, no 0x) from a private key. */
function derivePublicKey(privateKeyHex: string): string {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(privateKeyHex, 'hex'));
  return ecdh.getPublicKey('hex', 'uncompressed');
}

/**
 * keyId = first 16 hex chars of sha256(pubkey). Deterministic, so a poster who
 * fetched the key can bind their sealed blob to the exact custody key that can
 * unwrap it — which is what lets the operator→enclave migration keep decrypting
 * legacy blobs with the right key during a rotation window.
 */
function computeKeyId(publicKeyHex: string): string {
  return createHash('sha256').update(Buffer.from(publicKeyHex, 'hex')).digest('hex').slice(0, 16);
}

/**
 * Operator-trusted backend. The custody private key lives in the backend's
 * config/secret store, so the operator can decrypt every brief key sealed to
 * it. This is the same trust class as auto-verify (which the operator already
 * runs) but it MUST be disclosed — see docs/TEE-REWRAP-SPEC.md §9.
 */
class LocalKeyCustodyService implements KeyCustodyService {
  private readonly privateKeyHex: string;
  private readonly publicKeyHex: string;
  private readonly keyId: string;

  constructor(privateKeyHex: string) {
    this.privateKeyHex = privateKeyHex;
    this.publicKeyHex = derivePublicKey(privateKeyHex); // throws on a malformed key → caught at init
    this.keyId = computeKeyId(this.publicKeyHex);
  }

  async getActiveKey(): Promise<{ keyId: string; publicKey: string }> {
    return { keyId: this.keyId, publicKey: this.publicKeyHex };
  }

  async getAttestation(): Promise<string | null> {
    return null; // operator-trusted: nothing to attest
  }

  async rewrap(keyId: string, blobHex: string, recipientPubKeyHex: string): Promise<string> {
    if (keyId !== this.keyId) {
      throw new Error(`unknown custody keyId ${keyId} (active keyId is ${this.keyId})`);
    }
    const aesKey = eciesDecrypt(Buffer.from(blobHex, 'hex'), this.privateKeyHex); // plaintext AES key, in-process only
    return eciesEncrypt(aesKey, recipientPubKeyHex).toString('hex');
  }
}

// ── Singleton, initialised once at module load ───────────────────────────────

let service: KeyCustodyService | null = null;
let initError: string | null = null;

(function initKeyCustody() {
  if (!config.keyCustody.enabled) return; // default off — nothing to warn about

  const backend = config.keyCustody.backend;
  if (backend !== 'local') {
    initError = `KEY_CUSTODY_BACKEND=${backend} is not implemented yet (only 'local' ships today); key custody stays disabled`;
    console.error(`[key-custody] ${initError}`);
    return;
  }
  if (!config.keyCustody.privateKey) {
    initError = 'KEY_CUSTODY_ENABLED=true with backend=local but KEY_CUSTODY_PRIVATE_KEY is empty; key custody stays disabled';
    console.error(`[key-custody] ${initError}`);
    return;
  }
  try {
    service = new LocalKeyCustodyService(config.keyCustody.privateKey);
    console.warn(
      '⚠ [key-custody] ENABLED with backend=local (OPERATOR-TRUSTED). The operator can ' +
        'read every brief AES key sealed to the custody key — this is NOT enclave-isolated. ' +
        'Treat KEY_CUSTODY_PRIVATE_KEY as a crown-jewel secret and disclose this posture to ' +
        'users (docs/TEE-REWRAP-SPEC.md §9).',
    );
  } catch (err) {
    initError = `failed to initialise LocalKeyCustodyService (bad KEY_CUSTODY_PRIVATE_KEY?): ${(err as Error).message}`;
    console.error(`[key-custody] ${initError}`);
  }
})();

/** True when a usable custody backend is active. */
export function isKeyCustodyEnabled(): boolean {
  return service !== null;
}

/** The active custody service, or null when disabled/misconfigured. */
export function getKeyCustodyService(): KeyCustodyService | null {
  return service;
}

/**
 * Boot-time consistency audit: every OPEN task whose brief was sealed to
 * key-custody must be unwrappable by the CURRENTLY active custody key.
 * rewrap() throws on any keyId other than the active one, so a custody key
 * that was rotated (or custody disabled) after tasks were posted silently
 * breaks the late-joiner self-heal those posters relied on — their browsers
 * may be long gone, making the briefs permanently undecryptable. Custody is
 * append-only operational state; this alarm is the tripwire for dropping it.
 *
 * Loud alarm, not fail-fast: the rest of the marketplace (already-wrapped
 * executors, non-custody tasks) still works, so killing the boot would
 * punish everyone for an operator key mistake. Non-fatal on any error.
 */
export async function auditCustodySealedTasks(): Promise<void> {
  try {
    // Deferred import: a2aStore is independent of this module (no cycle), but
    // keep the audit self-contained so module-load order can't bite at boot.
    const a2aStore = await import('./a2aStore.js');
    const open = await a2aStore.browseAgentTasks();
    const sealed = open.filter((t) => t.meta.keyCustodyBlob);
    if (sealed.length === 0) return;

    const activeKeyId = service ? (await service.getActiveKey()).keyId : null;
    const orphaned = sealed.filter((t) => t.meta.keyCustodyBlob!.keyId !== activeKeyId);
    if (orphaned.length === 0) {
      console.log(`[key-custody] audit OK: ${sealed.length} custody-sealed open task(s) match the active key`);
      return;
    }
    console.error(
      `🚨 [key-custody] ${orphaned.length}/${sealed.length} custody-sealed OPEN task(s) are sealed to a ` +
        (activeKeyId === null
          ? 'custody key that is NO LONGER CONFIGURED (custody disabled).'
          : `keyId that does not match the active custody key (${activeKeyId}).`) +
        ' Late-joining agents CANNOT be served these briefs (403 NEEDS_WRAP dead-end). ' +
        `Restore the original KEY_CUSTODY_PRIVATE_KEY or have posters re-wrap/cancel. Affected: ` +
        orphaned.map((t) => `${t.meta.taskId.slice(0, 10)}…(keyId=${t.meta.keyCustodyBlob!.keyId})`).join(', '),
    );
  } catch (err) {
    console.error('[key-custody] audit failed (non-fatal):', (err as Error).message);
  }
}

import type { BlockchainType } from '../chain/domain-types.js';

/**
 * Sui-native signer implementing the SDK's signing abstraction.
 *
 * Wraps a @mysten/sui Keypair (Ed25519Keypair or Secp256k1Keypair) and
 * provides the same interface as EthersSigner so the rest of the SDK can
 * treat signers uniformly.
 *
 * Sui key differences from EVM:
 * - Addresses are 32-byte hex (0x-prefixed), not 20-byte
 * - Keypairs are Ed25519 by default (secp256k1 also supported)
 * - Signatures use the BCS-serialized intent + transaction digest
 * - No typed data signing (EIP-712 equivalent doesn't exist)
 */
export class SuiSigner {
  private keypair: SuiKeypairLike;
  private _address: string | null = null;

  constructor(keypair: SuiKeypairLike) {
    this.keypair = keypair;
  }

  async getAddress(): Promise<string> {
    if (this._address) return this._address;
    this._address = this.keypair.toSuiAddress();
    return this._address;
  }

  getChainType(): BlockchainType {
    return 'sui';
  }

  /**
   * Sign a personal message with the Sui keypair.
   * Uses the Sui personal message intent (different from EVM).
   */
  async signMessage(message: Uint8Array): Promise<string> {
    return this.keypair.signPersonalMessage(message);
  }

  /**
   * Sign and execute a transaction block.
   * Delegates to the keypair's signAndExecuteTransaction.
   */
  async signAndExecuteTransaction(params: SuiSignAndExecuteParams): Promise<SuiTransactionResult> {
    return this.keypair.signAndExecuteTransaction(params);
  }

  /**
   * Sign a transaction block (without executing).
   * Returns the signed transaction bytes + signature.
   */
  async signTransaction(tx: SuiTransactionLike): Promise<{ bytes: string; signature: string }> {
    return this.keypair.signTransaction(tx);
  }

  /** Get the raw secret key (dangerous — use only for persistence). */
  getSecretKey(): string {
    return this.keypair.getSecretKey();
  }

  /** Access the underlying keypair for advanced use. */
  unwrap(): SuiKeypairLike {
    return this.keypair;
  }
}

// ── Minimal Sui type mappings ─────────────────────────────────────────────
// These mirror @mysten/sui types so the SDK can compile without a hard
// dependency. Install @mysten/sui for full type checking and runtime.

export interface SuiKeypairLike {
  toSuiAddress(): string;
  getSecretKey(): string;
  signPersonalMessage(message: Uint8Array): Promise<string>;
  signAndExecuteTransaction(params: SuiSignAndExecuteParams): Promise<SuiTransactionResult>;
  signTransaction(tx: SuiTransactionLike): Promise<{ bytes: string; signature: string }>;
}

export interface SuiSignAndExecuteParams {
  transaction: SuiTransactionLike;
  client: SuiClientLike;
  include?: { effects?: boolean; balanceChanges?: boolean; events?: boolean };
}

export interface SuiTransactionLike {
  setSender(sender: string): void;
  toJSON(): Promise<Record<string, unknown>>;
  // Additional methods used by @mysten/sui are captured by the runtime object.
}

export type SuiTransactionClass = new () => SuiTransactionLike;

export interface SuiClientLike {
  executeTransaction(tx: Uint8Array | string, signature: string | string[]): Promise<SuiTransactionResult>;
}

export interface SuiTransactionResult {
  digest: string;
  effects?: Record<string, unknown>;
  balanceChanges?: unknown[];
  events?: unknown[];
}

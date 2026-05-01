import { ethers } from 'ethers';
import { ChainError, ConfigError } from '../errors/index.js';
import type { Address, Hex } from '../types.js';
import type { Signer, TxRequest, TypedDataDomain, TypedDataField } from './Signer.js';

/**
 * Wraps any ethers v6 Signer. The most common path — accepts ethers.Wallet,
 * ethers.BrowserProvider signer, JsonRpcSigner, etc. Caches the recovered
 * public key after the first successful getPublicKey() call.
 */
export class EthersSigner implements Signer {
  private publicKeyCache: Hex | undefined;

  constructor(private readonly inner: ethers.Signer) {}

  async getAddress(): Promise<Address> {
    return (await this.inner.getAddress()) as Address;
  }

  async chainId(): Promise<bigint> {
    const provider = this.inner.provider;
    if (!provider) {
      throw new ConfigError('CONFIG/BAD_CONFIG', 'signer has no attached provider; cannot read chainId');
    }
    const net = await provider.getNetwork();
    return net.chainId;
  }

  async signMessage(msg: string | Uint8Array): Promise<Hex> {
    return (await this.inner.signMessage(msg)) as Hex;
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<Hex> {
    return (await this.inner.signTypedData(domain, types, value)) as Hex;
  }

  async signTransaction(tx: TxRequest): Promise<Hex> {
    try {
      return (await this.inner.signTransaction({
        to: tx.to,
        ...(tx.from !== undefined ? { from: tx.from } : {}),
        ...(tx.data !== undefined ? { data: tx.data } : {}),
        ...(tx.value !== undefined ? { value: tx.value } : {}),
        ...(tx.gasLimit !== undefined ? { gasLimit: tx.gasLimit } : {}),
        ...(tx.nonce !== undefined ? { nonce: tx.nonce } : {}),
        ...(tx.chainId !== undefined ? { chainId: tx.chainId } : {}),
      })) as Hex;
    } catch (cause) {
      throw new ChainError('CHAIN/TX_REVERTED', 'signTransaction failed', { cause });
    }
  }

  /**
   * Recovers the uncompressed secp256k1 public key from the signer. For Wallet
   * signers we can read it directly; for generic Signers we sign a canonical
   * probe message once and recover from the signature.
   */
  async getPublicKey(): Promise<Hex> {
    if (this.publicKeyCache) return this.publicKeyCache;

    // Fast path: ethers.Wallet exposes signingKey.publicKey directly.
    const maybeWallet = this.inner as unknown as { signingKey?: { publicKey: string } };
    if (maybeWallet.signingKey?.publicKey) {
      this.publicKeyCache = maybeWallet.signingKey.publicKey as Hex;
      return this.publicKeyCache;
    }

    // Slow path: sign a probe message and recover the public key.
    const probe = 'BlindMarket-PublicKey-Recovery-v1';
    const sig = await this.inner.signMessage(probe);
    const recovered = ethers.SigningKey.recoverPublicKey(
      ethers.hashMessage(probe),
      sig,
    );
    this.publicKeyCache = recovered as Hex;
    return this.publicKeyCache;
  }
}

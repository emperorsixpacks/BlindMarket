import { ethers } from 'ethers';
import type { Signer as SdkSigner } from '../signer/index.js';
import type { Network } from '../network/index.js';
import { BlindEscrowClient } from './BlindEscrowClient.js';
import { BlindReputationClient } from './BlindReputationClient.js';
import { TaskRegistryClient } from './TaskRegistryClient.js';

export interface ChainClientOptions {
  network: Network;
  signer?: SdkSigner;
  /** If provided, used for reads even when signer is absent. Useful for public queries. */
  provider?: ethers.Provider;
}

/**
 * Bundles typed clients for all three BlindMarket contracts plus the underlying
 * ethers runner. Reads use provider (or signer's provider); writes require a
 * signer. To keep the SDK's Signer abstraction decoupled from ethers at the
 * call sites, we unwrap an EthersSigner's inner ethers.Signer lazily here.
 */
export class ChainClient {
  readonly escrow: BlindEscrowClient;
  readonly registry: TaskRegistryClient;
  readonly reputation: BlindReputationClient;
  readonly provider: ethers.Provider;
  readonly network: Network;

  constructor(opts: ChainClientOptions) {
    this.network = opts.network;
    const provider =
      opts.provider ??
      (opts.signer && unwrapEthersSigner(opts.signer)?.provider) ??
      defaultProvider(opts.network);
    this.provider = provider;

    const runner: ethers.ContractRunner = unwrapEthersSigner(opts.signer) ?? provider;
    this.escrow = new BlindEscrowClient(opts.network.contracts.escrow, runner);
    this.registry = new TaskRegistryClient(opts.network.contracts.registry, runner);
    this.reputation = new BlindReputationClient(opts.network.contracts.reputation, runner);
  }
}

/**
 * If the SDK Signer is an EthersSigner, pull out the inner ethers.Signer
 * (so ethers.Contract treats it as the transaction runner). Otherwise
 * returns undefined — writes will fail at the contract layer with a clear
 * signer-required error, as intended.
 */
function unwrapEthersSigner(signer: SdkSigner | undefined): ethers.Signer | undefined {
  if (!signer) return undefined;
  const maybe = signer as unknown as { inner?: ethers.Signer };
  return maybe.inner;
}

function defaultProvider(network: Network): ethers.Provider {
  const url = network.rpc[0];
  if (!url) throw new Error(`network ${network.name} has no RPC endpoint configured`);
  return new ethers.JsonRpcProvider(url, { chainId: Number(network.chainId), name: network.name });
}

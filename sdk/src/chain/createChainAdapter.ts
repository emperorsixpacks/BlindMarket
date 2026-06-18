import type { IBlindMarketChain } from './IBlindMarketChain.js';
import { EVMChainAdapter } from './evm/EVMChainAdapter.js';
import { SuiChainAdapter } from './sui/SuiChainAdapter.js';
import { resolveNetwork } from '../network/resolve.js';
import type { Network, NetworkName as PresetName } from '../network/index.js';
import type { EthersSigner } from '../signer/EthersSigner.js';
import type { SuiSigner } from '../signer/SuiSigner.js';

/**
 * Options for creating a chain adapter via the factory.
 *
 * The factory chooses the correct adapter based on `network.chainType`.
 */
export interface CreateChainAdapterOptions {
  network: Network | PresetName;
  signer?: EthersSigner | SuiSigner;
}

/**
 * Factory: create the correct IBlindMarketChain adapter for the given network.
 *
 * @example
 * ```ts
 * // EVM (0G)
 * const chain = createChainAdapter({
 *   network: 'og-testnet',
 *   signer: new PrivateKeySigner(privkey, provider),
 * });
 *
 * // Sui
 * const chain = createChainAdapter({
 *   network: 'sui-testnet',
 *   signer: new SuiSigner(keypair),
 * });
 * ```
 */
export function createChainAdapter(opts: CreateChainAdapterOptions): IBlindMarketChain {
  const network = resolveNetwork(opts.network);

  switch (network.chainType) {
    case 'evm':
      return new EVMChainAdapter({
        network,
        signer: opts.signer as EthersSigner | undefined,
      });

    case 'sui':
      return new SuiChainAdapter({
        network,
        signer: opts.signer as SuiSigner | undefined,
      });

    default:
      throw new Error(`Unsupported chain type: ${(network as Network).chainType}`);
  }
}

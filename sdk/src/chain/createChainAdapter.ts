import type { IBlindMarketChain } from './IBlindMarketChain.js';
import { EVMChainAdapter } from './evm/EVMChainAdapter.js';
import { resolveNetwork } from '../network/resolve.js';
import type { Network, NetworkName as PresetName } from '../network/index.js';
import type { EthersSigner } from '../signer/EthersSigner.js';

/**
 * Options for creating a chain adapter via the factory.
 *
 * The factory chooses the correct adapter based on `network.chainType`.
 */
export interface CreateChainAdapterOptions {
  network: Network | PresetName;
  signer?: EthersSigner;
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
 * ```
 */
export function createChainAdapter(opts: CreateChainAdapterOptions): IBlindMarketChain {
  const network = resolveNetwork(opts.network);

  if (network.chainType !== 'evm') {
    throw new Error(`Unsupported chain type: ${network.chainType}. Only EVM (0G) is supported.`);
  }

  return new EVMChainAdapter({
    network,
    signer: opts.signer,
  });
}
import { ConfigError } from '../errors/index.js';
import { networks, type NetworkName } from './presets.js';
import type { Network } from '../chain/domain-types.js';

/**
 * Resolve a network preset name or a Network object to a canonical Network.
 *
 * When given a string, looks up the preset. When given a Network object,
 * returns it as-is (pass-through for callers that already have a resolved
 * network config).
 */
export function resolveNetwork(arg: NetworkName | Network): Network {
  if (typeof arg === 'string') {
    const net = networks[arg];
    if (!net) {
      throw new ConfigError(
        'CONFIG/INVALID_NETWORK',
        `Unknown network: "${arg}". Known presets: ${Object.keys(networks).join(', ')}`,
      );
    }
    return net as unknown as Network;
  }
  return arg;
}

/**
 * Type guard: check if a Network is an EVM network.
 */
export function isEVMNetwork(network: Network): network is Network & { chainType: 'evm' } {
  return network.chainType === 'evm';
}
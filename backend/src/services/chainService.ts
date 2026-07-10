/**
 * Chain service — provides the active chain configuration.
 *
 * Only 0G Chain (EVM) is supported.
 */
import { config } from '../config.js';

import { provider, signer, escrow } from './chain.js';

/**
 * Log the active chain configuration at boot.
 */
export function logChainConfig(): void {
  console.log(`[chain] ⛓  EVM chain active (chainId: ${config.ogChainId}, RPC: ${config.ogRpcUrl})`);
}
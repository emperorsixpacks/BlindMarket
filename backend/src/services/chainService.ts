/**
 * Chain service — provides the active chain adapter based on CHAIN_TYPE env var.
 *
 * When CHAIN_TYPE=evm (default): returns the existing ethers-based chain.ts exports.
 * When CHAIN_TYPE=sui: returns a SuiChainAdapter from @blindmarket/sdk configured
 * with the package and shared object IDs from config.
 *
 * Backend services should import from this module instead of chain.ts directly
 * to be chain-agnostic.
 */
import { config } from '../config.js';

// Re-export the EVM chain service for backward compat
export * from './chain.js';

import { provider as evmProvider, signer as evmSigner, escrow as evmEscrow } from './chain.js';

/**
 * Get the active chain type ('evm' | 'sui').
 */
export function getChainType(): 'evm' | 'sui' {
  return config.chainType;
}

/**
 * Returns true if the backend is configured for Sui.
 */
export function isSui(): boolean {
  return config.chainType === 'sui';
}

/**
 * Get a Sui network config object suitable for creating a SuiChainAdapter.
 * Returns null if not on Sui chain.
 */
export function getSuiNetworkConfig() {
  if (!isSui()) return null;

  return {
    name: `sui-${config.suiNetworkId}`,
    chainType: 'sui' as const,
    networkId: config.suiNetworkId,
    rpc: [config.suiRpcUrl],
    packageId: config.suiPackageId,
    sharedObjects: {
      blindEscrow: config.suiBlindEscrowObjectId,
      taskRegistry: config.suiTaskRegistryObjectId,
      blindReputation: config.suiBlindReputationObjectId,
    },
    explorer: config.suiNetworkId === 'mainnet'
      ? 'https://suivision.xyz'
      : `https://${config.suiNetworkId}.suivision.xyz`,
  };
}

/**
 * Get a Sui admin capability ID (for admin-gated Move functions).
 */
export function getSuiAdminCapId(): string | null {
  return config.suiAdminCapId || null;
}

/**
 * Log the active chain configuration at boot.
 */
export function logChainConfig(): void {
  if (isSui()) {
    console.log(`[chain] ⛓  Sui chain active (network: ${config.suiNetworkId}, package: ${config.suiPackageId})`);
    console.log(`[chain]    Escrow object: ${config.suiBlindEscrowObjectId}`);
    console.log(`[chain]    Registry object: ${config.suiTaskRegistryObjectId}`);
    console.log(`[chain]    Reputation object: ${config.suiBlindReputationObjectId}`);
  } else {
    console.log(`[chain] ⛓  EVM chain active (chainId: ${config.ogChainId}, RPC: ${config.ogRpcUrl})`);
  }
}

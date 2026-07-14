import { CONTRACT_ADDRESSES } from './contractAddresses';

export const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const IS_PROD = import.meta.env.PROD;

// Contract-address fallbacks are single-sourced from contracts/deployments/*.json
// via contracts/scripts/sync-addresses.ts (do not hand-edit contractAddresses.ts).
// VITE_* env vars still win at build time; these are the no-env defaults.
const ADDR = IS_PROD ? CONTRACT_ADDRESSES.mainnet : CONTRACT_ADDRESSES.testnet;

export const OG_CHAIN_ID = Number(
  import.meta.env.VITE_OG_CHAIN_ID || (IS_PROD ? '16661' : '16602')
);

export const isMainnet = OG_CHAIN_ID === 16661;

export const OG_RPC_URL =
  import.meta.env.VITE_OG_RPC_URL ||
  (IS_PROD ? 'https://evmrpc.0g.ai' : 'https://evmrpc-testnet.0g.ai');

export const BLIND_ESCROW_ADDRESS =
  import.meta.env.VITE_BLIND_ESCROW_ADDRESS || ADDR.blindEscrow;

export const TASK_REGISTRY_ADDRESS =
  import.meta.env.VITE_TASK_REGISTRY_ADDRESS || ADDR.taskRegistry;

export const BLIND_REPUTATION_ADDRESS =
  import.meta.env.VITE_BLIND_REPUTATION_ADDRESS || ADDR.blindReputation;

// Marketplace payment token.
// Mainnet: Native 0G (address(0))
// Testnet: Native 0G (address(0)) - Mock USDC is no longer used for bounties.
export const MARKETPLACE_TOKEN_ADDRESS =
  (import.meta.env.VITE_MOCK_ERC20_ADDRESS as string | undefined) ||
  '0x0000000000000000000000000000000000000000';

// Founder addresses (comma-separated, lowercase). Used to gate the /metrics page.
export const FOUNDER_ADDRESSES: string[] = (import.meta.env.VITE_FOUNDER_ADDRESSES || '')
  .split(',')
  .map((s: string) => s.trim().toLowerCase())
  .filter(Boolean);

export const OG_CHAIN_CONFIG = {
  chainId: `0x${OG_CHAIN_ID.toString(16)}`,
  chainName: OG_CHAIN_ID === 16661 ? '0G Mainnet' : '0G Testnet',
  nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 },
  rpcUrls: [OG_RPC_URL],
  blockExplorerUrls: [OG_CHAIN_ID === 16661 ? 'https://chainscan.0g.ai' : 'https://chainscan-newton.0g.ai'],
} as const;

// Only 0G (EVM) chain is supported
export const SUPPORTED_CHAINS = ['og'] as const;
export type SupportedChain = typeof SUPPORTED_CHAINS[number];

/**
 * Active chain — driven by localStorage (set by the chain selector), falling
 * back to VITE_ACTIVE_CHAIN env var, then 'og'.
 *
 * Components should prefer the reactive `useChain()` hook from ChainContext
 * so they re-render when the user switches chains. This constant is a
 * synchronous snapshot for non-React code (e.g. API interceptors).
 */
export const ACTIVE_CHAIN: SupportedChain = getActiveChain();

export function getActiveChain(): SupportedChain {
  try {
    const saved = localStorage.getItem('bb.chain');
    if (saved && (SUPPORTED_CHAINS as readonly string[]).includes(saved)) {
      return saved as SupportedChain;
    }
  } catch {}
  return (import.meta.env.VITE_ACTIVE_CHAIN as SupportedChain | undefined) ?? 'og';
}

export const CHAIN_CONFIGS = {
  og: OG_CHAIN_CONFIG,
} as const;

export function getChainConfig(chain: SupportedChain) {
  return CHAIN_CONFIGS[chain];
}

export function getNativeCurrency(chain: SupportedChain) {
  return getChainConfig(chain).nativeCurrency;
}
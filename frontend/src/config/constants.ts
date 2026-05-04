export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const OG_CHAIN_ID = Number(import.meta.env.VITE_OG_CHAIN_ID || '16602');
export const OG_RPC_URL = import.meta.env.VITE_OG_RPC_URL || 'https://evmrpc-testnet.0g.ai';

export const BLIND_ESCROW_ADDRESS = import.meta.env.VITE_BLIND_ESCROW_ADDRESS || '';
export const TASK_REGISTRY_ADDRESS = import.meta.env.VITE_TASK_REGISTRY_ADDRESS || '';
export const BLIND_REPUTATION_ADDRESS = import.meta.env.VITE_BLIND_REPUTATION_ADDRESS || '';

// Founder addresses (comma-separated, lowercase). Used to gate the /metrics page.
// The backend enforces the same allowlist via FOUNDER_ADDRESSES — the env var
// here is purely for UX ("Not authorized" vs. wallet-not-connected).
export const FOUNDER_ADDRESSES: string[] = (import.meta.env.VITE_FOUNDER_ADDRESSES || '')
  .split(',')
  .map((s: string) => s.trim().toLowerCase())
  .filter(Boolean);

export const OG_CHAIN_CONFIG = {
  chainId: `0x${OG_CHAIN_ID.toString(16)}`,
  chainName: '0G Testnet',
  nativeCurrency: { name: 'A0GI', symbol: 'A0GI', decimals: 18 },
  rpcUrls: [OG_RPC_URL],
  blockExplorerUrls: ['https://chainscan-newton.0g.ai'],
} as const;

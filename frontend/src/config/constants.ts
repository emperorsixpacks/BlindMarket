export const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const IS_PROD = import.meta.env.PROD;

export const OG_CHAIN_ID = Number(
  import.meta.env.VITE_OG_CHAIN_ID || (IS_PROD ? '16661' : '16602')
);

export const isMainnet = OG_CHAIN_ID === 16661;

export const OG_RPC_URL =
  import.meta.env.VITE_OG_RPC_URL ||
  (IS_PROD ? 'https://evmrpc.0g.ai' : 'https://evmrpc-testnet.0g.ai');

export const BLIND_ESCROW_ADDRESS =
  import.meta.env.VITE_BLIND_ESCROW_ADDRESS ||
  (IS_PROD ? '0x3d0374963DaaD43e31d42373eb11156A8e8ce2Ff' : '0x7B420523E2b5d6C0f0e5deF75b1D9a901167f041');

export const TASK_REGISTRY_ADDRESS =
  import.meta.env.VITE_TASK_REGISTRY_ADDRESS ||
  (IS_PROD ? '0x9CCF9c196006B573FaA9C9c9CebDd1296dbd5cE0' : '0xF6AaCce326fD7f25860f383f18A771E5d089ea8c');

export const BLIND_REPUTATION_ADDRESS =
  import.meta.env.VITE_BLIND_REPUTATION_ADDRESS ||
  (IS_PROD ? '0x3af9232009C5da30AdA366B6E09849A040162A1a' : '0xFEAFe4ab073FfB47aBb5AD458622b3F9B10C81dD');

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

// ── Multi-chain support ────────────────────────────────────────────────────

export const SUPPORTED_CHAINS = ['og', 'sui'] as const;
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

// Sui chain config
export const SUI_NETWORK_ID =
  (import.meta.env.VITE_SUI_NETWORK_ID as 'mainnet' | 'testnet' | 'devnet' | 'local' | undefined) ?? 'testnet';

export const SUI_RPC_URL =
  import.meta.env.VITE_SUI_RPC_URL ||
  (SUI_NETWORK_ID === 'mainnet'
    ? 'https://fullnode.mainnet.sui.io:443'
    : SUI_NETWORK_ID === 'devnet'
      ? 'https://fullnode.devnet.sui.io:443'
      : 'https://fullnode.testnet.sui.io:443');

export const SUI_PACKAGE_ID = import.meta.env.VITE_SUI_PACKAGE_ID || '0x0';

export const SUI_EXPLORER_URL =
  import.meta.env.VITE_SUI_EXPLORER_URL ||
  (SUI_NETWORK_ID === 'mainnet'
    ? 'https://suivision.xyz'
    : `https://${SUI_NETWORK_ID}.suivision.xyz`);

export const SUI_BLIND_ESCROW_OBJECT_ID =
  import.meta.env.VITE_SUI_BLIND_ESCROW_OBJECT_ID || '0x0';

export const SUI_TASK_REGISTRY_OBJECT_ID =
  import.meta.env.VITE_SUI_TASK_REGISTRY_OBJECT_ID || '0x0';

export const SUI_BLIND_REPUTATION_OBJECT_ID =
  import.meta.env.VITE_SUI_BLIND_REPUTATION_OBJECT_ID || '0x0';

export function suiChainName(): string {
  return SUI_NETWORK_ID === 'mainnet' ? 'Sui Mainnet' : `Sui ${SUI_NETWORK_ID.charAt(0).toUpperCase() + SUI_NETWORK_ID.slice(1)}`;
}

export const SUI_CHAIN_CONFIG = {
  chainName: suiChainName(),
  networkId: SUI_NETWORK_ID,
  rpcUrl: SUI_RPC_URL,
  packageId: SUI_PACKAGE_ID,
  escrowObjectId: SUI_BLIND_ESCROW_OBJECT_ID,
  taskRegistryObjectId: SUI_TASK_REGISTRY_OBJECT_ID,
  reputationObjectId: SUI_BLIND_REPUTATION_OBJECT_ID,
  explorerUrl: SUI_EXPLORER_URL,
  nativeCurrency: { name: 'SUI', symbol: 'SUI', decimals: 9 },
} as const;

export const CHAIN_CONFIGS = {
  og: OG_CHAIN_CONFIG,
  sui: SUI_CHAIN_CONFIG,
} as const;

export function getChainConfig(chain: SupportedChain) {
  return CHAIN_CONFIGS[chain];
}

export function getNativeCurrency(chain: SupportedChain) {
  return getChainConfig(chain).nativeCurrency;
}


import { defineChain } from 'viem';
import { OG_CHAIN_ID, OG_RPC_URL } from './constants';

// `id`/`rpc` are env-driven (OG_CHAIN_ID = 16661 in prod), so this is the
// active chain on each environment — the labels below follow the chain id too
// rather than hardcoding testnet. (Const name kept for import stability.)
const isMainnetChain = OG_CHAIN_ID === 16661;

export const ogTestnet = defineChain({
  id: OG_CHAIN_ID,
  name: isMainnetChain ? '0G Mainnet' : '0G Testnet',
  network: isMainnetChain ? '0g-mainnet' : '0g-testnet',
  nativeCurrency: { decimals: 18, name: '0G', symbol: '0G' },
  rpcUrls: { default: { http: [OG_RPC_URL] } },
  blockExplorers: {
    default: {
      name: '0G Scan',
      url: isMainnetChain ? 'https://chainscan.0g.ai' : 'https://chainscan-galileo.0g.ai',
    },
  },
});

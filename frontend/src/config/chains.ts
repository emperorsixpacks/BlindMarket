import { defineChain } from 'viem';
import { OG_CHAIN_ID, OG_RPC_URL } from './constants';

export const ogTestnet = defineChain({
  id: OG_CHAIN_ID,
  name: '0G Testnet',
  network: '0g-testnet',
  nativeCurrency: { decimals: 18, name: 'A0GI', symbol: 'A0GI' },
  rpcUrls: { default: { http: [OG_RPC_URL] } },
  blockExplorers: { default: { name: '0G Scan', url: 'https://chainscan-galileo.0g.ai' } },
});

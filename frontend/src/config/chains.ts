import { defineChain } from 'viem';

export const ogTestnet = defineChain({
  id: 16602,
  name: '0G Testnet',
  network: '0g-testnet',
  nativeCurrency: { decimals: 18, name: 'A0GI', symbol: 'A0GI' },
  rpcUrls: { default: { http: ['https://rpc.ankr.com/0g_galileo_testnet_evm'] } },
  blockExplorers: { default: { name: '0G Scan', url: 'https://chainscan-galileo.0g.ai' } },
});

import type { Network } from '../chain/domain-types.js';

/**
 * Known-good network presets. Addresses pinned per SDK version so upgrading
 * the SDK cannot silently move contracts under a consumer.
 */

/** Alias for backward compatibility. Prefer 'og-testnet' for new code. */
export type NetworkName =
  | 'testnet'       // deprecated alias → og-testnet
  | 'og-testnet'
  | 'og-mainnet'
  | 'sui-testnet'
  | 'sui-mainnet'
  | 'sui-devnet'
  | 'sui-local';

export const networks = {
  // ── 0G EVM chains ─────────────────────────────────────────────────────

  'og-testnet': {
    name: '0g-galileo-testnet',
    chainType: 'evm' as const,
    chainId: 16602,
    rpc: ['https://evmrpc-testnet.0g.ai'],
    contracts: {
      escrow: '0xFd4F93F5A7BE144c405D1D8fbEC63Fb776207681',
      registry: '0xeE52d780A47F77E8a4a1cEb236e3C65A48FbD828',
      reputation: '0x4A6374Fae37E19E69ba43E7cf6994AC15F63256e',
      usdc: '0x317227efcA18D004E12CA8046AEf7E1597458F25',
    },
    indexer: 'https://indexer-storage-testnet-turbo.0g.ai',
    broker: 'https://broker.testnet.0g.ai',
    explorer: 'https://chainscan-galileo.0g.ai',
  },

  'og-mainnet': {
    name: '0g-mainnet',
    chainType: 'evm' as const,
    chainId: 16661,
    rpc: ['https://evmrpc.0g.ai'],
    contracts: {
      escrow: '0x3d0374963DaaD43e31d42373eb11156A8e8ce2Ff',
      registry: '0x9CCF9c196006B573FaA9C9c9CebDd1296dbd5cE0',
      reputation: '0x3af9232009C5da30AdA366B6E09849A040162A1a',
      usdc: '0x0000000000000000000000000000000000000000',
    },
    indexer: 'https://indexer-storage-turbo.0g.ai',
    broker: 'https://brother.0g.ai',
    explorer: 'https://chainscan.0g.ai',
  },

  // ── Sui chains ────────────────────────────────────────────────────────
  // Package IDs and shared object IDs are placeholders — update after
  // deploying the Move contracts via `sui client publish`.

  'sui-testnet': {
    name: 'sui-testnet',
    chainType: 'sui' as const,
    networkId: 'testnet' as const,
    rpc: ['https://fullnode.testnet.sui.io:443'],
    packageId: '0xe74d57b9f55eba50b9c6f0b3c09e4892a1b00f842461df16eb5bebe02a4a3f35',
    sharedObjects: {
      blindEscrow: '0x14c90c14d60b918706e04688f1bb6df617e8134462c56822bf4d546c37a9f6ef',
      taskRegistry: '0x379864da638d2212aa11b9048dfe7ab48860075b06f8c2470681cd052bdccdf5',
      blindReputation: '0x1769c6f22a00fcf4a4493c07eb7cf063915e664768a12aae61feea1b9e5e2fb7',
    },
    explorer: 'https://testnet.suivision.xyz',
  },

  'sui-mainnet': {
    name: 'sui-mainnet',
    chainType: 'sui' as const,
    networkId: 'mainnet' as const,
    rpc: ['https://fullnode.mainnet.sui.io:443'],
    packageId: '0x0',   // placeholder — replace with deployed package ID
    sharedObjects: {
      blindEscrow: '0x0',
      taskRegistry: '0x0',
      blindReputation: '0x0',
    },
    explorer: 'https://suivision.xyz',
  },

  'sui-devnet': {
    name: 'sui-devnet',
    chainType: 'sui' as const,
    networkId: 'devnet' as const,
    rpc: ['https://fullnode.devnet.sui.io:443'],
    packageId: '0x0',   // placeholder
    sharedObjects: {
      blindEscrow: '0x0',
      taskRegistry: '0x0',
      blindReputation: '0x0',
    },
    explorer: 'https://devnet.suivision.xyz',
  },

  'sui-local': {
    name: 'sui-local',
    chainType: 'sui' as const,
    networkId: 'local' as const,
    rpc: ['http://127.0.0.1:9000'],
    packageId: '0x0',   // placeholder
    sharedObjects: {
      blindEscrow: '0x0',
      taskRegistry: '0x0',
      blindReputation: '0x0',
    },
  },

  // ── Backward-compat alias ──────────────────────────────────────────────
  // Kept so existing code referencing 'testnet' doesn't break.

  testnet: {
    name: '0g-galileo-testnet',
    chainType: 'evm' as const,
    chainId: 16602,
    rpc: ['https://evmrpc-testnet.0g.ai'],
    contracts: {
      escrow: '0xFd4F93F5A7BE144c405D1D8fbEC63Fb776207681',
      registry: '0xeE52d780A47F77E8a4a1cEb236e3C65A48FbD828',
      reputation: '0x4A6374Fae37E19E69ba43E7cf6994AC15F63256e',
      usdc: '0x317227efcA18D004E12CA8046AEf7E1597458F25',
    },
    indexer: 'https://indexer-storage-testnet-turbo.0g.ai',
    broker: 'https://broker.testnet.0g.ai',
    explorer: 'https://chainscan-galileo.0g.ai',
  },
} as const satisfies Record<NetworkName, Network>;

import type { Address, Hex, TaskId, TaskStatus } from '../types.js';

// ── Chain-agnostic domain types ───────────────────────────────────────────
// These types are the BlindMarket domain model, independent of any specific
// blockchain. Each chain adapter translates between these and its native
// contract types.

export type BlockchainType = 'evm' | 'sui';

/** Base fields shared by all chain network configs. */
export interface NetworkBase {
  name: string;
  chainType: BlockchainType;
  rpc: string[];
  explorer?: string;
}

/** EVM-compatible chain network config (0G, Ethereum, Polygon, etc.). */
export interface EVMNetwork extends NetworkBase {
  chainType: 'evm';
  chainId: number;
  contracts: {
    escrow: Address;
    registry: Address;
    reputation: Address;
    usdc: Address;
  };
  indexer?: string;
  broker?: string;
}

/** Sui chain network config. */
export interface SuiNetwork extends NetworkBase {
  chainType: 'sui';
  /** Sui network identifier (e.g. 'mainnet', 'testnet', 'devnet'). */
  networkId: 'mainnet' | 'testnet' | 'devnet' | 'local';
  packageId: string;
  sharedObjects: {
    blindEscrow: string;
    taskRegistry: string;
    blindReputation: string;
    agentNft?: string;
  };
}

/** Union of all supported chain network configs. */
export type Network = EVMNetwork | SuiNetwork;

/** Parameters for creating a task on any chain. */
export interface CreateTaskParams {
  taskHash: Hex;
  token: Address | string;
  amount: bigint;
  category: string;
  locationZone: string;
  deadline: bigint;
  /** Per-task verifier address (agent-verification mode). Optional. */
  verifierAgent?: string;
}

/** Decoded on-chain task representation (chain-agnostic). */
export interface DomainTask {
  taskId: TaskId;
  agent: string;
  worker: string;
  token: string;
  amount: bigint;
  taskHash: Hex;
  evidenceHash: Hex;
  status: TaskStatus;
  category: string;
  locationZone: string;
  createdAt: Date;
  deadline: Date;
}

/** Task metadata used for discovery / listing. */
export interface DomainTaskMeta {
  taskId: TaskId;
  agent: string;
  category: string;
  locationZone: string;
  reward: bigint;
  createdAt: Date;
  isOpen: boolean;
}

/** On-chain reputation snapshot (chain-agnostic). */
export interface DomainReputation {
  tasksCompleted: bigint;
  totalScore: bigint;
  disputes: bigint;
  avgScore: number;
}

/** Transaction receipt (chain-agnostic). */
export interface DomainTxReceipt {
  hash: string;
  blockNumber?: number;
  digest?: string;  // Sui uses digests instead of block numbers
}

/** Signer abstraction that works across chains. */
export interface ChainSigner {
  getAddress(): Promise<string>;
  getChainType(): BlockchainType;
}

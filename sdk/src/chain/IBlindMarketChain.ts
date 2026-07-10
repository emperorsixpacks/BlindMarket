import type {
  CreateTaskParams,
  DomainReputation,
  DomainTask,
  DomainTaskMeta,
  DomainTxReceipt,
  Network,
} from './domain-types.js';

/**
 * Chain-agnostic interface for BlindMarket on-chain operations.
 *
 * Every supported blockchain provides an adapter that implements this interface,
 * translating domain operations into chain-native contract calls. Consumers
 * (backend, agents, CLI) work against this interface and never need to know
 * which chain they're talking to.
 */
export interface IBlindMarketChain {
  // ── Chain identity ──────────────────────────────────────────────────────

  /** The resolved network config this adapter is connected to. */
  readonly network: Network;

  /** The address of the active signer. */
  getAddress(): Promise<string>;

  // ── Task lifecycle (BlindEscrow equivalent) ─────────────────────────────

  /**
   * Create a new task with escrowed funds.
   * Returns the assigned task ID and receipt.
   */
  createTask(params: CreateTaskParams): Promise<{ taskId: bigint; receipt: DomainTxReceipt }>;

  /** Assign a worker to a funded task. Caller must be the task agent. */
  assignWorker(taskId: bigint, worker: string): Promise<DomainTxReceipt>;

  /** Submit an evidence hash for an assigned task. Caller must be the worker. */
  submitEvidence(taskId: bigint, evidenceHash: string): Promise<DomainTxReceipt>;

  /** Complete verification for a submitted task (called by the verifier). */
  completeVerification(taskId: bigint, passed: boolean): Promise<DomainTxReceipt>;

  /** Cancel a funded/assigned task and return escrow to the agent. */
  cancelTask(taskId: bigint): Promise<DomainTxReceipt>;

  /** Claim escrow after timeout expiry (agent-side). */
  claimTimeout(taskId: bigint): Promise<DomainTxReceipt>;

  /** Raise a dispute on a task. */
  raiseDispute(taskId: bigint): Promise<DomainTxReceipt>;

  /** Resolve a dispute (admin only). */
  resolveDispute(taskId: bigint, workerFavored: boolean): Promise<DomainTxReceipt>;

  /** Read full on-chain task state. */
  getTask(taskId: bigint): Promise<DomainTask>;

  /** Check whether a task's deadline has passed. */
  isTaskExpired(taskId: bigint): Promise<boolean>;

  // ── Task discovery (TaskRegistry equivalent) ────────────────────────────

  /** Publish task metadata to the on-chain discovery index. */
  publishTask(taskId: bigint, meta: Omit<DomainTaskMeta, 'taskId'> & { taskId?: bigint }): Promise<DomainTxReceipt>;

  /** Remove a task from the discovery index (called on assignment/completion). */
  closeTask(taskId: bigint): Promise<DomainTxReceipt>;

  /** Get a page of open task IDs from the discovery index. */
  getOpenTasks(offset: bigint, limit: bigint): Promise<DomainTaskMeta[]>;

  /** Count of currently open tasks. */
  openTaskCount(): Promise<bigint>;

  /** Total tasks ever published. */
  totalTasks(): Promise<bigint>;

  // ── Reputation (BlindReputation equivalent) ─────────────────────────────

  /** Rate a worker after task completion (score 1-5). */
  rateWorker(worker: string, score: number, taskId: bigint): Promise<DomainTxReceipt>;

  /** Record a dispute against a worker. */
  recordDispute(worker: string, taskId: bigint): Promise<DomainTxReceipt>;

  /** Fetch on-chain reputation for a worker. */
  getReputation(worker: string): Promise<DomainReputation>;

  /** Check if a worker has already been rated for a given task. */
  hasBeenRated(worker: string, taskId: bigint): Promise<boolean>;

  // ── Agent identity (INFT equivalent) ────────────────────────────────────

  /** Mint an agent identity token. Returns the token ID and receipt. */
  mintAgent(params: {
    to: string;
    encryptedURI: string;
    metadataHash: string;
  }): Promise<{ tokenId: bigint; receipt: DomainTxReceipt }>;

  /** Read the encrypted metadata URI for an agent token. */
  getEncryptedURI(tokenId: bigint): Promise<string>;

  // ── Queries ──────────────────────────────────────────────────────────────

  /** Get native balance for an address. */
  getBalance(address: string): Promise<bigint>;
}
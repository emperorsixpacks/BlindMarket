import { ethers } from 'ethers';
import type { Address, Hex } from '../../types.js';
import { ChainClient, type ChainClientOptions } from '../ChainClient.js';
import { resolveNetwork } from '../../network/resolve.js';
import type { EthersSigner } from '../../signer/EthersSigner.js';
import type { Signer } from '../../signer/Signer.js';
import type {
  CreateTaskParams,
  DomainReputation,
  DomainTask,
  DomainTaskMeta,
  DomainTxReceipt,
  EVMNetwork,
} from '../domain-types.js';
import type { IBlindMarketChain } from '../IBlindMarketChain.js';
import type { OpenTaskMeta } from '../TaskRegistryClient.js';

/**
 * EVM-compatible implementation of IBlindMarketChain.
 *
 * Wraps the existing ChainClient (which bundles BlindEscrowClient,
 * TaskRegistryClient, and BlindReputationClient) and translates domain
 * operations into ethers v6 contract calls on EVM chains (0G, Ethereum, etc.).
 */
export class EVMChainAdapter implements IBlindMarketChain {
  readonly network: EVMNetwork;
  private client: ChainClient;
  private signer: EthersSigner | undefined;

  constructor(opts: ChainClientOptions) {
    const resolved = resolveNetwork(opts.network);
    if (resolved.chainType !== 'evm') {
      throw new Error(`EVMChainAdapter requires an EVM network, got ${resolved.chainType}`);
    }
    this.network = resolved;
    this.client = new ChainClient(opts);
    this.signer = opts.signer as EthersSigner | undefined;
  }

  async getAddress(): Promise<string> {
    if (!this.signer) throw new Error('No signer configured');
    return this.signer.getAddress();
  }

  // ── Task lifecycle ──────────────────────────────────────────────────────

  async createTask(params: CreateTaskParams): Promise<{ taskId: bigint; receipt: DomainTxReceipt }> {
    const result = await this.client.escrow.createTask({
      taskHash: params.taskHash,
      token: params.token as Address,
      amount: params.amount,
      category: params.category,
      locationZone: params.locationZone,
      deadline: params.deadline,
    });
    return {
      taskId: result.taskId,
      receipt: {
        hash: result.receipt.hash,
        blockNumber: result.receipt.blockNumber,
      },
    };
  }

  async assignWorker(taskId: bigint, worker: string): Promise<DomainTxReceipt> {
    const receipt = await this.client.escrow.assignWorker(taskId, worker as Address);
    return { hash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async submitEvidence(taskId: bigint, evidenceHash: string): Promise<DomainTxReceipt> {
    const receipt = await this.client.escrow.submitEvidence(taskId, evidenceHash as Hex);
    return { hash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async completeVerification(taskId: bigint, passed: boolean): Promise<DomainTxReceipt> {
    const receipt = await this.client.escrow.completeVerification(taskId, passed);
    return { hash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async cancelTask(taskId: bigint): Promise<DomainTxReceipt> {
    const receipt = await this.client.escrow.cancelTask(taskId);
    return { hash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async claimTimeout(taskId: bigint): Promise<DomainTxReceipt> {
    const receipt = await this.client.escrow.claimTimeout(taskId);
    return { hash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async raiseDispute(taskId: bigint): Promise<DomainTxReceipt> {
    const receipt = await this.client.escrow.raiseDispute(taskId);
    return { hash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async resolveDispute(taskId: bigint, workerFavored: boolean): Promise<DomainTxReceipt> {
    const receipt = await this.client.escrow.resolveDispute(taskId, workerFavored);
    return { hash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async getTask(taskId: bigint): Promise<DomainTask> {
    const onChain = await this.client.escrow.getTask(taskId);
    return {
      ...onChain,
      category: '',        // OnChainTask doesn't decode these contract fields;
      locationZone: '',    // they are present in the Solidity Task struct.
    };
  }

  async isTaskExpired(taskId: bigint): Promise<boolean> {
    return this.client.escrow.isTaskExpired(taskId);
  }

  // ── Task discovery ──────────────────────────────────────────────────────

  async publishTask(taskId: bigint, _meta: Omit<DomainTaskMeta, 'taskId'> & { taskId?: bigint }): Promise<DomainTxReceipt> {
    // The EVM contracts publish tasks via the escrow's TaskCreated event
    // (handled by the backend indexer). This is a no-op at the adapter level
    // for EVM — the registry is updated by the escrow contract internally.
    // Return a stub receipt for interface compatibility.
    return { hash: '0x0', blockNumber: 0 };
  }

  async closeTask(taskId: bigint): Promise<DomainTxReceipt> {
    const receipt = await this.client.registry.closeTask(taskId);
    return { hash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async getOpenTasks(offset: bigint, limit: bigint): Promise<DomainTaskMeta[]> {
    const taskIds = await this.client.registry.getOpenTasks(offset, limit);
    const metas = await Promise.all(
      taskIds.map(async (tid: bigint) => {
        const meta = await this.client.registry.getTaskMeta(tid);
        return {
          taskId: tid,
          agent: '' as Address, // EVM TaskRegistry stores agent; use meta directly
          category: meta.category,
          locationZone: meta.locationZone,
          reward: meta.reward,
          createdAt: meta.createdAt,
          isOpen: true,
        } as DomainTaskMeta;
      }),
    );
    return metas;
  }

  async openTaskCount(): Promise<bigint> {
    return this.client.registry.openTaskCount();
  }

  async totalTasks(): Promise<bigint> {
    return this.client.registry.totalTasks();
  }

  // ── Reputation ──────────────────────────────────────────────────────────

  async rateWorker(worker: string, score: number, taskId: bigint): Promise<DomainTxReceipt> {
    const receipt = await this.client.reputation.rate(worker as Address, score, taskId);
    return { hash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async recordDispute(worker: string, taskId: bigint): Promise<DomainTxReceipt> {
    // EVM BlindReputation doesn't expose recordDispute as a standalone client
    // method in the SDK — the escrow calls it internally. For external callers
    // we throw. The escrow contract handles dispute recording via its own path.
    throw new Error('recordDispute is handled internally by BlindEscrow on EVM chains');
  }

  async getReputation(worker: string): Promise<DomainReputation> {
    return this.client.reputation.getReputation(worker as Address);
  }

  async hasBeenRated(worker: string, taskId: bigint): Promise<boolean> {
    return this.client.reputation.hasBeenRated(worker as Address, taskId);
  }

  // ── Agent identity ──────────────────────────────────────────────────────

  async mintAgent(params: {
    to: string;
    encryptedURI: string;
    metadataHash: string;
  }): Promise<{ tokenId: bigint; receipt: DomainTxReceipt }> {
    // INFT minting is handled by the backend (services/chain.ts → inft.mint()).
    // The SDK doesn't expose a direct INFT client. For direct EVM calls,
    // consumers can use the raw ethers.Contract via the unwrapped signer.
    throw new Error('INFT minting is backend-managed on EVM chains. Use the REST API or raw ethers.Contract.');
  }

  async getEncryptedURI(_tokenId: bigint): Promise<string> {
    throw new Error('INFT URI reading is backend-managed on EVM chains. Use the REST API or raw ethers.Contract.');
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  async getBalance(address: string): Promise<bigint> {
    return this.client.provider.getBalance(address);
  }

  // ── Accessors for direct ethers access (advanced use) ───────────────────

  /** Get the underlying ethers Provider for raw queries. */
  getProvider(): ethers.Provider {
    return this.client.provider;
  }

  /** Get the underlying ethers Signer (if configured). */
  getEthersSigner(): ethers.Signer | undefined {
    if (!this.signer) return undefined;
    return (this.signer as unknown as { inner?: ethers.Signer }).inner;
  }
}

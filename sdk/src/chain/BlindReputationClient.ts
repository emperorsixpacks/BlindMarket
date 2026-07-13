import { ethers } from 'ethers';
import type { Address, Hex, TaskId, TxReceiptLike } from '../types.js';
import { BlindReputationAbi } from './abi/index.js';
import { wrapChainError } from './errors.js';

export interface ReputationSnapshot {
  tasksCompleted: bigint;
  /** Raw on-chain value. NOTE: despite the name, the contract returns the
   *  average rating already scaled ×100 (450 = 4.50), NOT a cumulative sum. */
  totalScore: bigint;
  disputes: bigint;
  /** 0–5 average rating. */
  avgScore: number;
}

export class BlindReputationClient {
  readonly contract: ethers.Contract;
  readonly address: Address;

  constructor(address: Address, runner: ethers.ContractRunner) {
    this.address = address;
    this.contract = new ethers.Contract(address, BlindReputationAbi, runner);
  }

  async getReputation(worker: Address): Promise<ReputationSnapshot> {
    try {
      const raw = (await this.contract.getReputation!(worker)) as unknown as unknown[];
      const tasksCompleted = BigInt(raw[0] as bigint | number);
      // raw[1] is already avgScore × 100 (contract getReputation returns the
      // average scaled ×100, "450 = 4.50") — divide by 100 only, NOT by tasks.
      const totalScore = BigInt(raw[1] as bigint | number);
      const disputes = BigInt(raw[2] as bigint | number);
      const avgScore = Number(totalScore) / 100;
      return { tasksCompleted, totalScore, disputes, avgScore };
    } catch (err) {
      throw wrapChainError(err, 'getReputation');
    }
  }

  async rate(worker: Address, score: number, taskId: TaskId): Promise<TxReceiptLike> {
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw wrapChainError(new Error(`score must be integer 1..5, got ${score}`), 'rate');
    }
    try {
      const tx = await this.contract.rate!(worker, score, taskId);
      const rec = await tx.wait(1);
      return { hash: rec.hash as Hex, blockNumber: rec.blockNumber, gasUsed: rec.gasUsed };
    } catch (err) {
      throw wrapChainError(err, 'rate');
    }
  }

  async hasBeenRated(worker: Address, taskId: TaskId): Promise<boolean> {
    try {
      return Boolean(await this.contract.hasBeenRated!(worker, taskId));
    } catch (err) {
      throw wrapChainError(err, 'hasBeenRated');
    }
  }
}

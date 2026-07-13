import { ethers } from 'ethers';
import type { Address, Hex, TaskId, TaskStatus, TxReceiptLike } from '../types.js';
import { BlindEscrowAbi } from './abi/index.js';
import { wrapChainError } from './errors.js';

const STATUS_BY_INDEX: TaskStatus[] = ['funded', 'assigned', 'submitted', 'verified', 'completed', 'cancelled', 'disputed'];

export interface CreateTaskArgs {
  taskHash: Hex;
  token: Address;
  amount: bigint;
  category: string;
  locationZone: string;
  deadline: bigint;
}

export interface OnChainTask {
  taskId: TaskId;
  agent: Address;
  worker: Address;
  token: Address;
  amount: bigint;
  taskHash: Hex;
  evidenceHash: Hex;
  status: TaskStatus;
  category: string;
  locationZone: string;
  createdAt: Date;
  deadline: Date;
}

/**
 * Typed ethers v6 wrapper for the BlindEscrow contract. Every state-changing
 * method awaits one confirmation and returns a TxReceiptLike; every read
 * returns decoded values. Ethers errors are mapped to ChainError via
 * wrapChainError().
 */
export class BlindEscrowClient {
  readonly contract: ethers.Contract;
  readonly address: Address;

  constructor(address: Address, runner: ethers.ContractRunner) {
    this.address = address;
    this.contract = new ethers.Contract(address, BlindEscrowAbi, runner);
  }

  /** Create a task and return its id + receipt. Reads the TaskCreated event for the id. */
  async createTask(args: CreateTaskArgs): Promise<{ taskId: TaskId; receipt: TxReceiptLike }> {
    try {
      const overrides: ethers.Overrides = {};
      if (args.token === '0x0000000000000000000000000000000000000000') {
        overrides.value = args.amount;
      }
      const tx = await this.contract.createTask!(
        args.taskHash,
        args.token,
        args.amount,
        args.category,
        args.locationZone,
        args.deadline,
        overrides,
      );
      const rec = await tx.wait(1);
      const taskId = this.extractTaskIdFromReceipt(rec);
      return { taskId, receipt: toReceipt(rec) };
    } catch (err) {
      throw wrapChainError(err, 'createTask');
    }
  }

  async assignWorker(taskId: TaskId, worker: Address): Promise<TxReceiptLike> {
    return this.sendTx('assignWorker', [taskId, worker]);
  }

  async submitEvidence(taskId: TaskId, evidenceHash: Hex): Promise<TxReceiptLike> {
    return this.sendTx('submitEvidence', [taskId, evidenceHash]);
  }

  async completeVerification(taskId: TaskId, passed: boolean): Promise<TxReceiptLike> {
    return this.sendTx('completeVerification', [taskId, passed]);
  }

  async cancelTask(taskId: TaskId): Promise<TxReceiptLike> {
    return this.sendTx('cancelTask', [taskId]);
  }

  async raiseDispute(taskId: TaskId): Promise<TxReceiptLike> {
    return this.sendTx('raiseDispute', [taskId]);
  }

  async resolveDispute(taskId: TaskId, workerFavored: boolean): Promise<TxReceiptLike> {
    return this.sendTx('resolveDispute', [taskId, workerFavored]);
  }

  async claimTimeout(taskId: TaskId): Promise<TxReceiptLike> {
    return this.sendTx('claimTimeout', [taskId]);
  }

  async getTask(taskId: TaskId): Promise<OnChainTask> {
    try {
      const raw = await this.contract.getTask!(taskId);
      return decodeTask(taskId, raw);
    } catch (err) {
      throw wrapChainError(err, 'getTask');
    }
  }

  async isTaskExpired(taskId: TaskId): Promise<boolean> {
    try {
      return Boolean(await this.contract.isTaskExpired!(taskId));
    } catch (err) {
      throw wrapChainError(err, 'isTaskExpired');
    }
  }

  async nextTaskId(): Promise<TaskId> {
    try {
      return BigInt(await this.contract.nextTaskId!());
    } catch (err) {
      throw wrapChainError(err, 'nextTaskId');
    }
  }

  async feeBps(): Promise<bigint> {
    try {
      return BigInt(await this.contract.feeBps!());
    } catch (err) {
      throw wrapChainError(err, 'feeBps');
    }
  }

  private async sendTx(method: string, args: unknown[]): Promise<TxReceiptLike> {
    try {
      const fn = this.contract[method];
      if (typeof fn !== 'function') {
        throw new Error(`unknown contract method: ${method}`);
      }
      const tx = await fn(...args);
      const rec = await tx.wait(1);
      return toReceipt(rec);
    } catch (err) {
      throw wrapChainError(err, method);
    }
  }

  private extractTaskIdFromReceipt(receipt: ethers.ContractTransactionReceipt | null): TaskId {
    if (!receipt) throw new Error('no receipt');
    const iface = this.contract.interface;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === 'TaskCreated') {
          return BigInt(parsed.args.getValue('taskId'));
        }
      } catch {
        // not our event, skip
      }
    }
    throw new Error('TaskCreated event not found in receipt logs');
  }
}

function toReceipt(rec: ethers.ContractTransactionReceipt | null): TxReceiptLike {
  if (!rec) throw new Error('no receipt');
  return {
    hash: rec.hash as Hex,
    blockNumber: rec.blockNumber,
    gasUsed: rec.gasUsed,
  };
}

function decodeTask(taskId: TaskId, raw: ethers.Result): OnChainTask {
  // Live Task struct (12 fields) from BlindEscrow.getTask(): agent, worker,
  // token, amount, taskHash, evidenceHash, status, category, locationZone,
  // createdAt, deadline, submissionAttempts. The old decode read createdAt from
  // arr[7] (actually category) and deadline from arr[8] (actually locationZone),
  // yielding Invalid Date and discarding category/locationZone.
  const arr = raw as unknown as unknown[];
  const statusIndex = Number(arr[6]);
  const status = STATUS_BY_INDEX[statusIndex];
  if (!status) throw new Error(`BlindEscrow.getTask returned unknown status index ${statusIndex}`);
  return {
    taskId,
    agent: arr[0] as Address,
    worker: arr[1] as Address,
    token: arr[2] as Address,
    amount: BigInt(arr[3] as bigint | number),
    taskHash: arr[4] as Hex,
    evidenceHash: arr[5] as Hex,
    status,
    category: arr[7] as string,
    locationZone: arr[8] as string,
    createdAt: new Date(Number(arr[9] as bigint | number) * 1000),
    deadline: new Date(Number(arr[10] as bigint | number) * 1000),
  };
}

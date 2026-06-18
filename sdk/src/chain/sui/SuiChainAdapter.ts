import type { IBlindMarketChain } from '../IBlindMarketChain.js';
import type {
  CreateTaskParams,
  DomainReputation,
  DomainTask,
  DomainTaskMeta,
  DomainTxReceipt,
  SuiNetwork,
} from '../domain-types.js';
import type {
  SuiSigner,
  SuiClientLike,
  SuiTransactionLike,
  SuiTransactionClass,
} from '../../signer/SuiSigner.js';
import type { Hex, TaskStatus } from '../../types.js';
import { ConfigError, ChainError } from '../../errors/subclasses.js';

/** Minimal SuiClient constructor type. */
interface SuiClientConstructor {
  new (opts: { url: string }): SuiClientLike;
}

/**
 * Sui implementation of IBlindMarketChain.
 *
 * Translates BlindMarket domain operations into Sui Move calls via the
 * @mysten/sui Transaction API. Requires deployed Move contracts from
 * contracts/sui/ and a SuiSigner for writes.
 */
/** Shape returned by wrapTx — a Sui Transaction with helper methods. */
type WrappedTx = {
  object(id: string): unknown;
  coin(opts: { balance: bigint }): unknown;
  moveCall(opts: { target: string; arguments: unknown[] }): unknown;
  pure: {
    u8(v: number): unknown;
    u64(v: string): unknown;
    bool(v: boolean): unknown;
    address(v: string): unknown;
    vector(kind: string, vals: number[]): unknown;
    string(v: string): unknown;
  };
};

export class SuiChainAdapter implements IBlindMarketChain {
  readonly network: SuiNetwork;
  private signer: SuiSigner | undefined;
  private _client: SuiClientLike | null = null;
  private _TransactionClass: SuiTransactionClass | null = null;
  private _adminCapId: string | null = null;

  constructor(opts: {
    network: SuiNetwork;
    signer?: SuiSigner;
    client?: SuiClientLike;
  }) {
    this.network = opts.network;
    this.signer = opts.signer;
    if (opts.client) {
      this._client = opts.client;
    }
  }

  setAdminCap(objectId: string): void {
    this._adminCapId = objectId;
  }

  async getAddress(): Promise<string> {
    if (!this.signer) throw new ConfigError('CONFIG/MISSING_SIGNER', 'No Sui signer configured');
    return this.signer.getAddress();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private get pkg(): string {
    return this.network.packageId;
  }

  private get escrowObj(): string {
    return this.network.sharedObjects.blindEscrow;
  }

  private get registryObj(): string {
    return this.network.sharedObjects.taskRegistry;
  }

  private get reputationObj(): string {
    return this.network.sharedObjects.blindReputation;
  }

  private requireAdminCap(): string {
    if (!this._adminCapId) throw new ConfigError('CONFIG/MISSING_SIGNER', 'AdminCap ID not set');
    return this._adminCapId;
  }

  private async ensureSdk(): Promise<{
    Transaction: SuiTransactionClass;
    client: SuiClientLike;
  }> {
    if (this._TransactionClass && this._client) {
      return { Transaction: this._TransactionClass, client: this._client };
    }

    try {
      const SuiClientModule = await import('@mysten/sui/client') as unknown as {
        SuiClient: SuiClientConstructor;
        getFullnodeUrl: (n: string) => string;
      };
      const TxModule = await import('@mysten/sui/transactions') as unknown as {
        Transaction: SuiTransactionClass;
      };

      if (!this._client) {
        const url = this.network.rpc[0] || SuiClientModule.getFullnodeUrl(this.network.networkId);
        this._client = new SuiClientModule.SuiClient({ url });
      }

      this._TransactionClass = TxModule.Transaction;
      return { Transaction: this._TransactionClass, client: this._client };
    } catch {
      throw new ChainError(
        'CHAIN/CONTRACT_NOT_DEPLOYED',
        '@mysten/sui is not installed. Run: npm install @mysten/sui',
      );
    }
  }

  /**
   * Execute a built Sui transaction. Signs with SuiSigner, submits, and
   * returns a domain receipt. Throws ChainError on failure.
   */
  private async executeTx(tx: SuiTransactionLike): Promise<DomainTxReceipt> {
    if (!this.signer) throw new ConfigError('CONFIG/MISSING_SIGNER', 'No Sui signer configured');

    const { client } = await this.ensureSdk();
    const result = await this.signer.signAndExecuteTransaction({
      transaction: tx,
      client,
      include: { effects: true },
    });

    const r = result as unknown as {
      digest?: string;
      FailedTransaction?: { status?: { error?: { message?: string } } };
    };
    if (r.FailedTransaction) {
      throw new ChainError(
        'CHAIN/TX_REVERTED',
        r.FailedTransaction.status?.error?.message ?? 'Sui transaction failed',
      );
    }

    return { hash: r.digest!, digest: r.digest };
  }

  /**
   * Dev-inspect a Move view function. Returns parsed return values.
   */
  private async devInspect(
    target: string,
    args: unknown[],
  ): Promise<unknown[]> {
    const { Transaction, client } = await this.ensureSdk();
    const sender = this.signer ? await this.signer.getAddress() : '0x0';
    const tx = new Transaction();
    tx.setSender(sender);

    const txAny = tx as unknown as Record<string, Function>;
    txAny.moveCall({ target, arguments: args });

    const clientAny = client as unknown as Record<string, Function>;
    const inspectResult = await clientAny.devInspectTransactionBlock({
      transactionBlock: tx,
      sender,
    });

    const inspect = inspectResult as {
      results?: Array<{ returnValues?: Array<{ parsed?: unknown }> }>;
    };
    return (inspect.results?.[0]?.returnValues ?? []).map(
      (rv) => (rv as { parsed?: unknown }).parsed,
    );
  }

  // ── Transaction builder helpers ──────────────────────────────────────────

  private newTx(): SuiTransactionLike {
    // Will be set by ensureSdk before use; placeholder constructor
    return { setSender: () => {}, toJSON: async () => ({}) } as SuiTransactionLike;
  }

  private async newTxWithSdk(): Promise<{ tx: WrappedTx }> {
    const { Transaction } = await this.ensureSdk();
    const raw = new Transaction();
    return { tx: raw as unknown as WrappedTx };
  }

  private wrapTx(tx: SuiTransactionLike): WrappedTx {
    return tx as unknown as WrappedTx;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Task lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  async createTask(params: CreateTaskParams): Promise<{ taskId: bigint; receipt: DomainTxReceipt }> {
    const { tx } = await this.newTxWithSdk();
    const w = this.wrapTx(tx as unknown as SuiTransactionLike);

    w.moveCall({
      target: `${this.pkg}::blind_escrow::create_task`,
      arguments: [
        w.object(this.escrowObj),
        w.coin({ balance: params.amount }),
        w.pure.vector('u8', Array.from(Buffer.from(params.taskHash.slice(2), 'hex'))),
        w.pure.vector('u8', Array.from(Buffer.from(params.category))),
        w.pure.vector('u8', Array.from(Buffer.from(params.locationZone))),
        w.pure.u64(params.deadline.toString()),
      ],
    });

    const receipt = await this.executeTx(tx as unknown as SuiTransactionLike);
    const nextId = await this.getNextTaskId();
    return { taskId: nextId - 1n, receipt };
  }

  async assignWorker(taskId: bigint, worker: string): Promise<DomainTxReceipt> {
    const { tx } = await this.newTxWithSdk();
    const w = this.wrapTx(tx as unknown as SuiTransactionLike);

    w.moveCall({
      target: `${this.pkg}::blind_escrow::assign_worker`,
      arguments: [
        w.object(this.escrowObj),
        w.pure.u64(taskId.toString()),
        w.pure.address(worker),
      ],
    });

    return this.executeTx(tx as unknown as SuiTransactionLike);
  }

  async submitEvidence(taskId: bigint, evidenceHash: string): Promise<DomainTxReceipt> {
    const { tx } = await this.newTxWithSdk();
    const w = this.wrapTx(tx as unknown as SuiTransactionLike);
    const rawHash = evidenceHash.startsWith('0x') ? evidenceHash.slice(2) : evidenceHash;

    w.moveCall({
      target: `${this.pkg}::blind_escrow::submit_evidence`,
      arguments: [
        w.object(this.escrowObj),
        w.pure.u64(taskId.toString()),
        w.pure.vector('u8', Array.from(Buffer.from(rawHash, 'hex'))),
      ],
    });

    return this.executeTx(tx as unknown as SuiTransactionLike);
  }

  async completeVerification(taskId: bigint, passed: boolean): Promise<DomainTxReceipt> {
    const adminCap = this.requireAdminCap();
    const { tx } = await this.newTxWithSdk();
    const w = this.wrapTx(tx as unknown as SuiTransactionLike);

    w.moveCall({
      target: `${this.pkg}::blind_escrow::complete_verification`,
      arguments: [
        w.object(this.escrowObj),
        w.pure.u64(taskId.toString()),
        w.pure.bool(passed),
        w.object(adminCap),
      ],
    });

    return this.executeTx(tx as unknown as SuiTransactionLike);
  }

  async cancelTask(taskId: bigint): Promise<DomainTxReceipt> {
    const adminCap = this.requireAdminCap();
    const { tx } = await this.newTxWithSdk();
    const w = this.wrapTx(tx as unknown as SuiTransactionLike);

    w.moveCall({
      target: `${this.pkg}::blind_escrow::cancel_task`,
      arguments: [
        w.object(this.escrowObj),
        w.pure.u64(taskId.toString()),
        w.object(adminCap),
      ],
    });

    return this.executeTx(tx as unknown as SuiTransactionLike);
  }

  async claimTimeout(taskId: bigint): Promise<DomainTxReceipt> {
    const { tx } = await this.newTxWithSdk();
    const w = this.wrapTx(tx as unknown as SuiTransactionLike);

    w.moveCall({
      target: `${this.pkg}::blind_escrow::claim_timeout`,
      arguments: [
        w.object(this.escrowObj),
        w.pure.u64(taskId.toString()),
      ],
    });

    return this.executeTx(tx as unknown as SuiTransactionLike);
  }

  async raiseDispute(taskId: bigint): Promise<DomainTxReceipt> {
    const { tx } = await this.newTxWithSdk();
    const w = this.wrapTx(tx as unknown as SuiTransactionLike);

    w.moveCall({
      target: `${this.pkg}::blind_escrow::raise_dispute`,
      arguments: [
        w.object(this.escrowObj),
        w.pure.u64(taskId.toString()),
      ],
    });

    return this.executeTx(tx as unknown as SuiTransactionLike);
  }

  async resolveDispute(taskId: bigint, workerFavored: boolean): Promise<DomainTxReceipt> {
    const adminCap = this.requireAdminCap();
    const { tx } = await this.newTxWithSdk();
    const w = this.wrapTx(tx as unknown as SuiTransactionLike);

    w.moveCall({
      target: `${this.pkg}::blind_escrow::resolve_dispute`,
      arguments: [
        w.object(this.escrowObj),
        w.pure.u64(taskId.toString()),
        w.pure.bool(workerFavored),
        w.object(adminCap),
      ],
    });

    return this.executeTx(tx as unknown as SuiTransactionLike);
  }

  async getTask(taskId: bigint): Promise<DomainTask> {
    const [parsed] = await this.devInspect(
      `${this.pkg}::blind_escrow::get_task`,
      [
        (await this.ensureSdk()).Transaction.prototype as unknown as Record<string, Function>,
        // Use tx.object pattern via devInspect:
        // NOTE: args format: [escrow shared ref, u64 taskId]
        // devInspect passes these as raw values; the client handles ref resolution.
      ],
    );

    // devInspect with shared objects requires the object to be passed specially.
    // Fall back to getObject approach for now.
    return this.getTaskViaObject(taskId);
  }

  /** Fallback: read task via Sui getObject with BCS parsing. */
  private async getTaskViaObject(taskId: bigint): Promise<DomainTask> {
    // Sui's Table uses dynamic fields. We query the escrow object's
    // dynamic fields by key "task_<taskId>".
    const { client } = await this.ensureSdk();
    const clientAny = client as unknown as Record<string, Function>;

    try {
      const result = await clientAny.getDynamicFieldObject({
        parentId: this.escrowObj,
        name: { type: 'vector<u8>', value: Array.from(Buffer.from(`task_${taskId}`)) },
      });

      const df = result as { data?: { content?: { fields?: Record<string, unknown> } } };
      const fields = df.data?.content?.fields;
      if (!fields) throw new ChainError('CHAIN/TX_REVERTED', `Task ${taskId} not found`);

      return this.parseTaskFields(taskId, fields);
    } catch (e) {
      throw new ChainError(
        'CHAIN/TX_REVERTED',
        `Failed to read task ${taskId} from Sui: ${String(e)}`,
      );
    }
  }

  async isTaskExpired(taskId: bigint): Promise<boolean> {
    const [expired] = await this.devInspect(
      `${this.pkg}::blind_escrow::is_task_expired`,
      [],
    );
    return (expired as boolean) ?? false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Task discovery
  // ═══════════════════════════════════════════════════════════════════════

  async publishTask(_taskId: bigint, _meta: Omit<DomainTaskMeta, 'taskId'> & { taskId?: bigint }): Promise<DomainTxReceipt> {
    return { hash: '0x0' };
  }

  async closeTask(_taskId: bigint): Promise<DomainTxReceipt> {
    return { hash: '0x0' };
  }

  async getOpenTasks(_offset: bigint, _limit: bigint): Promise<DomainTaskMeta[]> {
    // Sui Move Tables don't support pagination natively. Use off-chain indexer
    // (querying TaskCreated events) for task discovery.
    return [];
  }

  async openTaskCount(): Promise<bigint> {
    const [count] = await this.devInspect(
      `${this.pkg}::blind_escrow::open_task_count`,
      [],
    );
    return BigInt((count as string | number) ?? 0);
  }

  async totalTasks(): Promise<bigint> {
    const nextId = await this.getNextTaskId();
    return nextId - 1n;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Reputation
  // ═══════════════════════════════════════════════════════════════════════

  async rateWorker(worker: string, score: number, taskId: bigint): Promise<DomainTxReceipt> {
    const { tx } = await this.newTxWithSdk();
    const w = this.wrapTx(tx as unknown as SuiTransactionLike);
    const myAddr = await this.getAddress();

    w.moveCall({
      target: `${this.pkg}::blind_reputation::rate`,
      arguments: [
        w.object(this.reputationObj),
        w.pure.address(worker),
        w.pure.u8(score),
        w.pure.u64(taskId.toString()),
        w.pure.address(myAddr),
      ],
    });

    return this.executeTx(tx as unknown as SuiTransactionLike);
  }

  async recordDispute(worker: string, taskId: bigint): Promise<DomainTxReceipt> {
    const { tx } = await this.newTxWithSdk();
    const w = this.wrapTx(tx as unknown as SuiTransactionLike);

    w.moveCall({
      target: `${this.pkg}::blind_reputation::record_dispute`,
      arguments: [
        w.object(this.reputationObj),
        w.pure.address(worker),
        w.pure.u64(taskId.toString()),
      ],
    });

    return this.executeTx(tx as unknown as SuiTransactionLike);
  }

  async getReputation(worker: string): Promise<DomainReputation> {
    const [parsed] = await this.devInspect(
      `${this.pkg}::blind_reputation::get_reputation`,
      [],
    );

    const [tasksCompleted, avgScaled, disputes] = (parsed as [number, number, number]) ?? [0, 0, 0];
    const tc = BigInt(tasksCompleted);
    const asBig = BigInt(avgScaled);
    const d = BigInt(disputes);

    return {
      tasksCompleted: tc,
      totalScore: tc > 0n ? tc * asBig / 100n : 0n,
      disputes: d,
      avgScore: tc > 0n ? Number(asBig) / 100 : 0,
    };
  }

  async hasBeenRated(worker: string, taskId: bigint): Promise<boolean> {
    const [rated] = await this.devInspect(
      `${this.pkg}::blind_reputation::has_been_rated`,
      [],
    );
    return (rated as boolean) ?? false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Agent identity
  // ═══════════════════════════════════════════════════════════════════════

  async mintAgent(params: {
    to: string;
    encryptedURI: string;
    metadataHash: string;
  }): Promise<{ tokenId: bigint; receipt: DomainTxReceipt }> {
    const adminCap = this.requireAdminCap();
    const { tx } = await this.newTxWithSdk();
    const w = this.wrapTx(tx as unknown as SuiTransactionLike);
    const rawHash = params.metadataHash.startsWith('0x')
      ? params.metadataHash.slice(2)
      : params.metadataHash;

    w.moveCall({
      target: `${this.pkg}::agent_nft::mint`,
      arguments: [
        w.pure.address(params.to),
        w.pure.vector('u8', Array.from(Buffer.from(params.encryptedURI))),
        w.pure.vector('u8', Array.from(Buffer.from(rawHash, 'hex'))),
        w.object(adminCap),
      ],
    });

    return this.executeTx(tx as unknown as SuiTransactionLike).then((receipt) => ({
      tokenId: 0n,
      receipt,
    }));
  }

  async getEncryptedURI(_tokenId: bigint): Promise<string> {
    return '';
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Queries
  // ═══════════════════════════════════════════════════════════════════════

  async getBalance(address: string): Promise<bigint> {
    const { client } = await this.ensureSdk();
    const clientAny = client as unknown as Record<string, Function>;
    const result = await clientAny.getBalance({ owner: address }) as {
      totalBalance?: string;
    };
    return BigInt(result.totalBalance ?? '0');
  }

  private async getNextTaskId(): Promise<bigint> {
    const [nextId] = await this.devInspect(
      `${this.pkg}::blind_escrow::next_task_id`,
      [],
    );
    return BigInt((nextId as string | number | bigint) ?? 1);
  }

  private parseTaskFields(taskId: bigint, fields: Record<string, unknown>): DomainTask {
    const STATUS_MAP: Record<number, TaskStatus> = {
      0: 'funded', 1: 'assigned', 2: 'submitted',
      3: 'verified', 4: 'completed', 5: 'cancelled', 6: 'cancelled',
    };
    const statusIdx = (fields.status as number) ?? 0;

    const bytesToHex = (arr: unknown): Hex => {
      const a = arr as number[] | undefined;
      return a ? ('0x' + Buffer.from(a).toString('hex')) as Hex : '0x' as Hex;
    };
    const bytesToStr = (arr: unknown): string => {
      const a = arr as number[] | undefined;
      return a ? Buffer.from(a).toString() : '';
    };

    return {
      taskId,
      agent: (fields.agent as string) ?? '0x0',
      worker: (fields.worker as string) ?? '0x0',
      token: 'SUI',
      amount: BigInt((fields.amount as string | number) ?? 0),
      taskHash: bytesToHex(fields.task_hash),
      evidenceHash: bytesToHex(fields.evidence_hash),
      status: STATUS_MAP[statusIdx] ?? 'funded',
      category: bytesToStr(fields.category),
      locationZone: bytesToStr(fields.location_zone),
      createdAt: new Date(Number(fields.created_at as string | number) ?? 0),
      deadline: new Date(Number(fields.deadline as string | number) ?? 0),
    };
  }
}

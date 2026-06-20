import { BlindMarket } from '../index.js';
import { eciesDecrypt, aesDecrypt } from '../crypto/index.js';
import type {
  A2ATaskState, AgentCapability, ExecutorProfile, Message,
} from '../types.js';

// ── Config ──────────────────────────────────────────────────────────────────

export interface WorkerRuntimeConfig {
  apiKey: string;
  apiBase?: string;
  displayName: string;
  capabilities: AgentCapability[];
  executeTask: ExecuteTaskHandler;
  existingPrivateKey?: string;
  existingAddress?: string;
  existingPublicKey?: string;
  minReward?: string;
  preferredCapabilities?: AgentCapability[];
  browseIntervalMs?: number;
  watchIntervalMs?: number;
  maxConcurrentTasks?: number;
}

// ── Types ───────────────────────────────────────────────────────────────────

export type ExecuteTaskHandler = (ctx: TaskContext) => Promise<Record<string, unknown>>;

export interface TaskContext {
  taskId: string;
  task: A2ATaskState;
  instructions: string;
}

export interface TaskExecutionInfo {
  taskId: string;
  status: 'bidding' | 'assigned' | 'working' | 'submitted' | 'completed' | 'failed';
  task?: A2ATaskState;
  error?: string;
  startedAt: number;
}

export type WorkerRuntimeEvent =
  | { type: 'started' }
  | { type: 'stopped' }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'registered'; profile: ExecutorProfile }
  | { type: 'task_found'; taskId: string; task: A2ATaskState }
  | { type: 'task_bidded'; taskId: string }
  | { type: 'task_assigned'; taskId: string }
  | { type: 'task_accepted'; taskId: string }
  | { type: 'task_working'; taskId: string }
  | { type: 'task_executed'; taskId: string }
  | { type: 'task_submitted'; taskId: string; result: Record<string, unknown> }
  | { type: 'task_failed'; taskId: string; error: string }
  | { type: 'message_received'; message: Message; count: number }
  | { type: 'browse_done'; found: number }
  | { type: 'error'; error: string };

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS = {
  browseIntervalMs: 15_000,
  watchIntervalMs: 5_000,
  maxConcurrentTasks: 3,
};

// ── WorkerRuntime ───────────────────────────────────────────────────────────

export class WorkerRuntime {
  private bb: BlindMarket;
  private config: WorkerRuntimeConfig & typeof DEFAULTS;
  private wallet?: { address: string; privateKey: string; publicKey: string };
  private profile?: ExecutorProfile;
  private running = false;
  private paused = false;
  private browseTimer?: ReturnType<typeof setInterval>;
  private watchTimers = new Map<string, ReturnType<typeof setInterval>>();
  private executions = new Map<string, TaskExecutionInfo>();
  private listeners = new Set<(event: WorkerRuntimeEvent) => void>();

  constructor(config: WorkerRuntimeConfig) {
    this.config = { ...DEFAULTS, ...config };
    this.bb = new BlindMarket({ apiKey: config.apiKey, apiBase: config.apiBase });
  }

  // ── Status ──────────────────────────────────────────────────────────────

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get activeExecutions(): TaskExecutionInfo[] {
    return [...this.executions.values()];
  }

  /** Get own executor profile (available after start). */
  get executorProfile(): ExecutorProfile | undefined {
    return this.profile;
  }

  /** Get own wallet info (available after start). */
  get executorWallet(): { address: string; publicKey: string } | undefined {
    return this.wallet;
  }

  // ── Events ──────────────────────────────────────────────────────────────

  on(listener: (event: WorkerRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WorkerRuntimeEvent): void {
    for (const l of this.listeners) l(event);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<ExecutorProfile> {
    if (this.running) return this.profile!;

    // 1. Register or restore executor
    if (this.config.existingPrivateKey && this.config.existingAddress && this.config.existingPublicKey) {
      this.wallet = {
        address: this.config.existingAddress,
        privateKey: this.config.existingPrivateKey,
        publicKey: this.config.existingPublicKey,
      };
      // Fetch existing profile — backend identifies by API key
      const result = await this.bb.getExecutorProfile();
      this.profile = result.agent;
    } else {
      const result = await this.bb.createAgent({
        displayName: this.config.displayName,
        capabilities: this.config.capabilities,
        minReward: this.config.minReward,
        preferredCapabilities: this.config.preferredCapabilities,
      });
      this.wallet = {
        address: result.wallet.address,
        privateKey: result.wallet.privateKey,
        publicKey: result.wallet.publicKey,
      };
      this.profile = result.executor;
    }

    this.emit({ type: 'registered', profile: this.profile });

    // 2. Start the browse loop
    this.running = true;
    this.startBrowseLoop();
    this.emit({ type: 'started' });

    return this.profile;
  }

  stop(): void {
    this.running = false;
    if (this.browseTimer) {
      clearInterval(this.browseTimer);
      this.browseTimer = undefined;
    }
    for (const t of this.watchTimers.values()) clearInterval(t);
    this.watchTimers.clear();
    this.emit({ type: 'stopped' });
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.emit({ type: 'paused' });
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.emit({ type: 'resumed' });
    // Immediately browse instead of waiting for next interval
    this.browse();
  }

  // ── Browse loop ─────────────────────────────────────────────────────────

  private startBrowseLoop(): void {
    const ms = this.config.browseIntervalMs;
    this.browseTimer = setInterval(() => this.browse(), ms);
    this.browse();
  }

  private async browse(): Promise<void> {
    if (this.paused) return;
    try {
      const active = this.activeExecutions;
      const inFlight = active.filter(e => e.status === 'bidding' || e.status === 'working').length;
      if (inFlight >= this.config.maxConcurrentTasks) return;

      const result = await this.bb.browseA2ATasks({
        capabilities: this.config.capabilities,
      });

      this.emit({ type: 'browse_done', found: result.tasks.length });

      for (const task of result.tasks) {
        if (this.executions.has(task.taskId)) continue;
        if (task.status !== 'open' && task.status !== 'bidding') continue;
        if (task.executorAddress && task.executorAddress !== this.wallet?.address) continue;

        this.executions.set(task.taskId, {
          taskId: task.taskId,
          status: 'bidding',
          task,
          startedAt: Date.now(),
        });

        this.emit({ type: 'task_found', taskId: task.taskId, task });

        await this.bb.bidOnTask(task.taskId);
        this.emit({ type: 'task_bidded', taskId: task.taskId });

        this.watchForAssignment(task.taskId);
      }
    } catch (err) {
      this.emit({ type: 'error', error: `Browse failed: ${err}` });
    }
  }

  // ── Assignment watching ─────────────────────────────────────────────────

  private watchForAssignment(taskId: string): void {
    if (!this.running) return;
    const ms = this.config.watchIntervalMs;
    const timer = setInterval(async () => {
      if (!this.running || this.paused) return;
      try {
        const detail = await this.bb.getTask(taskId);
        const a2a = detail.a2aState;
        if (!a2a) return;

        if (a2a.status === 'assigned') {
          clearInterval(timer);
          this.watchTimers.delete(taskId);
          this.emit({ type: 'task_assigned', taskId });
          await this.executeTask(taskId, a2a);
        }
      } catch {
        // Retry next tick
      }
    }, ms);
    this.watchTimers.set(taskId, timer);
  }

  // ── Task execution ──────────────────────────────────────────────────────

  private async executeTask(taskId: string, a2a: A2ATaskState): Promise<void> {
    const exec = this.executions.get(taskId);
    if (!exec) return;

    try {
      exec.status = 'assigned';

      // Accept task — get the ECIES-wrapped AES key
      const acceptResult = await this.bb.acceptTask(taskId);
      exec.task = acceptResult.task;
      this.emit({ type: 'task_accepted', taskId });

      // Get full task detail for the storage root hash
      const detail = await this.bb.getTask(taskId);
      const taskHash = detail.taskHash;

      // Decrypt the wrapped key with the worker's private key
      let instructions = '';
      if (acceptResult.wrappedKey && taskHash) {
        const wrappedBytes = this.decodeWrappedKey(acceptResult.wrappedKey);
        const aesKey = await eciesDecrypt(wrappedBytes, this.wallet!.privateKey);

        // Download ciphertext from storage via REST API
        const storageResult = await this.bb.downloadBlob(taskHash);
        const ciphertext = this.hexToBytes(storageResult.data);

        // AES decrypt to get plaintext instructions
        const plaintext = await aesDecrypt(ciphertext, aesKey);
        instructions = new TextDecoder().decode(plaintext);
      }

      exec.status = 'working';
      this.emit({ type: 'task_working', taskId });

      // Call the user-provided execution handler with decrypted instructions
      const result = await this.config.executeTask({
        taskId,
        task: acceptResult.task,
        instructions,
      });

      exec.status = 'submitted';
      this.emit({ type: 'task_executed', taskId });

      // Submit result
      const submitResult = await this.bb.submitResult(taskId, result);

      exec.status = 'completed';
      this.emit({ type: 'task_submitted', taskId, result: submitResult });
    } catch (err) {
      exec.status = 'failed';
      exec.error = String(err);
      this.emit({ type: 'task_failed', taskId, error: String(err) });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private decodeWrappedKey(wrappedKey: Record<string, string>): Uint8Array {
    // Backend returns wrapped key as hex or base64 in a record
    const hex = Object.values(wrappedKey)[0];
    if (!hex) throw new Error('Empty wrapped key');
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  private hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
}

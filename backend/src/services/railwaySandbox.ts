import { Sandbox } from 'railway';
import { config } from '../config.js';

// ── Railway Sandbox Service ──────────────────────────────────────────────
// Wraps the Railway TypeScript SDK to create, execute, and destroy ephemeral
// sandboxes for agent tool execution. Each sandbox is an isolated Linux VM.

export interface SandboxInstance {
  id: string;
  createdAt: number;
  agentId?: string;
  taskId?: string;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface SandboxUsage {
  sandboxId: string;
  agentId?: string;
  taskId?: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  costMicroUnits: number;
}

// Active sandboxes tracked in-memory
const activeSandboxes = new Map<string, SandboxInstance>();

// Usage history for billing
const usageHistory: SandboxUsage[] = [];

// Per-agent accumulated compute costs (taskHash → microUnits) for settlement deduction
const pendingCosts = new Map<string, number>();

function isEnabled(): boolean {
  return !!config.railwayApiToken && !!config.railwayEnvironmentId;
}

function activeCount(): number {
  return activeSandboxes.size;
}

function checkConcurrencyLimit(): void {
  if (activeCount() >= config.sandboxMaxConcurrent) {
    throw new Error(
      `Sandbox concurrency limit reached (${config.sandboxMaxConcurrent}). Wait for active sandboxes to finish.`
    );
  }
}

/**
 * Create a new sandbox and run a command in it.
 * Returns the sandbox instance and command output.
 */
export async function createAndRun(opts: {
  command: string;
  setup?: string;
  agentId?: string;
  taskId?: string;
  timeoutSeconds?: number;
}): Promise<{ sandbox: SandboxInstance; result: SandboxExecResult }> {
  if (!isEnabled()) {
    throw new Error('Railway sandboxes not configured — set RAILWAY_API_TOKEN and RAILWAY_ENVIRONMENT_ID');
  }

  checkConcurrencyLimit();

  const startMs = Date.now();
  const timeout = opts.timeoutSeconds ?? 300;

  // Create sandbox
  const sbx = await Sandbox.create();

  const instance: SandboxInstance = {
    id: sbx.id,
    createdAt: startMs,
    agentId: opts.agentId,
    taskId: opts.taskId,
  };
  activeSandboxes.set(sbx.id, instance);

  try {
    // Run setup commands if provided
    if (opts.setup) {
      const setupResult = await sbx.exec(opts.setup, { timeoutSec: timeout });
      if (setupResult.exitCode !== 0) {
        throw new Error(`Setup failed: ${setupResult.stderr}`);
      }
    }

    // Run the main command
    const result = await sbx.exec(opts.command, { timeoutSec: timeout });

    const durationSeconds = Math.ceil((Date.now() - startMs) / 1000);

    // Record usage
    const usage: SandboxUsage = {
      sandboxId: sbx.id,
      agentId: opts.agentId,
      taskId: opts.taskId,
      startedAt: startMs,
      endedAt: Date.now(),
      durationSeconds,
      costMicroUnits: durationSeconds * config.sandboxCostPerSecond,
    };
    usageHistory.push(usage);

    // Accumulate cost for settlement deduction (keyed by taskHash)
    if (opts.taskId) {
      const prev = pendingCosts.get(opts.taskId) ?? 0;
      pendingCosts.set(opts.taskId, prev + usage.costMicroUnits);
    }

    return { sandbox: instance, result };
  } finally {
    // Always destroy sandbox when done
    await destroy(sbx.id);
  }
}

/**
 * Destroy a sandbox and clean up tracking.
 */
export async function destroy(sandboxId: string): Promise<void> {
  const instance = activeSandboxes.get(sandboxId);
  if (!instance) return;

  try {
    const sbx = await Sandbox.connect(sandboxId);
    await sbx.destroy();
  } catch {
    // Sandbox may already be destroyed — ignore
  }

  activeSandboxes.delete(sandboxId);
}

/**
 * List all active sandboxes.
 */
export function listActive(): SandboxInstance[] {
  return Array.from(activeSandboxes.values());
}

/**
 * Get usage history for billing.
 */
export function getUsageHistory(agentId?: string): SandboxUsage[] {
  if (agentId) {
    return usageHistory.filter(u => u.agentId === agentId);
  }
  return [...usageHistory];
}

/**
 * Calculate total cost for an agent.
 */
export function calculateAgentCost(agentId: string): { totalSeconds: number; totalCostMicroUnits: number } {
  const usages = usageHistory.filter(u => u.agentId === agentId);
  return {
    totalSeconds: usages.reduce((sum, u) => sum + u.durationSeconds, 0),
    totalCostMicroUnits: usages.reduce((sum, u) => sum + u.costMicroUnits, 0),
  };
}

/**
 * Get the accumulated sandbox cost for a task (in micro-units).
 * Returns 0 if no sandbox was used for this task.
 */
export function getPendingCost(taskId: string): number {
  return pendingCosts.get(taskId) ?? 0;
}

/**
 * Consume (claim + clear) the pending sandbox cost for a task.
 * Called at settlement time so the cost is deducted from the worker's payout.
 */
export function consumePendingCost(taskId: string): number {
  const cost = pendingCosts.get(taskId) ?? 0;
  if (cost > 0) pendingCosts.delete(taskId);
  return cost;
}

export default {
  isEnabled,
  createAndRun,
  destroy,
  listActive,
  getUsageHistory,
  calculateAgentCost,
  getPendingCost,
  consumePendingCost,
};

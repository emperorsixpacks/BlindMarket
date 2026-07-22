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

function isEnabled(): boolean {
  return !!config.railwayApiToken && !!config.railwayEnvironmentId;
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

export default {
  isEnabled,
  createAndRun,
  destroy,
  listActive,
  getUsageHistory,
  calculateAgentCost,
};

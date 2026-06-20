#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BlindMarket } from '@blindmarket/sdk';
import type { AgentCapability, TaskContext } from '@blindmarket/sdk';
import { loadConfig } from './config.js';
import { registerMarketTools } from './tools.js';
import { registerRuntimeTools } from './runtime.js';

const cfg = loadConfig();

const bb = new BlindMarket({ apiKey: cfg.apiKey, apiBase: cfg.apiBase });

const server = new McpServer({
  name: 'BlindMarket MCP Server',
  version: '0.1.0',
});

// Register all marketplace tools
registerMarketTools(server, bb);

// Register executor runtime tools (reads env config for the runtime)
const runtimeCfg = {
  apiKey: cfg.apiKey,
  apiBase: cfg.apiBase,
  displayName: process.env.BLINDMARKET_EXECUTOR_NAME ?? 'MCP Executor',
  capabilities: parseCapabilities(process.env.BLINDMARKET_EXECUTOR_CAPABILITIES),
  minReward: process.env.BLINDMARKET_EXECUTOR_MIN_REWARD,
  browseIntervalMs: parseInt(process.env.BLINDMARKET_BROWSE_INTERVAL_MS ?? '15000', 10),
  watchIntervalMs: parseInt(process.env.BLINDMARKET_WATCH_INTERVAL_MS ?? '5000', 10),
  maxConcurrentTasks: parseInt(process.env.BLINDMARKET_MAX_CONCURRENT_TASKS ?? '3', 10),
  executeTask: async (ctx: TaskContext) => {
    // Default: echo back the instructions as the result.
    // Override this by providing BLINDMARKET_EXECUTE_SCRIPT env pointing to a
    // script that receives task JSON on stdin and returns result JSON on stdout.
    const script = process.env.BLINDMARKET_EXECUTE_SCRIPT;
    if (script) {
      return runExternalScript(script, ctx);
    }
    return { output: ctx.instructions };
  },
};

const { runtime } = registerRuntimeTools(server, runtimeCfg);

// ── Transport ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Auto-start runtime if configured
  if (process.env.BLINDMARKET_AUTO_START === 'true') {
    try {
      await runtime.start();
      console.error('[blindmarket-mcp] Executor runtime auto-started');
    } catch (err) {
      console.error('[blindmarket-mcp] Auto-start failed:', err);
    }
  }
}

main().catch((err) => {
  console.error('[blindmarket-mcp] Fatal:', err);
  process.exit(1);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseCapabilities(raw?: string): AgentCapability[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()) as AgentCapability[];
}

async function runExternalScript(script: string, ctx: unknown): Promise<Record<string, unknown>> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const proc = spawn(script, [], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, TASK_CONTEXT: JSON.stringify(ctx) },
    });
    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Script exited ${code}`));
      try { resolve(JSON.parse(output)); }
      catch { resolve({ output }); }
    });
    proc.on('error', reject);
  });
}

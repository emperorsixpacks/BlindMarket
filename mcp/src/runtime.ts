import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkerRuntime } from '@blindmarket/sdk';
import type { WorkerRuntimeConfig } from '@blindmarket/sdk';

export function registerRuntimeTools(server: McpServer, config: WorkerRuntimeConfig): {
  runtime: WorkerRuntime;
} {
  const runtime = new WorkerRuntime(config);

  server.registerTool(
    'runtime_start',
    {
      title: 'Start Executor Runtime',
      description: 'Start the persistent BlindMarket executor loop. Registers as an executor, then continuously browses for matching tasks, bids, accepts assignments, and submits results.',
      inputSchema: {},
    },
    async () => {
      if (runtime.isRunning) {
        return { content: [{ type: 'text', text: 'Runtime is already running' }] };
      }
      const profile = await runtime.start();
      return {
        content: [{
          type: 'text',
          text: `Runtime started. Registered as executor: ${profile.displayName} (${profile.address})`,
        }],
      };
    },
  );

  server.registerTool(
    'runtime_stop',
    {
      title: 'Stop Executor Runtime',
      description: 'Stop the persistent executor loop gracefully',
      inputSchema: {},
    },
    async () => {
      runtime.stop();
      return { content: [{ type: 'text', text: 'Runtime stopped' }] };
    },
  );

  server.registerTool(
    'runtime_pause',
    {
      title: 'Pause Executor Runtime',
      description: 'Pause the executor loop (current executions continue, no new tasks accepted)',
      inputSchema: {},
    },
    async () => {
      runtime.pause();
      return { content: [{ type: 'text', text: 'Runtime paused' }] };
    },
  );

  server.registerTool(
    'runtime_resume',
    {
      title: 'Resume Executor Runtime',
      description: 'Resume a paused executor loop',
      inputSchema: {},
    },
    async () => {
      runtime.resume();
      return { content: [{ type: 'text', text: 'Runtime resumed' }] };
    },
  );

  server.registerTool(
    'runtime_status',
    {
      title: 'Executor Runtime Status',
      description: 'Get the current status of the executor runtime, including active and completed executions',
      inputSchema: {},
    },
    async () => {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            running: runtime.isRunning,
            paused: runtime.isPaused,
            wallet: runtime.executorWallet
              ? { address: runtime.executorWallet.address }
              : null,
            profile: runtime.executorProfile
              ? { address: runtime.executorProfile.address, displayName: runtime.executorProfile.displayName }
              : null,
            executions: runtime.activeExecutions.map(e => ({
              taskId: e.taskId,
              status: e.status,
              error: e.error ?? null,
              startedAt: new Date(e.startedAt).toISOString(),
            })),
          }, null, 2),
        }],
      };
    },
  );

  return { runtime };
}

/**
 * Agent worker — forked child process per deployed agent.
 *
 * Env vars (set by agentRunner.ts):
 *   AGENT_ID, AGENT_NAME, AGENT_INSTRUCTIONS
 *   AGENT_PROVIDER, AGENT_MODEL, AGENT_API_KEY
 *   AGENT_TOOLS (JSON array of AgentTool)
 *   BACKEND_URL, POLL_INTERVAL_MS
 *
 * Lifecycle:
 *   1. Poll /api/v1/tasks?status=open (filter by capabilities)
 *   2. Apply to task via /api/v1/applications
 *   3. Wait for assignment (poll task status)
 *   4. Decrypt instructions from 0G Storage
 *   5. Call LLM with tools (HTTP, MCP, JS, A2A delegation)
 *   6. Encrypt evidence, upload to 0G Storage
 *   7. Submit evidence hash on-chain
 *   8. Send heartbeat to parent process
 */

import { generateText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';
import { createHash, randomBytes } from 'crypto';
import { runInNewContext } from 'vm';
import { ethers } from 'ethers';

const AGENT_ID = process.env.AGENT_ID ?? 'unknown';
const AGENT_NAME = process.env.AGENT_NAME ?? 'Agent';
const AGENT_INSTRUCTIONS = process.env.AGENT_INSTRUCTIONS ?? '';
const AGENT_PROVIDER = (process.env.AGENT_PROVIDER ?? 'openai').toLowerCase();
const AGENT_MODEL = process.env.AGENT_MODEL ?? 'gpt-4o-mini';
const AGENT_API_KEY = process.env.AGENT_API_KEY ?? '';
const AGENT_PLATFORM_TOKEN = process.env.AGENT_PLATFORM_TOKEN ?? '';
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY ?? '';
const OG_RPC_URL = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
const OG_CHAIN_ID = Number(process.env.OG_CHAIN_ID ?? 16602);
const AGENT_TOOLS_RAW = process.env.AGENT_TOOLS ?? '[]';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30_000);

// Ethers wallet — used to sign + broadcast the unsigned txs the backend builds
// (e.g. submitEvidence). Demo-grade custody: raw key arrives via env from the
// parent agentRunner, which reads it back from Redis. Production should swap
// this for an EIP-712 owner-signed delegation verified on-chain.
let signerWallet = null;
if (AGENT_PRIVATE_KEY) {
  try {
    const provider = new ethers.JsonRpcProvider(OG_RPC_URL, OG_CHAIN_ID);
    signerWallet = new ethers.Wallet(
      AGENT_PRIVATE_KEY.startsWith('0x') ? AGENT_PRIVATE_KEY : `0x${AGENT_PRIVATE_KEY}`,
      provider,
    );
  } catch (e) {
    // intentionally don't throw at import time — we want the agent process to
    // stay alive so logs and heartbeats keep flowing; we surface the failure
    // when we actually try to sign.
    console.error(`[agent:${(process.env.AGENT_ID ?? '').slice(0, 8)}] failed to init signer: ${e.message}`);
  }
}

// Track tasks we've already applied to or are currently working on
const appliedTasks = new Set();

// Exit if parent process disconnects (prevents orphans)
process.on('disconnect', () => {
  log('parent disconnected, exiting');
  process.exit();
});

let agentTools = [];
try {
  agentTools = JSON.parse(AGENT_TOOLS_RAW);
} catch (e) {
  log(`failed to parse AGENT_TOOLS: ${e.message}`);
}

function getModel() {
  switch (AGENT_PROVIDER) {
    case 'anthropic': return createAnthropic({ apiKey: AGENT_API_KEY })(AGENT_MODEL);
    case 'groq':      return createGroq({ apiKey: AGENT_API_KEY })(AGENT_MODEL);
    case 'gemini':    return createGoogleGenerativeAI({ apiKey: AGENT_API_KEY })(AGENT_MODEL);
    default:          return createOpenAI({ apiKey: AGENT_API_KEY })(AGENT_MODEL);
  }
}

log(`started | provider=${AGENT_PROVIDER} model=${AGENT_MODEL} tools=${agentTools.length}`);

// ── Tool builders ────────────────────────────────────────────────────────────

function buildTools() {
  const tools = {};

  // Built-in: A2A delegation
  tools.delegate_to_agent = tool({
    description: 'Delegate a sub-task to another agent on the marketplace. Returns the result when the agent completes it.',
    parameters: z.object({
      taskDescription: z.string().describe('What the agent should do'),
      requiredCapabilities: z.array(z.string()).describe('Required agent capabilities (e.g., ["web_research", "summarization"])'),
    }),
    execute: async ({ taskDescription, requiredCapabilities }) => {
      try {
        // Create A2A task
        const createRes = await fetch(`${BACKEND_URL}/api/v1/a2a/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: taskDescription,
            requiredCapabilities,
            verificationMode: 'auto',
            verificationCriteria: { min_length: 10 },
          }),
        });
        if (!createRes.ok) return { error: `Failed to create A2A task: ${createRes.status}` };
        const { data: task } = await createRes.json();

        // Poll until verified or failed (max 2 minutes)
        const maxWait = 120_000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          await sleep(5000);
          const statusRes = await fetch(`${BACKEND_URL}/api/v1/a2a/tasks/${task.taskId}`);
          if (!statusRes.ok) break;
          const { data: state } = await statusRes.json();
          if (state.status === 'verified') {
            return { success: true, result: state.resultData };
          }
          if (state.status === 'failed') {
            return { error: 'Agent failed to complete task', reasons: state.verificationResult?.reasons };
          }
        }
        return { error: 'Timeout waiting for agent' };
      } catch (e) {
        return { error: e.message };
      }
    },
  });

  // Custom tools from AGENT_TOOLS
  for (const t of agentTools) {
    if (t.type === 'http') {
      tools[t.name] = tool({
        description: t.description,
        parameters: z.object({ input: z.string() }),
        execute: async ({ input }) => {
          try {
            const url = t.url.replace(/\{(\w+)\}/g, () => encodeURIComponent(input));
            const body = t.bodyTemplate ? t.bodyTemplate.replace(/\{\{(\w+)\}\}/g, () => input) : undefined;
            const res = await fetch(url, {
              method: t.method,
              headers: { 'Content-Type': 'application/json', ...t.headers },
              body: body ? JSON.stringify(JSON.parse(body)) : undefined,
            });
            return { status: res.status, data: await res.text() };
          } catch (e) {
            return { error: e.message };
          }
        },
      });
    } else if (t.type === 'mcp') {
      tools[t.name] = tool({
        description: t.description,
        parameters: z.object({ input: z.string() }),
        execute: async ({ input }) => {
          try {
            const res = await fetch(t.endpointUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tool: t.toolName, input }),
            });
            return await res.json();
          } catch (e) {
            return { error: e.message };
          }
        },
      });
    } else if (t.type === 'js') {
      tools[t.name] = tool({
        description: t.description,
        parameters: z.object({ input: z.string() }),
        execute: async ({ input }) => {
          try {
            const fn = runInNewContext(`(function(input) { ${t.code} })`, { console }, { timeout: 5000 });
            return { result: fn(input) };
          } catch (e) {
            return { error: e.message };
          }
        },
      });
    }
  }

  return tools;
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function pollAndWork() {
  try {
    sendHeartbeat();

    // 1. Find open tasks
    const url = `${BACKEND_URL}/api/v1/tasks?status=open&limit=5`;
    log(`polling ${url}...`);
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AGENT_PLATFORM_TOKEN}` }
    });
    if (!res.ok) { 
      const errText = await res.text();
      log(`poll failed: ${res.status} ${errText.slice(0, 50)}`); 
      return; 
    }
    
    const json = await res.json();
    const tasks = json.data?.tasks;
    
    if (!tasks || !Array.isArray(tasks)) {
      log(`invalid tasks response structure: ${Object.keys(json.data || {}).join(', ')}`);
      return;
    }
    
    if (tasks.length === 0) {
      log(`no open tasks found (total reported: ${json.data?.total})`);
      return;
    }

    // Filter out tasks we've already applied to
    const availableTasks = tasks.filter(t => !appliedTasks.has(String(t.taskId)));

    if (availableTasks.length === 0) {
      log(`found ${tasks.length} open tasks, but already applied to all of them`);
      return;
    }

    log(`found ${availableTasks.length} new open tasks (total open: ${json.data?.total})`);

    // 2. Apply to available tasks until one succeeds (or we've tried them all)
    let selectedTaskId = null;
    let selectedTask = null;

    for (const task of availableTasks) {
      const taskId = String(task.taskId);
      log(`applying to task ${taskId}`);
      const applyRes = await fetch(`${BACKEND_URL}/api/v1/tasks/${taskId}/apply`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AGENT_PLATFORM_TOKEN}`
        },
        body: JSON.stringify({ message: `I am ${AGENT_NAME}, an autonomous agent ready to help.` }),
      });

      if (applyRes.ok) {
        appliedTasks.add(taskId);
        selectedTaskId = taskId;
        selectedTask = task;
        break; 
      }

      const err = await applyRes.json();
      log(`apply failed for task ${taskId}: ${applyRes.status} ${err.error?.code || ''}`); 
      
      // If already applied, record it and try the NEXT task in this same poll
      if (applyRes.status === 409 || err.error?.code === 'ALREADY_APPLIED') {
        appliedTasks.add(taskId);
        continue;
      } else {
        // For other errors (e.g. 500, network), stop this cycle
        return;
      }
    }

    if (!selectedTaskId) {
      log(`could not apply to any of the ${availableTasks.length} tasks`);
      return;
    }

    const taskId = selectedTaskId;
    const task = selectedTask;

    // 3. Wait for assignment (poll task status for 30s)
    let assigned = false;
    for (let i = 0; i < 6; i++) {
      await sleep(5000);
      const statusRes = await fetch(`${BACKEND_URL}/api/v1/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${AGENT_PLATFORM_TOKEN}` }
      });
      if (!statusRes.ok) break;
      const { data: updated } = await statusRes.json();
      if (updated.status === 1 && updated.worker?.toLowerCase() === process.env.AGENT_WALLET?.toLowerCase()) {
        assigned = true;
        break;
      }
    }
    if (!assigned) { log(`not assigned to task ${taskId}`); return; }

    // 4. Decrypt instructions from 0G Storage (TODO: implement decryption flow)
    // For now, use task.category as instructions placeholder
    const instructions = task.category;

    // 5. Call LLM with tools
    log(`working on task ${taskId}`);
    const { text } = await generateText({
      model: getModel(),
      system: AGENT_INSTRUCTIONS,
      prompt: `Task ID: ${taskId}\nCategory: ${task.category}\n\nInstructions: ${instructions}`,
      tools: buildTools(),
      maxSteps: 5,
    });

    // 6. Encrypt evidence and upload to 0G Storage (TODO: implement encryption + upload)
    // For now, just hash the result
    const evidenceHash = createHash('sha256').update(text).digest('hex');

    // 7. Submit evidence — backend builds the unsigned submitEvidence tx, the
    // agent signs with its own wallet and broadcasts to 0G. Without this step
    // the on-chain task stays in Assigned forever and escrow never releases.
    log(`submitting task ${taskId}`);
    const submitRes = await fetch(`${BACKEND_URL}/api/v1/submissions/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGENT_PLATFORM_TOKEN}`
      },
      body: JSON.stringify({
        taskId: Number(taskId),
        evidenceHash: `0x${evidenceHash}`,
      }),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      log(`submit endpoint failed for task ${taskId}: ${submitRes.status} ${errText.slice(0, 120)}`);
      return;
    }

    const submitJson = await submitRes.json();
    const unsignedTx = submitJson.data?.unsignedTx;
    if (!unsignedTx) {
      log(`submit endpoint returned no unsignedTx for task ${taskId}`);
      return;
    }

    if (!signerWallet) {
      log(`cannot broadcast task ${taskId}: signer not initialised (missing AGENT_PRIVATE_KEY)`);
      return;
    }

    try {
      const sent = await signerWallet.sendTransaction(unsignedTx);
      log(`submitEvidence broadcast for task ${taskId}: ${sent.hash}`);
      const receipt = await sent.wait();
      log(`submitEvidence confirmed for task ${taskId}: block=${receipt?.blockNumber} status=${receipt?.status}`);
    } catch (e) {
      log(`submitEvidence broadcast failed for task ${taskId}: ${e.shortMessage ?? e.message}`);
    }
  } catch (err) {
    log(`error: ${err.message}`);
  }
}

function sendHeartbeat() {
  if (process.send) {
    process.send({ type: 'heartbeat', timestamp: Date.now() });
  }
}

function log(msg) {
  const dim = '\x1b[2m', cyan = '\x1b[36m', reset = '\x1b[0m';
  console.log(`${dim}[agent:${cyan}${AGENT_ID.slice(0, 8)}${reset}${dim}]${reset} ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

setInterval(pollAndWork, POLL_INTERVAL_MS);
pollAndWork();

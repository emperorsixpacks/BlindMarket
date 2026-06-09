import { fork, type ChildProcess } from 'child_process';
import { randomUUID, createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { Wallet } from 'ethers';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { eciesEncrypt, generateKeyPair } from './crypto.js';
import { inft } from './chain.js';
import {
  appendLog, getLogs, subscribeAgentLogs as redisSubscribe,
  touchHeartbeat,
} from './redis.js';
import { saveAgent, loadAgent, loadAllAgents } from './deployedAgentStore.js';
import type { DeployedAgent, AgentCapability, AgentStatus, LLMProvider, AgentTool } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, '../../agents/worker.js');

// Running child processes (in-memory only — processes don't survive restarts)
const processes = new Map<string, ChildProcess>();

// ── Crash auto-restart ────────────────────────────────────────────────────────
// When a worker crashes (non-zero exit / kill signal we didn't send), re-fork it
// — but rate-limited so a worker that crash-loops can't spin forever or hammer
// the LLM/chain. Cap: MAX_RESTARTS_IN_WINDOW within RESTART_WINDOW_MS, then alert
// and leave it stopped for manual recovery.
const RESTART_WINDOW_MS = 10 * 60_000;
const MAX_RESTARTS_IN_WINDOW = 5;
const RESTART_DELAY_MS = 3_000;
// id → timestamps of recent auto-restarts (pruned to the rolling window).
const restartTimes = new Map<string, number[]>();
// Children the operator deliberately stopped (SIGTERM via stopAgent). Their exit
// must NOT be treated as a crash. Marked per-CHILD (not per-id): during a
// stop→restart overlap the old SIGTERM'd child and its replacement transiently
// coexist, and a per-id marker could be consumed by the wrong one. Keyed on the
// ChildProcess so it can never be misattributed; a WeakSet drops the entry when
// the child is GC'd after exit.
const intentionalStops = new WeakSet<ChildProcess>();

// Record an auto-restart attempt and report whether it's within the rolling cap.
// Returns false (and does NOT record) once the agent has crash-looped past the cap.
function canAutoRestart(id: string): boolean {
  const now = Date.now();
  const recent = (restartTimes.get(id) ?? []).filter((t) => now - t < RESTART_WINDOW_MS);
  if (recent.length >= MAX_RESTARTS_IN_WINDOW) {
    restartTimes.set(id, recent);
    return false;
  }
  recent.push(now);
  restartTimes.set(id, recent);
  return true;
}

// Re-fork a crashed worker after the restart delay, with skipResume=true so a
// poison brief can't immediately re-crash the restart. Re-checks state first:
// the operator may have stopped it during the delay, or it may already be back.
async function autoRestart(id: string): Promise<void> {
  const a = await loadAgent(id);
  // Bail if the operator stopped it during the delay (status flipped to
  // 'stopped') or it's already been re-forked. The status check is the
  // authoritative "operator stopped" signal here — there's no child to test.
  if (!a || a.status !== 'running' || processes.has(id)) return;
  try {
    await startAgent(id, { skipResume: true });
  } catch (e) {
    appendLog(id, `[agentRunner] auto-restart failed: ${(e as Error).message}`);
    const a2 = await loadAgent(id);
    if (a2 && a2.status === 'running') { a2.status = 'stopped'; await saveAgent(a2); }
  }
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export async function getAgentLogs(id: string): Promise<string[]> {
  return getLogs(id);
}

export async function subscribeAgentLogs(
  id: string,
  cb: (line: string) => void,
): Promise<() => void> {
  return redisSubscribe(id, cb);
}

// ── Deploy ────────────────────────────────────────────────────────────────────

export async function deployAgent(params: {
  ownerAddress: string;
  ownerPublicKey: string;
  name: string;
  instructions: string;
  provider: LLMProvider;
  model: string;
  apiKey: string;
  capabilities: AgentCapability[];
  tools?: AgentTool[];
  storageRef?: string;
}): Promise<DeployedAgent> {
  const { privateKey, publicKey } = generateKeyPair();
  const walletAddress = new Wallet(`0x${privateKey}`).address;

  const encryptedPrivateKey = eciesEncrypt(
    Buffer.from(privateKey, 'hex'),
    params.ownerPublicKey,
  ).toString('hex');

  const encryptedApiKey = eciesEncrypt(
    Buffer.from(params.apiKey, 'utf8'),
    params.ownerPublicKey,
  ).toString('hex');

  let inftTokenId: number | undefined;
  if (inft) {
    try {
      const metadataHash = `0x${createHash('sha256').update(walletAddress + publicKey).digest('hex')}` as `0x${string}`;
      const tx = await (inft as any).mint(params.ownerAddress, '', metadataHash);
      const receipt = await tx.wait();
      const event = receipt?.logs?.find((l: any) => {
        try { return (inft as any).interface.parseLog(l)?.name === 'INFTMinted'; } catch { return false; }
      });
      if (event) {
        inftTokenId = Number((inft as any).interface.parseLog(event)?.args?.tokenId);
      }
    } catch (e) {
      console.warn('INFT mint failed (non-fatal):', (e as Error).message);
    }
  }

  const platformToken = jwt.sign(
    { address: walletAddress, ownerAddress: params.ownerAddress.toLowerCase(), agentName: params.name },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: '365d' } as jwt.SignOptions,
  );

  const agent: DeployedAgent = {
    id: randomUUID(),
    ownerAddress: params.ownerAddress,
    name: params.name,
    instructions: params.instructions,
    provider: params.provider,
    model: params.model,
    apiKey: params.apiKey,       // kept in memory for worker env; not persisted to Redis
    encryptedApiKey,
    capabilities: params.capabilities,
    tools: params.tools ?? [],
    status: 'stopped',
    deployedAt: new Date().toISOString(),
    walletAddress,
    publicKey,
    encryptedPrivateKey,
    rawPrivateKey: privateKey,
    inftTokenId,
    storageRef: params.storageRef,
    platformToken,
  };

  await saveAgent(agent);
  return agent;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export async function startAgent(id: string, opts?: { skipResume?: boolean }): Promise<void> {
  const agent = await loadAgent(id);
  if (!agent) throw new Error(`Agent ${id} not found`);
  if (processes.has(id)) return;

  // Migration: Generate platform token if missing
  if (!agent.platformToken) {
    if (!config.jwtSecret) {
      console.error('[agentRunner] Cannot start agent: JWT_SECRET not configured');
      throw new Error('Server configuration error: JWT_SECRET missing');
    }
    agent.platformToken = jwt.sign(
      { address: agent.walletAddress, ownerAddress: agent.ownerAddress.toLowerCase(), agentName: agent.name },
      config.jwtSecret,
      { algorithm: 'HS256', expiresIn: '365d' } as jwt.SignOptions,
    );
    await saveAgent(agent);
    console.log(`[agentRunner] Generated missing platform token for agent ${id}`);
  }

  const child = fork(WORKER_PATH, [], {
    env: {
      ...process.env,
      AGENT_ID: agent.id,
      AGENT_NAME: agent.name,
      AGENT_INSTRUCTIONS: agent.instructions,
      AGENT_PROVIDER: agent.provider,
      AGENT_MODEL: agent.model,
      AGENT_API_KEY: agent.apiKey,
      AGENT_PLATFORM_TOKEN: agent.platformToken,
      AGENT_WALLET: agent.walletAddress,
      AGENT_PRIVATE_KEY: agent.rawPrivateKey ?? '',
      // Worker passes this to /a2a/register so posters can ECIES-wrap the AES
      // key to it at task-creation time. Same format the backend ECIES expects:
      // uncompressed secp256k1 hex, no 0x prefix.
      AGENT_PUBLIC_KEY: agent.publicKey ?? '',
      OG_RPC_URL: config.ogRpcUrl,
      OG_CHAIN_ID: String(config.ogChainId),
      // Escrow proxy address — the verifier role (verificationMode='agent')
      // signs completeVerification directly against this contract.
      AGENT_ESCROW_ADDRESS: config.blindEscrowAddress,
      BACKEND_URL: `http://localhost:${config.port}`,
      AGENT_TOOLS: JSON.stringify(agent.tools ?? []),
      AGENT_CAPABILITIES: JSON.stringify(agent.capabilities ?? []),
      AGENT_MIN_REWARD: agent.minReward ?? '',
      // Set only on a post-crash auto-restart: the worker skips re-driving its
      // in-flight (accepted-but-unsubmitted) task so a poison brief can't loop
      // the crash. Empty on fresh starts and graceful boot-reconciles.
      AGENT_SKIP_RESUME: opts?.skipResume ? '1' : '',
    },
    silent: true,
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach(line => appendLog(id, line));
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach(line => appendLog(id, `[err] ${line}`));
  });

  child.on('message', async (msg: unknown) => {
    if (typeof msg === 'object' && msg !== null && (msg as any).type === 'heartbeat') {
      await touchHeartbeat(id);
      const a = await loadAgent(id);
      if (a) {
        a.lastActiveAt = new Date().toISOString();
        await saveAgent(a);
      }
    }
  });

  // A fork that fails to SPAWN (worker.js missing, EACCES, OOM at spawn time)
  // emits 'error', NOT 'exit'. With no listener Node re-throws it in THIS
  // (backend) process — which would take down the API and every other running
  // agent. Catch it, surface it on the agent's log stream, and treat it as a
  // stop so one bad fork can never cascade into a full backend outage.
  child.on('error', async (err) => {
    // Ignore a stale event from a child that's already been replaced in the map.
    if (processes.get(id) !== child) return;
    appendLog(id, `[agentRunner] worker failed to start: ${err.message}`);
    processes.delete(id);
    const a = await loadAgent(id);
    if (a && a.status === 'running') { a.status = 'stopped'; await saveAgent(a); }
  });

  child.on('exit', async (code, signal) => {
    // Ignore a STALE exit. If a newer child has already replaced us in the map
    // (e.g. /restart forked a replacement before our SIGTERM exit landed, or an
    // auto-restart re-forked), this event is from the OLD process — running
    // processes.delete / the status flip here would evict the live child and
    // wrongly mark a working agent 'stopped'. Identity-scope every mutation.
    if (processes.get(id) !== child) return;
    processes.delete(id);
    // Did the operator stop THIS child (SIGTERM via stopAgent)? Per-child marker,
    // so a concurrent restart can't misattribute an operator stop to a crash.
    const wasIntentional = intentionalStops.has(child);
    const a = await loadAgent(id);

    // A crash = an exit we didn't ask for: a non-zero code (the worker's own
    // unhandledRejection/uncaughtException handlers exit(1)) or a signal we
    // didn't send (SIGKILL from the OOM killer, SIGSEGV). A clean code-0 exit
    // (e.g. parent-disconnect during backend shutdown) and operator SIGTERM are
    // NOT crashes and never auto-restart.
    const crashed =
      !wasIntentional &&
      ((code != null && code !== 0) || (signal != null && signal !== 'SIGTERM'));

    if (crashed && a && a.status === 'running') {
      if (canAutoRestart(id)) {
        appendLog(id, `[agentRunner] worker crashed (${code != null ? `exit code=${code}` : `signal=${signal}`}) — auto-restarting in ${RESTART_DELAY_MS / 1000}s (skipping in-flight task resume)`);
        setTimeout(() => { void autoRestart(id); }, RESTART_DELAY_MS);
        return; // keep status 'running' across the restart
      }
      appendLog(id, `[agentRunner] ALERT: worker crash-looped (≥${MAX_RESTARTS_IN_WINDOW} restarts within ${RESTART_WINDOW_MS / 60000}min) — auto-restart disabled. Fix the cause, then click Start to relaunch.`);
      restartTimes.delete(id);
      a.status = 'stopped';
      await saveAgent(a);
      return;
    }

    // Non-crash exit: surface a crash-vs-stop line (best-effort; a true crash
    // only reaches here once auto-restart is exhausted) and flip running→stopped.
    if (code && code !== 0) {
      appendLog(id, `[agentRunner] worker exited (code=${code}${signal ? ` signal=${signal}` : ''}) — agent stopped; click Start to relaunch`);
    } else if (signal && signal !== 'SIGTERM') {
      appendLog(id, `[agentRunner] worker terminated by signal ${signal} — agent stopped`);
    }
    if (a && a.status === 'running') {
      a.status = 'stopped';
      await saveAgent(a);
    }
  });

  processes.set(id, child);
  agent.status = 'running';
  await saveAgent(agent);
}

export async function pauseAgent(id: string): Promise<void> {
  const child = processes.get(id);
  if (!child) throw new Error(`Agent ${id} is not running`);
  child.kill('SIGSTOP');
  const agent = await loadAgent(id);
  if (agent) { agent.status = 'paused'; await saveAgent(agent); }
}

export async function stopAgent(id: string): Promise<void> {
  // Clear any crash-restart history; an explicit stop is a clean slate.
  restartTimes.delete(id);
  const child = processes.get(id);
  if (child) {
    // Mark THIS child's impending SIGTERM exit as operator-initiated so the exit
    // handler doesn't mistake it for a crash and auto-restart it. Keyed on the
    // child object (not the id) so a concurrent restart can't misattribute it.
    intentionalStops.add(child);
    child.kill('SIGTERM');
    processes.delete(id);
  }
  const agent = await loadAgent(id);
  if (agent) { agent.status = 'stopped'; await saveAgent(agent); }
}

/**
 * Re-fork agents that were 'running' when the backend last stopped. The
 * `processes` map lives only in this process's memory, so a backend restart
 * (deploy, crash, OOM) silently leaves every persisted-'running' agent with no
 * worker — it still shows 'running' in the UI but does no work and stops
 * emitting heartbeats. Call this once at boot to reconcile persisted state with
 * reality.
 *
 * Graceful path: this does NOT pass skipResume, so workers re-drive their
 * in-flight accepted tasks (a clean restart should recover owed work) — only the
 * crash auto-restart skips resume. Each start is isolated so one bad agent can't
 * abort boot. Assumes a single agent-hosting backend instance (the `processes`
 * map is per-process); honored by an env flag in index.ts for unusual topologies.
 */
export async function reconcileAgents(): Promise<void> {
  let agents: DeployedAgent[];
  try {
    agents = await loadAllAgents();
  } catch (e) {
    console.error(`[agentRunner] reconcile: failed to load agents`, e);
    return;
  }
  const running = agents.filter((a) => a.status === 'running' && !processes.has(a.id));
  if (running.length === 0) return;
  console.log(`[agentRunner] reconcile: re-forking ${running.length} agent(s) that were running before the last restart`);
  for (const a of running) {
    try {
      await startAgent(a.id);
      console.log(`[agentRunner] reconcile: restarted agent ${a.id} (${a.name})`);
    } catch (e) {
      console.error(`[agentRunner] reconcile: failed to restart agent ${a.id} (${a.name}): ${(e as Error).message}`);
    }
  }
}

export async function getAgent(id: string): Promise<DeployedAgent | undefined> {
  return (await loadAgent(id)) ?? undefined;
}

export async function listAgents(ownerAddress?: string): Promise<DeployedAgent[]> {
  const all = await loadAllAgents();
  return ownerAddress ? all.filter(a => a.ownerAddress === ownerAddress) : all;
}

export async function updateAgent(id: string, patch: Partial<Pick<DeployedAgent, 'instructions' | 'model' | 'tools' | 'capabilities' | 'minReward'>>): Promise<DeployedAgent | undefined> {
  const agent = await loadAgent(id);
  if (!agent) return undefined;
  // Strip undefined values before merging. Callers can send a subset of the
  // patch keys (e.g. the EDIT tab on AgentDetail only sends instructions +
  // model), and {...agent, ...patch} with `patch.capabilities === undefined`
  // would overwrite the existing array with undefined → JSON.stringify drops
  // the field → next worker spawn reads `agent.capabilities ?? []` as [] →
  // worker defaults to ['data_processing']. Same hazard for tools. Surfaced
  // as "agent registered with caps=data_processing even though I picked
  // code_review" after the user edited the prompt on a deployed agent.
  const cleanPatch: typeof patch = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (cleanPatch as Record<string, unknown>)[k] = v;
  }
  const updated = { ...agent, ...cleanPatch };
  await saveAgent(updated);
  return updated;
}

/**
 * Append a wallet to an agent's authorizedOwners allowlist (lowercased,
 * deduped). Drives the signature-gated owner-link flow so a Privy identity
 * that differs from the original wagmi deploy wallet can manage the agent once
 * it has proven control of the owner wallet. No-op (returns the unchanged
 * record) if the address is already the ownerAddress or already authorized.
 */
export async function addAuthorizedOwner(id: string, address: string): Promise<DeployedAgent | undefined> {
  const agent = await loadAgent(id);
  if (!agent) return undefined;
  const lower = address.toLowerCase();
  const already =
    lower === agent.ownerAddress.toLowerCase() ||
    (agent.authorizedOwners ?? []).some((a) => a.toLowerCase() === lower);
  if (!already) {
    agent.authorizedOwners = [...(agent.authorizedOwners ?? []), lower];
    await saveAgent(agent);
  }
  return agent;
}

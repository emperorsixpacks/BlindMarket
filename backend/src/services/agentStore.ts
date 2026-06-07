import { redis } from './redis.js';
import type { AgentExecutor } from '../types.js';

// ── Keys ─────────────────────────────────────────────────────────────────────
//
// Persistence model — mirrors a2aStore's pattern so cold restarts don't wipe
// state. Previously this was an in-memory Map; that meant every backend
// restart wiped all A2A executor registrations, leaving worker.js processes
// silently 403'd by /accept (NOT_REGISTERED) until each one restarted and
// re-registered. With Redis-backed storage, registrations survive bounces.
//
//   agent:executor:<lowercased_addr>  → JSON of AgentExecutor
//   agent:executor:all                → SET of lowercased addresses (size-cap check)
//
// Addresses are always lowercased for keys to defang case mismatches between
// EIP-55 checksummed and lowercased forms.

const KEY = {
  executor: (addr: string) => `agent:executor:${addr.toLowerCase()}`,
  all: 'agent:executor:all',
};

const MAX_AGENTS = 1_000;

export async function registerAgent(agent: AgentExecutor): Promise<void> {
  const addr = agent.address.toLowerCase();
  // Check size cap only for NEW registrations — re-registers (worker.js calls
  // this on every startup) shouldn't be blocked by the cap even at scale.
  const exists = await redis.exists(KEY.executor(addr));
  if (!exists) {
    const total = await redis.scard(KEY.all);
    if (total >= MAX_AGENTS) {
      throw new Error('Agent registry full');
    }
  }
  const pipe = redis.pipeline();
  pipe.set(KEY.executor(addr), JSON.stringify(agent));
  pipe.sadd(KEY.all, addr);
  await pipe.exec();
}

export async function getAgent(address: string): Promise<AgentExecutor | undefined> {
  const raw = await redis.get(KEY.executor(address));
  return raw ? (JSON.parse(raw) as AgentExecutor) : undefined;
}

/**
 * List all registered executors, optionally filtered by capability match.
 *
 * Matches the /accept gate's semantics (superset: the agent's set must include
 * ALL of the required caps). Used by the frontend at task-creation time to
 * discover which pubkeys to ECIES-wrap the AES key to.
 *
 * Returns at most MAX_AGENTS entries; small enough today that we don't
 * paginate. If we ever scale past ~1k registered executors this should move
 * to a Redis SCAN cursor + capability index.
 */
export async function listAgents(requiredCapabilities?: string[]): Promise<AgentExecutor[]> {
  const addrs = await redis.smembers(KEY.all);
  if (addrs.length === 0) return [];

  const pipe = redis.pipeline();
  for (const addr of addrs) pipe.get(KEY.executor(addr));
  const rows = await pipe.exec();
  if (!rows) return [];

  const agents: AgentExecutor[] = [];
  for (const [, raw] of rows) {
    if (typeof raw !== 'string') continue;
    try {
      agents.push(JSON.parse(raw) as AgentExecutor);
    } catch {
      // Skip malformed rows rather than failing the whole listing.
    }
  }

  if (!requiredCapabilities || requiredCapabilities.length === 0) return agents;
  return agents.filter((a) => requiredCapabilities.every((c) => a.capabilities.includes(c as AgentExecutor['capabilities'][number])));
}

import { redis } from './redis.js';
import type { A2ATaskMeta, A2ATaskState, AgentCapability } from '../types.js';

// ── Keys ─────────────────────────────────────────────────────────────────────
//
// Persistence model:
//   a2a:meta:<taskId>      — string (JSON A2ATaskMeta)
//   a2a:state:<taskId>     — string (JSON A2ATaskState)
//   a2a:open               — set of taskIds where targetExecutorType=='agent'
//                            and status=='open'. Used by browseAgentTasks for
//                            O(open) reads instead of O(all-tasks-ever).
//   a2a:executor:<addr>    — set of taskIds the address has accepted. Used by
//                            getExecutorTasks. Address is lowercased.
//
// Invariants maintained by setMeta/updateState:
//   - a2a:open contains a taskId iff (meta.targetExecutorType=='agent' AND
//     state.status=='open'). updateState removes on status transition.
//   - a2a:executor:<addr> contains a taskId iff state.executorAddress==addr.

const KEY = {
  meta: (taskId: string) => `a2a:meta:${taskId.toLowerCase()}`,
  state: (taskId: string) => `a2a:state:${taskId.toLowerCase()}`,
  open: 'a2a:open',
  executor: (addr: string) => `a2a:executor:${addr.toLowerCase()}`,
  // Tasks posted by a given address — populated when meta.posterAddress is set.
  // Used by the manual-verify inbox query.
  poster: (addr: string) => `a2a:poster:${addr.toLowerCase()}`,
};

export async function setMeta(meta: A2ATaskMeta): Promise<void> {
  const taskId = meta.taskId.toLowerCase();
  const pipe = redis.pipeline();
  pipe.set(KEY.meta(taskId), JSON.stringify({ ...meta, taskId }));
  // Initialize state only if not already present — preserves the original
  // in-memory semantic (`if (!taskStates.has(...))`). SETNX is atomic.
  pipe.setnx(
    KEY.state(taskId),
    JSON.stringify({ taskId, status: 'open' } satisfies A2ATaskState),
  );
  if (meta.targetExecutorType === 'agent') {
    pipe.sadd(KEY.open, taskId);
  }
  if (meta.posterAddress) {
    pipe.sadd(KEY.poster(meta.posterAddress), taskId);
  }
  await pipe.exec();
}

export async function getMeta(taskId: string): Promise<A2ATaskMeta | undefined> {
  let raw = await redis.get(KEY.meta(taskId.toLowerCase()));
  if (!raw && taskId.toLowerCase() !== taskId) {
    // Fallback for legacy mixed-case keys
    raw = await redis.get(`a2a:meta:${taskId}`);
  }
  return raw ? (JSON.parse(raw) as A2ATaskMeta) : undefined;
}

/**
 * Merge additional ECIES-wrapped keys into the task's meta. Used by the
 * just-in-time wrap flow: poster's frontend wakes up when a new agent bids,
 * wraps the AES key to that bidder's pubkey, and POSTs the slice here.
 * Existing entries are preserved (so bidders previously wrapped to don't
 * lose their slice). Addresses are lowercased to match accept-time lookup.
 */
export async function mergeWrappedKeys(
  taskId: string,
  additions: Record<string, string>,
): Promise<A2ATaskMeta | undefined> {
  const tid = taskId.toLowerCase();
  let raw = await redis.get(KEY.meta(tid));
  let finalTid = tid;
  if (!raw && tid !== taskId) {
    // Fallback for legacy mixed-case keys
    raw = await redis.get(`a2a:meta:${taskId}`);
    if (raw) finalTid = taskId;
  }
  if (!raw) return undefined;
  const meta = JSON.parse(raw) as A2ATaskMeta;
  const merged = { ...(meta.wrappedKeys ?? {}) };
  for (const [addr, blob] of Object.entries(additions)) {
    merged[addr.toLowerCase()] = blob;
  }
  meta.wrappedKeys = merged;
  await redis.set(`a2a:meta:${finalTid}`, JSON.stringify(meta));
  return meta;
}

/**
 * Batch-check which taskHashes have A2A meta entries. Returns a Set of hashes
 * (lowercased) that ARE indexed. Used by the tasks list to flag stranded tasks
 * — on-chain tasks created before the current A2A code path was wired up have
 * no meta and are therefore invisible to executor agents.
 */
export async function getIndexedHashes(taskHashes: string[]): Promise<Set<string>> {
  if (taskHashes.length === 0) return new Set();
  const pipe = redis.pipeline();
  for (const h of taskHashes) {
    pipe.exists(KEY.meta(h.toLowerCase()));
    if (h.toLowerCase() !== h) pipe.exists(`a2a:meta:${h}`);
  }
  const results = await pipe.exec();
  if (!results) return new Set();
  const indexed = new Set<string>();
  let resultIdx = 0;
  for (let i = 0; i < taskHashes.length; i++) {
    const h = taskHashes[i];
    const existsLower = results[resultIdx++]?.[1] === 1;
    let existsOriginal = false;
    if (h.toLowerCase() !== h) {
      existsOriginal = results[resultIdx++]?.[1] === 1;
    }
    if (existsLower || existsOriginal) indexed.add(h.toLowerCase());
  }
  return indexed;
}

export async function getState(taskId: string): Promise<A2ATaskState | undefined> {
  let raw = await redis.get(KEY.state(taskId.toLowerCase()));
  if (!raw && taskId.toLowerCase() !== taskId) {
    // Fallback for legacy mixed-case keys
    raw = await redis.get(`a2a:state:${taskId}`);
  }
  return raw ? (JSON.parse(raw) as A2ATaskState) : undefined;
}

export async function updateState(
  taskId: string,
  patch: Partial<A2ATaskState>,
): Promise<A2ATaskState> {
  const tid = taskId.toLowerCase();
  let existingRaw = await redis.get(KEY.state(tid));
  let finalTid = tid;
  if (!existingRaw && tid !== taskId) {
    // Fallback for legacy mixed-case keys
    existingRaw = await redis.get(`a2a:state:${taskId}`);
    if (existingRaw) finalTid = taskId;
  }
  if (!existingRaw) throw new Error(`No A2A state for task ${taskId}`);
  const existing = JSON.parse(existingRaw) as A2ATaskState;
  const updated: A2ATaskState = { ...existing, ...patch, taskId: finalTid };

  const pipe = redis.pipeline();
  pipe.set(`a2a:state:${finalTid}`, JSON.stringify(updated));
  // Drop from open index when status leaves 'open'
  if (existing.status === 'open' && updated.status !== 'open') {
    pipe.srem(KEY.open, finalTid);
  }
  // Index by executor when an executorAddress is first set
  if (!existing.executorAddress && updated.executorAddress) {
    pipe.sadd(KEY.executor(updated.executorAddress), finalTid);
  }
  await pipe.exec();
  return updated;
}

/**
 * Atomic open→accepted transition. The plain updateState() pattern is
 * read-then-write with no atomicity, so two concurrent /accept requests can
 * both pass the route's `state.status === 'open'` check and both write
 * `accepted` with different executorAddresses — leaving Redis pointing at one
 * executor while the on-chain assignment (whichever marketplaceAssign tx
 * confirms first) points at the other. Surfaced by the multi-agent flow:
 * the loser then gets a 403 on /submit because Redis says they're not the
 * executor of record.
 *
 * Run the CAS inside a Lua script so the status check + state mutation +
 * index updates all happen atomically on the Redis server. Returns:
 *   - { ok: true,  state }  → transition succeeded, this caller is the executor
 *   - { ok: false, currentStatus } → CAS lost; another caller got there first
 */
export async function tryAccept(
  taskId: string,
  executorAddress: string,
  acceptedAt: string,
): Promise<{ ok: true; state: A2ATaskState } | { ok: false; currentStatus: string }> {
  // Lua: read state, verify status='open', merge patch, write back, update
  // index sets. cjson is bundled with Redis 6+; if a deployment uses an older
  // build the SET fails loudly and we'll surface it at boot.
  const tid = taskId.toLowerCase();
  const lua = `
    local stateKey = KEYS[1]
    local openSetKey = KEYS[2]
    local executorSetKey = KEYS[3]
    local taskId = ARGV[1]
    local executorAddress = ARGV[2]
    local acceptedAt = ARGV[3]

    local raw = redis.call('GET', stateKey)
    if not raw then return {'missing'} end

    local s = cjson.decode(raw)
    if s.status ~= 'open' then return {'lost', s.status} end

    s.status = 'accepted'
    s.executorAddress = executorAddress
    s.acceptedAt = acceptedAt
    redis.call('SET', stateKey, cjson.encode(s))
    redis.call('SREM', openSetKey, taskId)
    redis.call('SADD', executorSetKey, taskId)
    return {'ok', cjson.encode(s)}
  `;

  const result = (await redis.eval(
    lua,
    3,
    KEY.state(tid),
    KEY.open,
    KEY.executor(executorAddress),
    tid,
    executorAddress,
    acceptedAt,
  )) as [string, string?];

  if (result[0] === 'ok') {
    return { ok: true, state: JSON.parse(result[1]!) as A2ATaskState };
  }
  if (result[0] === 'missing') {
    throw new Error(`No A2A state for task ${tid}`);
  }
  return { ok: false, currentStatus: result[1] ?? 'unknown' };
}

/** Browse open agent-targeted tasks, optionally filtered by capabilities. */
export async function browseAgentTasks(
  capabilities?: AgentCapability[],
  // Reserved for future reputation gating; matches old signature so callers
  // (routes/a2a.ts:69) don't have to change. Currently unused — reputation
  // gating happens at /accept time, not at browse.
  _minReputation?: number,
): Promise<Array<{ meta: A2ATaskMeta; state: A2ATaskState }>> {
  const ids = await redis.smembers(KEY.open);
  if (ids.length === 0) return [];

  const pipe = redis.pipeline();
  for (const id of ids) {
    pipe.get(KEY.meta(id));
    pipe.get(KEY.state(id));
  }
  const results = await pipe.exec();
  if (!results) return [];

  const out: Array<{ meta: A2ATaskMeta; state: A2ATaskState }> = [];
  for (let i = 0; i < ids.length; i++) {
    const metaRaw = results[i * 2]?.[1] as string | null | undefined;
    const stateRaw = results[i * 2 + 1]?.[1] as string | null | undefined;
    if (!metaRaw || !stateRaw) continue;

    const meta = JSON.parse(metaRaw) as A2ATaskMeta;
    const state = JSON.parse(stateRaw) as A2ATaskState;

    // Defensive: the open index is supposed to be a strict subset, but verify
    // in case state was rewritten outside of this module.
    if (meta.targetExecutorType !== 'agent') continue;
    if (state.status !== 'open') continue;

    if (capabilities && capabilities.length > 0 && meta.requiredCapabilities.length > 0) {
      const overlap = meta.requiredCapabilities.filter((c) => capabilities.includes(c));
      if (overlap.length === 0) continue;
    }

    out.push({ meta, state });
  }
  return out;
}

/** Get all tasks accepted (currently or historically) by a specific executor. */
export async function getExecutorTasks(
  address: string,
): Promise<Array<{ meta: A2ATaskMeta; state: A2ATaskState }>> {
  return loadTasksByIndex(KEY.executor(address));
}

/** Get all tasks posted by a specific address. Drives the poster's inbox. */
export async function getPosterTasks(
  address: string,
): Promise<Array<{ meta: A2ATaskMeta; state: A2ATaskState }>> {
  return loadTasksByIndex(KEY.poster(address));
}

/** Helper used by getExecutorTasks and getPosterTasks — same shape, different
 *  index. Returns meta+state pairs for every taskId in the named set. */
async function loadTasksByIndex(
  setKey: string,
): Promise<Array<{ meta: A2ATaskMeta; state: A2ATaskState }>> {
  const ids = await redis.smembers(setKey);
  if (ids.length === 0) return [];

  const pipe = redis.pipeline();
  for (const id of ids) {
    pipe.get(KEY.meta(id));
    pipe.get(KEY.state(id));
  }
  const results = await pipe.exec();
  if (!results) return [];

  const out: Array<{ meta: A2ATaskMeta; state: A2ATaskState }> = [];
  for (let i = 0; i < ids.length; i++) {
    const metaRaw = results[i * 2]?.[1] as string | null | undefined;
    const stateRaw = results[i * 2 + 1]?.[1] as string | null | undefined;
    if (!metaRaw || !stateRaw) continue;
    out.push({
      meta: JSON.parse(metaRaw) as A2ATaskMeta,
      state: JSON.parse(stateRaw) as A2ATaskState,
    });
  }
  return out;
}

import { createHash } from 'crypto';
import { getPool } from './neonDb.js';
import { loadAgentByWallet } from './deployedAgentStore.js';
import { embed, toVectorLiteral, embeddingModelId } from './embeddingService.js';
import type { InstalledSkill } from '../types.js';

/**
 * Agent embeddings (semantic matching, Phase 0). Builds a rich per-agent text
 * "doc" and stores its vector on the routing table (agent_executors.embedding).
 *
 * The doc is as rich as available: a deployed agent contributes its
 * instructions + installed-skill descriptions/instructions; an executor-only
 * record contributes its display name + capabilities. Nothing reads these
 * vectors yet (Phase 1 wires retrieval) — this only populates them.
 */

/** Compose the public text to embed for one executor wallet. */
export async function buildAgentDoc(executorAddress: string): Promise<string> {
  const addr = executorAddress.toLowerCase();
  const parts: string[] = [];

  const deployed = await loadAgentByWallet(addr).catch(() => null);
  if (deployed) {
    parts.push(deployed.name);
    if (deployed.instructions) parts.push(deployed.instructions);
    for (const s of (deployed.skills ?? []) as InstalledSkill[]) {
      parts.push(`Skill: ${s.name}. ${s.instructions ?? ''}`);
    }
    if (deployed.capabilities?.length) parts.push(`Capabilities: ${deployed.capabilities.join(', ')}`);
  }

  if (parts.length === 0) {
    // Executor-only fallback: thin doc from the routing record.
    const db = await getPool();
    const { rows } = await db.query<{ display_name: string; capabilities: string[] }>(
      'SELECT display_name, capabilities FROM agent_executors WHERE address = $1',
      [addr],
    );
    if (rows[0]) {
      parts.push(rows[0].display_name || 'Agent');
      if (rows[0].capabilities?.length) parts.push(`Capabilities: ${rows[0].capabilities.join(', ')}`);
    }
  }

  return parts.join('\n\n').trim();
}

/**
 * Recompute and store the embedding for one executor wallet. No-op if the
 * executor row doesn't exist (a deployed agent that never registered/started
 * has nothing to route to yet). Best-effort — callers fire-and-forget; a
 * failure here must never break deploy/register/skill flows.
 */
export async function recomputeForWallet(executorAddress: string): Promise<boolean> {
  const addr = executorAddress.toLowerCase();
  const doc = await buildAgentDoc(addr);
  if (!doc) return false;

  const { vector, model } = await embed(doc);
  const db = await getPool();
  const { rowCount } = await db.query(
    `UPDATE agent_executors
       SET embedding = $2::vector, embedding_model = $3, embedding_updated_at = NOW()
     WHERE address = $1`,
    [addr, toVectorLiteral(vector), model],
  );
  return (rowCount ?? 0) > 0;
}

/** Fire-and-forget wrapper for hot paths (deploy/register/skill change). */
export function recomputeForWalletBestEffort(executorAddress: string): void {
  void recomputeForWallet(executorAddress).catch((err) => {
    console.warn(`[agentEmbedding] recompute failed for ${executorAddress.slice(0, 10)}…:`, (err as Error).message);
  });
}

/**
 * Backfill: embed every registered executor that has no current embedding (or
 * whose model differs from the active one). Idempotent; safe to re-run.
 * Returns counts. Intended to be invoked from a one-off script or an admin
 * route, not on the request path.
 */
export async function backfillAgentEmbeddings(opts: { force?: boolean } = {}): Promise<{ updated: number; skipped: number }> {
  const db = await getPool();
  const model = embeddingModelId();
  const { rows } = await db.query<{ address: string; embedding_model: string | null }>(
    'SELECT address, embedding_model FROM agent_executors',
  );
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!opts.force && r.embedding_model === model) { skipped++; continue; }
    const ok = await recomputeForWallet(r.address).catch(() => false);
    if (ok) updated++; else skipped++;
  }
  return { updated, skipped };
}

/** Stable hash of a doc — lets callers skip re-embedding unchanged text. */
export function docHash(doc: string): string {
  return createHash('sha256').update(doc).digest('hex').slice(0, 16);
}

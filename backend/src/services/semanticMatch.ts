import { getPool } from './neonDb.js';
import { config } from '../config.js';
import { embed, toVectorLiteral, embeddingModelId } from './embeddingService.js';
import { rankAgents } from './agentScorer.js';
import type { A2ATaskMeta, AgentCapability } from '../types.js';

/**
 * Semantic matching (Phase 1: SHADOW mode).
 *
 * Nothing here influences routing yet. For every indexed task that carries
 * routing text we record, side by side, how semantic KNN would have ranked
 * agents vs the live capability-tag ranking — then the accept/settlement
 * paths fill in what actually happened. The tuning loop reads this log and
 * declares "flip-ready" only when semantic reliably beats tags on real
 * outcomes.
 *
 * Privacy: routing text is ONLY ever public material — publicBrief (public
 * tasks), the poster's opt-in routingSummary (private tasks), or the
 * capability tags themselves as a last resort. The sealed brief never gets
 * embedded.
 */

export interface SemanticCandidate {
  address: string;
  displayName: string;
  similarity: number; // 1 - cosine distance ∈ [0..1]-ish (higher = closer)
}

export interface RerankedCandidate extends SemanticCandidate {
  /** Cross-encoder relevance from the reranker; higher = better fit. */
  rerankScore: number;
}

/** The public text a task exposes for matching, best source first. */
export function buildTaskRoutingText(meta: Pick<A2ATaskMeta, 'publicBrief' | 'routingSummary' | 'requiredCapabilities'>): string {
  if (meta.publicBrief?.trim()) return meta.publicBrief.trim();
  if (meta.routingSummary?.trim()) return meta.routingSummary.trim();
  if (meta.requiredCapabilities?.length) return `Task requiring: ${meta.requiredCapabilities.join(', ')}`;
  return '';
}

/** Embed + persist a task's routing text (upsert; model-tagged). */
export async function embedTask(taskHash: string, routingText: string): Promise<number[]> {
  const { vector, model } = await embed(routingText);
  const db = await getPool();
  await db.query(
    `INSERT INTO task_embeddings (task_hash, embedding, model, source_text_hash)
     VALUES ($1, $2::vector, $3, md5($4))
     ON CONFLICT (task_hash) DO UPDATE SET embedding = $2::vector, model = $3, source_text_hash = md5($4)`,
    [taskHash.toLowerCase(), toVectorLiteral(vector), model, routingText],
  );
  return vector;
}

/** KNN over agents that carry vectors from the SAME model (mixing models makes
 *  distances meaningless). */
export async function semanticCandidates(taskVector: number[], k = 10): Promise<SemanticCandidate[]> {
  const db = await getPool();
  const { rows } = await db.query<{ address: string; display_name: string; dist: number }>(
    `SELECT address, display_name, embedding <=> $1::vector AS dist
       FROM agent_executors
      WHERE embedding IS NOT NULL AND embedding_model = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [toVectorLiteral(taskVector), embeddingModelId(), k],
  );
  return rows.map((r) => ({
    address: r.address,
    displayName: r.display_name,
    similarity: Math.round((1 - Number(r.dist)) * 1000) / 1000,
  }));
}

/**
 * Retrieve-then-rerank: reorder KNN candidates by a cross-encoder's true
 * query↔document fit (Voyage rerank-2.5, same key). `docByAddress` supplies
 * each candidate's agent text. Returns candidates sorted best-first with a
 * rerankScore. On the mock path (no real key) it's an identity passthrough
 * with score 0 — so callers can always rely on the reranked shape.
 */
export async function rerankCandidates(
  query: string,
  candidates: SemanticCandidate[],
  docByAddress: Map<string, string>,
): Promise<RerankedCandidate[]> {
  if (candidates.length === 0) return [];
  // No real reranker configured → passthrough (preserve KNN order).
  if (config.embeddingProvider === 'mock' || !config.embeddingApiKey) {
    return candidates.map((c) => ({ ...c, rerankScore: 0 }));
  }
  const documents = candidates.map((c) => docByAddress.get(c.address.toLowerCase()) ?? c.displayName);
  const res = await fetch('https://api.voyageai.com/v1/rerank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.embeddingApiKey}` },
    body: JSON.stringify({ model: config.rerankModel, query, documents, top_k: candidates.length }),
  });
  if (!res.ok) {
    throw new Error(`Voyage rerank failed: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
  }
  const json = (await res.json()) as { data: Array<{ index: number; relevance_score: number }> };
  // Voyage returns items sorted by relevance; `index` points back into `candidates`.
  return json.data.map((d) => ({ ...candidates[d.index], rerankScore: d.relevance_score }));
}

/**
 * Fire-and-forget shadow record for one freshly indexed task. Failures are
 * logged and swallowed — shadow measurement must never affect indexing.
 */
export async function recordMatchShadow(meta: A2ATaskMeta): Promise<void> {
  try {
    const routingText = buildTaskRoutingText(meta);
    if (!routingText) return; // nothing public to match on — no shadow row

    const vector = await embedTask(meta.taskId, routingText);
    const [semantic, tagRanked] = await Promise.all([
      semanticCandidates(vector, 10),
      rankAgents((meta.requiredCapabilities ?? []) as AgentCapability[]).catch(() => []),
    ]);

    const db = await getPool();
    await db.query(
      `INSERT INTO match_shadow_log (task_hash, routing_text, embedding_model, semantic_topk, tag_topk, required_capabilities)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (task_hash) DO UPDATE SET
         routing_text = $2, embedding_model = $3, semantic_topk = $4, tag_topk = $5,
         required_capabilities = $6, updated_at = NOW()`,
      [
        meta.taskId.toLowerCase(),
        routingText,
        embeddingModelId(),
        JSON.stringify(semantic),
        JSON.stringify(tagRanked.slice(0, 10).map((a) => ({ address: a.address, displayName: a.displayName, score: a.score }))),
        meta.requiredCapabilities ?? [],
      ],
    );
  } catch (err) {
    console.warn(`[semanticMatch] shadow record failed for ${meta.taskId.slice(0, 10)}…:`, (err as Error).message);
  }
}

/** Best-effort outcome fill-in from the accept / settlement paths. */
export async function recordShadowOutcome(
  taskHash: string,
  outcome: { acceptedBy?: string; settled?: boolean },
): Promise<void> {
  try {
    const db = await getPool();
    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [taskHash.toLowerCase()];
    if (outcome.acceptedBy !== undefined) {
      vals.push(outcome.acceptedBy.toLowerCase());
      sets.push(`accepted_by = $${vals.length}`);
    }
    if (outcome.settled !== undefined) {
      vals.push(outcome.settled);
      sets.push(`settled = $${vals.length}`);
    }
    await db.query(`UPDATE match_shadow_log SET ${sets.join(', ')} WHERE task_hash = $1`, vals);
  } catch (err) {
    console.warn(`[semanticMatch] shadow outcome failed for ${taskHash.slice(0, 10)}…:`, (err as Error).message);
  }
}

// ── Metrics (pure — unit-tested; the tuning loop's success gate) ────────────

export interface ShadowRow {
  semantic_topk: Array<{ address: string }>;
  tag_topk: Array<{ address: string }>;
  accepted_by: string | null;
  settled: boolean | null;
}

export interface ShadowMetrics {
  tasks: number;            // rows with a known acceptor
  settledTasks: number;
  semantic: { hit1: number; hit3: number; mrr: number };
  tag: { hit1: number; hit3: number; mrr: number };
}

/** Rank (1-based) of the actual acceptor in a ranking, or 0 if absent. */
function rankOf(list: Array<{ address: string }>, addr: string): number {
  const i = list.findIndex((e) => e.address.toLowerCase() === addr);
  return i === -1 ? 0 : i + 1;
}

/**
 * How well did each ranking predict the agent that ACTUALLY took (and ideally
 * settled) the task? hit@1 / hit@3 / mean-reciprocal-rank, computed over rows
 * with a known acceptor. This is the loop's comparison metric: "flip-ready"
 * = semantic ≥ tag on MRR (primary) without a lower settled rate.
 */
export function computeShadowMetrics(rows: ShadowRow[]): ShadowMetrics {
  const scored = rows.filter((r) => !!r.accepted_by);
  const agg = (pick: (r: ShadowRow) => Array<{ address: string }>) => {
    let hit1 = 0, hit3 = 0, rr = 0;
    for (const r of scored) {
      const rank = rankOf(pick(r), r.accepted_by!.toLowerCase());
      if (rank === 1) hit1++;
      if (rank >= 1 && rank <= 3) hit3++;
      if (rank > 0) rr += 1 / rank;
    }
    const n = scored.length || 1;
    return {
      hit1: Math.round((hit1 / n) * 1000) / 1000,
      hit3: Math.round((hit3 / n) * 1000) / 1000,
      mrr: Math.round((rr / n) * 1000) / 1000,
    };
  };
  return {
    tasks: scored.length,
    settledTasks: scored.filter((r) => r.settled === true).length,
    semantic: agg((r) => r.semantic_topk),
    tag: agg((r) => r.tag_topk),
  };
}

/** Load recent shadow rows + computed metrics (the admin report). */
export async function shadowReport(limit = 200): Promise<{ metrics: ShadowMetrics; recent: unknown[] }> {
  const db = await getPool();
  const { rows } = await db.query<ShadowRow & { task_hash: string; routing_text: string; created_at: string }>(
    'SELECT * FROM match_shadow_log ORDER BY created_at DESC LIMIT $1',
    [Math.min(1000, limit)],
  );
  return { metrics: computeShadowMetrics(rows), recent: rows.slice(0, 25) };
}

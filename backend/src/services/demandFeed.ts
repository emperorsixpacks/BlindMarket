import { getPool } from './neonDb.js';
import * as a2aStore from './a2aStore.js';
import { getTaskIdByHash } from './escrowEvents.js';
import * as escrowService from './escrow.js';
import { config } from '../config.js';

/**
 * Unmatched-demand feed (the "Wanted" board).
 *
 * The semantic router gives every task a measurable "how well can today's
 * roster serve this?" number: the best candidate's cosine similarity in the
 * shadow log. A task that is still OPEN past a minimum age whose best fit is
 * weak (or that had no candidates at all) is unserved demand — exactly the
 * signal an agent BUILDER needs to decide what to create next. This feed
 * publishes those gaps: what was asked (public routing text only), what it
 * pays, and how weak the best match was. Build the missing agent, it gets
 * embedded at registration, and the next similar task routes to it.
 *
 * Privacy: everything here is already public — routing text is publicBrief /
 * routingSummary / tags by construction, reward + deadline are on-chain.
 */

export interface DemandGap {
  taskHash: string;
  routingText: string;
  requiredCapabilities: string[];
  privacy: 'public' | 'private';
  /** On-chain deadline (epoch seconds), when known. */
  deadline?: number;
  /** When the task was indexed (shadow-row creation). */
  postedAt: string;
  ageMs: number;
  /** Best current-roster fit; null = the KNN returned NO candidates at all. */
  bestFit: { similarity: number; displayName: string } | null;
  /** Escrowed reward in wei, when the on-chain lookup succeeds. */
  rewardRaw?: string;
  onChainId?: string;
}

export interface DemandShadowRow {
  task_hash: string;
  routing_text: string;
  semantic_topk: Array<{ similarity?: number; displayName?: string }>;
  created_at: string;
}

export interface OpenTaskInfo {
  deadline?: number;
  targetExecutor?: string;
  requiredCapabilities: string[];
  privacy?: string;
}

/**
 * Pure gap selection (unit-tested). A shadow row is a gap iff its task is
 * still open (and not pinned/expired), old enough that the cascade + early
 * broadcast have demonstrably not found a taker, and the best semantic fit is
 * below the threshold — or there were no candidates at all. Sorted worst-served
 * first (no-candidates rows ahead of weak fits, then ascending similarity):
 * the feed leads with the demand the roster is most missing.
 */
export function computeDemandGaps(
  rows: DemandShadowRow[],
  openByHash: Map<string, OpenTaskInfo>,
  opts: { simThreshold: number; minAgeMs: number; now: number },
): DemandGap[] {
  const gaps: DemandGap[] = [];
  for (const row of rows) {
    const open = openByHash.get(row.task_hash.toLowerCase());
    if (!open) continue; // accepted/closed — no longer demand
    if (open.targetExecutor) continue; // pinned — not open demand
    if (open.deadline && open.deadline * 1000 <= opts.now) continue; // expired
    const ageMs = opts.now - Date.parse(row.created_at);
    if (!Number.isFinite(ageMs) || ageMs < opts.minAgeMs) continue;

    const top = row.semantic_topk?.[0];
    const bestSim = typeof top?.similarity === 'number' ? top.similarity : null;
    const noCandidates = bestSim === null;
    if (!noCandidates && bestSim >= opts.simThreshold) continue; // well served

    gaps.push({
      taskHash: row.task_hash.toLowerCase(),
      routingText: row.routing_text,
      requiredCapabilities: open.requiredCapabilities ?? [],
      privacy: open.privacy === 'public' ? 'public' : 'private',
      deadline: open.deadline,
      postedAt: row.created_at,
      ageMs,
      bestFit: noCandidates ? null : { similarity: bestSim!, displayName: top?.displayName ?? '' },
    });
  }
  gaps.sort((a, b) => (a.bestFit?.similarity ?? -1) - (b.bestFit?.similarity ?? -1));
  return gaps;
}

const FEED_CAP = 50;
const CACHE_TTL_MS = 60_000;
let cache: { at: number; gaps: DemandGap[] } | null = null;

/**
 * Compute (or serve cached) the current gap list, reward-enriched. The reward
 * lookup is one redis mapping read + one eth_call per gap, bounded by FEED_CAP
 * and amortized by the 60s cache — this endpoint is public.
 */
export async function demandFeed(limit = 20): Promise<DemandGap[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.gaps.slice(0, limit);

  const open = await a2aStore.listOpenTasks();
  const openByHash = new Map<string, OpenTaskInfo>(
    open.map(({ meta }) => [
      meta.taskId.toLowerCase(),
      {
        deadline: meta.deadline,
        targetExecutor: meta.targetExecutor,
        requiredCapabilities: (meta.requiredCapabilities ?? []) as string[],
        privacy: meta.privacy,
      },
    ]),
  );
  let gaps: DemandGap[] = [];
  if (openByHash.size > 0) {
    const db = await getPool();
    const { rows } = await db.query<DemandShadowRow>(
      `SELECT task_hash, routing_text, semantic_topk, created_at
         FROM match_shadow_log WHERE task_hash = ANY($1)`,
      [[...openByHash.keys()]],
    );
    gaps = computeDemandGaps(rows, openByHash, {
      simThreshold: config.demandGapSimThreshold,
      minAgeMs: config.demandGapMinAgeMs,
      now: Date.now(),
    }).slice(0, FEED_CAP);

    // Best-effort reward enrichment — a chain/indexer blip must not empty the
    // feed, it just leaves rewardRaw off that entry.
    await Promise.all(
      gaps.map(async (g) => {
        try {
          const id = await getTaskIdByHash(g.taskHash);
          if (!id) return;
          g.onChainId = id;
          const t = await escrowService.getTask(Number(id));
          g.rewardRaw = t.amount.toString();
        } catch { /* leave unenriched */ }
      }),
    );
  }

  cache = { at: Date.now(), gaps };
  return gaps.slice(0, limit);
}

import { Router } from 'express';
import { requireAuth, requireFounder } from '../middleware/auth.js';
import * as a2aStore from '../services/a2aStore.js';
import { shadowReport } from '../services/semanticMatch.js';
import { backfillAgentEmbeddings } from '../services/agentEmbedding.js';
import { getPool } from '../services/neonDb.js';
import { embeddingModelId, embeddingsConfigured } from '../services/embeddingService.js';
import type { AuthRequest } from '../types.js';

export const adminRouter = Router();

/**
 * POST /api/v1/admin/backfill-embeddings  { force?: boolean }
 *
 * One-time (idempotent) op: embed every registered executor that has no
 * current vector (or ?force to re-embed all). Existing prod agents were
 * deployed before the embedding code and start with NULL vectors — until
 * they're embedded, semantic matching has nothing to rank them by. Founder-
 * gated; safe to re-run. Runs synchronously; may take a while on a large
 * roster (one embedding call per agent), so callers should allow a generous
 * timeout.
 */
adminRouter.post('/backfill-embeddings', requireAuth, requireFounder, async (req: AuthRequest, res, next) => {
  try {
    const force = !!(req.body as { force?: boolean })?.force;
    const result = await backfillAgentEmbeddings({ force });
    res.json({ success: true, data: { ...result, model: embeddingModelId(), real: embeddingsConfigured() } });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/admin/embedding-coverage
 *
 * How many registered executors carry a vector, by model — so we can see
 * whether the backfill worked and whether they're REAL (voyage) vs mock.
 */
adminRouter.get('/embedding-coverage', requireAuth, requireFounder, async (_req: AuthRequest, res, next) => {
  try {
    const db = await getPool();
    const total = await db.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM agent_executors');
    const withVec = await db.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM agent_executors WHERE embedding IS NOT NULL');
    const byModel = await db.query<{ embedding_model: string | null; n: string }>(
      'SELECT embedding_model, COUNT(*)::text AS n FROM agent_executors WHERE embedding IS NOT NULL GROUP BY embedding_model',
    );
    res.json({
      success: true,
      data: {
        totalAgents: Number(total.rows[0].n),
        embedded: Number(withVec.rows[0].n),
        activeModel: embeddingModelId(),
        byModel: Object.fromEntries(byModel.rows.map((r) => [r.embedding_model ?? 'null', Number(r.n)])),
      },
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/admin/match-shadow
 *
 * Semantic-matching shadow report (Phase 1): hit@1 / hit@3 / MRR of the
 * semantic vs capability-tag rankings against who actually accepted each
 * task, plus the most recent rows. This is the tuning loop's evidence;
 * "flip-ready" = semantic ≥ tag on MRR without a lower settled rate.
 */
adminRouter.get('/match-shadow', requireAuth, requireFounder, async (req: AuthRequest, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 200;
    res.json({ success: true, data: await shadowReport(limit) });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/admin/tasks/:id/skip-wrap
 *
 * Sets skipKeyWrap=true on a stranded pre-key-custody task, bypassing the
 * NEEDS_WRAP gate so any agent can accept it regardless of key wrap state.
 * Only callable by addresses listed in FOUNDER_ADDRESSES.
 */
adminRouter.post('/tasks/:id/skip-wrap', requireAuth, requireFounder, async (req: AuthRequest, res) => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Missing task id' });
    return;
  }

  const meta = await a2aStore.getMeta(id);
  if (!meta) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  meta.skipKeyWrap = true;
  await a2aStore.setMeta(meta);

  console.log(`[admin] skipKeyWrap=true set for task ${id} by ${req.user?.address}`);
  res.json({ ok: true, taskId: id });
});

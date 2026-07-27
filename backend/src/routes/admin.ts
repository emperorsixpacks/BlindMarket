import { Router } from 'express';
import { requireAuth, requireFounder } from '../middleware/auth.js';
import * as a2aStore from '../services/a2aStore.js';
import { shadowReport } from '../services/semanticMatch.js';
import type { AuthRequest } from '../types.js';

export const adminRouter = Router();

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

import { Router } from 'express';
import { requireAuth, requireFounder } from '../middleware/auth.js';
import * as a2aStore from '../services/a2aStore.js';
import type { AuthRequest } from '../types.js';

export const adminRouter = Router();

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

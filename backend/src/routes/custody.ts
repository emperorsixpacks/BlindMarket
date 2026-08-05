import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthRequest } from '../types.js';
import * as custodyVault from '../services/custodyVault.js';

export const custodyRouter = Router();

const ingestSchema = z.object({
  taskId: z.string().min(1),
  evidenceHash: z.string().min(1),
  dataSnapshot: z.string().optional(),
});

// POST /api/v1/custody/ingest
custodyRouter.post('/ingest', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { taskId, evidenceHash, dataSnapshot } = ingestSchema.parse(req.body);
    const submitter = req.user!.address;
    const entry = await custodyVault.ingestEvidence(taskId, evidenceHash, submitter, dataSnapshot);
    res.status(201).json({ success: true, data: entry });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: err.errors?.[0]?.message || 'Invalid input' },
      });
    }
    next(err);
  }
});

// GET /api/v1/custody/:taskId/chain
custodyRouter.get('/:taskId/chain', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const taskId = req.params.taskId as string;
    const chain = await custodyVault.getCustodyChain(taskId);

    // Auto-log "viewed" event
    const firstEntry = chain[0];
    if (firstEntry) {
      await custodyVault.logAuditEvent(taskId, firstEntry.id, 'viewed', req.user!.address);
    }

    res.json({ success: true, data: { chain } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/custody/:taskId/verify
custodyRouter.get('/:taskId/verify', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const taskId = req.params.taskId as string;
    const result = await custodyVault.verifyIntegrity(taskId);

    // Auto-log "integrity_check"
    await custodyVault.logAuditEvent(taskId, null, 'integrity_check', req.user!.address, `Result: ${result.valid ? 'pass' : 'fail'}`);

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/custody/:taskId/audit
custodyRouter.get('/:taskId/audit', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const taskId = req.params.taskId as string;
    const audit = await custodyVault.getAuditLog(taskId);
    res.json({ success: true, data: { audit } });
  } catch (err) {
    next(err);
  }
});

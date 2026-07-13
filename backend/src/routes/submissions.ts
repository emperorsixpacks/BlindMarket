import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import * as escrowService from '../services/escrow.js';
import type { AuthRequest, ApiResponse } from '../types.js';
import * as accountingService from '../services/accountingService.js';
import * as reputationDecay from '../services/reputationDecay.js';
import { getTokenDecimals } from '../services/chain.js';

export const submissionsRouter = Router();

// --- Schemas ---
const submitSchema = z.object({
  taskId: z.number().int().positive(),
  evidenceHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a bytes32 hex string'),
});

const approveSchema = z.object({
  taskId: z.number().int().positive(),
  passed: z.boolean(),
});

/**
 * POST /api/v1/submissions/submit
 * Build unsigned submitEvidence transaction for worker to sign.
 */
submissionsRouter.post('/submit', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { taskId, evidenceHash } = submitSchema.parse(req.body);
    const from = req.user!.address;

    const tx = await escrowService.buildSubmitEvidence(from, taskId, evidenceHash);

    const body: ApiResponse = {
      success: true,
      data: { unsignedTx: tx },
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/submissions/verify
 * Build unsigned completeVerification transaction (verifier/agent auth).
 */
submissionsRouter.post('/verify', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { taskId, passed } = approveSchema.parse(req.body);
    const from = req.user!.address;

    // Authorization: only the task's poster or its designated per-task verifier
    // may drive verification. requireAuth alone previously let any authenticated
    // wallet credit/slash any worker for any taskId — the accounting/reputation
    // writes below fired regardless of who called or whether the tx was signed.
    const task = await escrowService.getTask(taskId);
    const ZERO = '0x0000000000000000000000000000000000000000';
    const perTaskVerifier = (await escrowService.getTaskVerifier(taskId).catch(() => ZERO)).toLowerCase();
    const isPoster = task.agent.toLowerCase() === from.toLowerCase();
    const isVerifier = perTaskVerifier !== ZERO && perTaskVerifier === from.toLowerCase();
    if (from === 'agent' || (!isPoster && !isVerifier)) {
      throw new AppError(403, 'FORBIDDEN', 'Only the task poster or its designated verifier can verify this submission');
    }

    const tx = await escrowService.buildCompleteVerification(from, taskId, passed);

    // Record accounting + reputation events
    try {
      const decimals = await getTokenDecimals(task.token);
      const amount = Number(task.amount) / (10 ** decimals);
      const workerAddr = task.worker;

      if (passed) {
        // Use the real on-chain platform fee (feeBps, 1500 = 15%) — not a
        // hardcoded 1% — so the ledger matches what the contract actually
        // splits. amount is GROSS escrow, net is the worker take-home.
        const feeBps = await escrowService.feeBps();
        const fee = amount * (feeBps / 10_000);
        accountingService.recordTransaction({
          address: workerAddr,
          role: 'worker',
          taskId: String(taskId),
          type: 'payment',
          amount,
          fee,
          net: amount - fee,
        });
        accountingService.recordTransaction({
          address: 'platform',
          role: 'platform',
          taskId: String(taskId),
          type: 'fee',
          amount: fee,
        });
        await reputationDecay.recordTaskCompletion(workerAddr, String(taskId), 10).catch(() => {});
      } else {
        accountingService.recordTransaction({
          address: workerAddr,
          role: 'worker',
          taskId: String(taskId),
          type: 'slash',
          amount: 0,
        });
        await reputationDecay.recordDispute(workerAddr, String(taskId)).catch(() => {});
      }
      // On-chain reputation is updated by BlindEscrow internally when
      // completeVerification is called via the unsigned tx returned above.
    } catch (hookErr) {
      console.warn('[submissions] Accounting/reputation hook failed (non-blocking):', hookErr);
    }

    const body: ApiResponse = {
      success: true,
      data: { unsignedTx: tx },
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/submissions/:taskId
 * Get evidence hash from on-chain task.
 */
submissionsRouter.get('/:taskId', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const rawId = req.params.taskId as string;
    if (!/^\d+$/.test(rawId)) {
      throw new AppError(400, 'INVALID_TASK_ID', 'Task ID must be a positive integer');
    }
    const taskId = parseInt(rawId, 10);

    const task = await escrowService.getTask(taskId);

    const body: ApiResponse = {
      success: true,
      data: {
        taskId,
        evidenceHash: task.evidenceHash,
        status: task.status,
        submissionAttempts: task.submissionAttempts,
      },
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

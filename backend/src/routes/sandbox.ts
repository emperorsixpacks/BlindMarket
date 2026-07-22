import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthRequest, ApiResponse } from '../types.js';
import railwaySandbox from '../services/railwaySandbox.js';
const { isEnabled, createAndRun, getUsageHistory, calculateAgentCost, listActive } = railwaySandbox;

export const sandboxRouter = Router();

const execSchema = z.object({
  command: z.string().min(1).max(10000),
  setup: z.string().max(10000).optional(),
  taskId: z.string().optional(),
  timeoutSeconds: z.number().int().min(1).max(600).optional(),
});

/**
 * POST /api/v1/sandbox/exec
 * Execute a command in an ephemeral Railway sandbox.
 * Used by agent workers via BACKEND_URL — authenticated with platform token.
 */
sandboxRouter.post('/exec', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isEnabled()) {
      res.status(503).json({
        success: false,
        error: { code: 'SANDBOX_UNAVAILABLE', message: 'Railway sandboxes not configured' },
      });
      return;
    }

    const { command, setup, taskId, timeoutSeconds } = execSchema.parse(req.body);
    const agentId = req.user!.address;

    const { sandbox, result } = await createAndRun({
      command,
      setup,
      agentId,
      taskId,
      timeoutSeconds,
    });

    const usage = getUsageHistory(agentId).at(-1);

    res.json({
      success: true,
      data: {
        sandboxId: sandbox.id,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationSeconds: usage?.durationSeconds ?? 0,
        costMicroUnits: usage?.costMicroUnits ?? 0,
      },
    } satisfies ApiResponse);
  } catch (e: any) {
    next(e);
  }
});

/**
 * GET /api/v1/sandbox/usage
 * Get sandbox usage history for the authenticated agent (for billing).
 */
sandboxRouter.get('/usage', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const agentId = req.user!.address;
    const history = getUsageHistory(agentId);
    const cost = calculateAgentCost(agentId);

    res.json({
      success: true,
      data: { history, totalCost: cost },
    } satisfies ApiResponse);
  } catch (e: any) {
    next(e);
  }
});

/**
 * GET /api/v1/sandbox/status
 * Check if Railway sandboxes are enabled and list active sandboxes.
 */
sandboxRouter.get('/status', requireAuth, async (_req: AuthRequest, res, next) => {
  try {
    const active = listActive();
    res.json({
      success: true,
      data: {
        enabled: isEnabled(),
        activeCount: active.length,
        active,
      },
    } satisfies ApiResponse);
  } catch (e: any) {
    next(e);
  }
});

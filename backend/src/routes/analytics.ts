import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireFounder, optionalAuth } from '../middleware/auth.js';
import { recordBatch, getFunnel, getTopEvents } from '../services/analyticsService.js';
import type { ApiResponse, AuthRequest } from '../types.js';

export const analyticsRouter = Router();

const eventSchema = z.object({
  event: z.string().min(1).max(80),
  anonId: z.string().max(80).optional().nullable(),
  sessionId: z.string().max(80).optional().nullable(),
  path: z.string().max(512).optional().nullable(),
  referrer: z.string().max(512).optional().nullable(),
  props: z.record(z.unknown()).optional().nullable(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
});

/**
 * POST /api/v1/analytics/events
 * Public ingestion. Auth optional — if a JWT is present we attach the address.
 * Anonymous traffic still gets recorded (anon_id from client).
 */
analyticsRouter.post('/events', optionalAuth, (req: AuthRequest, res, next) => {
  try {
    const { events } = batchSchema.parse(req.body);
    const address = req.user?.address || null;
    const userAgent = (req.headers['user-agent'] as string | undefined) || null;

    const inserted = recordBatch(
      events.map(e => ({
        event: e.event,
        anonId: e.anonId ?? null,
        sessionId: e.sessionId ?? null,
        path: e.path ?? null,
        referrer: e.referrer ?? null,
        props: e.props ?? null,
        address,
        userAgent,
      })),
    );

    const body: ApiResponse<{ inserted: number }> = {
      success: true,
      data: { inserted },
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

const funnelQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).optional(),
});

/**
 * GET /api/v1/analytics/funnel?windowDays=30
 * Founder-only.
 */
analyticsRouter.get('/funnel', requireAuth, requireFounder, (req, res, next) => {
  try {
    const { windowDays } = funnelQuerySchema.parse(req.query);
    const funnel = getFunnel(windowDays ?? 30);
    const top = getTopEvents(windowDays ?? 30, 25);

    const body: ApiResponse<{ funnel: typeof funnel; topEvents: typeof top }> = {
      success: true,
      data: { funnel, topEvents: top },
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

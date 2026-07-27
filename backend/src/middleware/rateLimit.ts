import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthRequest } from '../types.js';

/** 100 requests per minute per IP */
export function createRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' },
    },
  });
}

/**
 * Per-authenticated-principal limiter for routes that trigger a PAID provider
 * call (embeddings / rerank). Keyed by the caller's wallet address, so rotating
 * IPs doesn't bypass it and every registered agent is capped individually.
 * Mount AFTER requireAuth so req.user is set. Falls back to IP for the
 * (shouldn't-happen) unauthenticated case.
 */
export function createUserRateLimiter(maxPerMinute: number) {
  return rateLimit({
    windowMs: 60 * 1000,
    max: maxPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => (req as AuthRequest).user?.address?.toLowerCase() || req.ip || 'anon',
    message: {
      success: false,
      error: { code: 'RATE_LIMIT', message: 'Too many matching requests — slow down' },
    },
  });
}

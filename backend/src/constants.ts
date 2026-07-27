/**
 * Centralised constants for the BlindMarket backend.
 *
 * Why a separate file? Magic numbers scattered across service files drift
 * silently when one is changed and others aren't. Grouping them here makes
 * the defaults discoverable and lets callers override via env vars where
 * appropriate.
 */

// ── A2A Accept Lock (Part 1: Race Condition Fix) ─────────────────────────────

/** How long the Redis accept lock is held per task (seconds). */
export const ACCEPT_LOCK_TTL_S = 30;

/** How long accept attempt audit data is kept (seconds). 24h. */
export const ATTEMPT_STREAM_TTL_S = 86_400;

// ── Gas-Liveness (Part 3) ────────────────────────────────────────────────────

/** Seconds after CAS-win before the settlement deadline expires. */
export const SETTLEMENT_DEADLINE_TTL_S = 120;

// ── Cascade / Offers ─────────────────────────────────────────────────────────

/** How long a cascade lives before falling back to CAS-race broadcast. */
export const CASCADE_TTL_MS = 120_000;

/** How long each ranked agent gets an exclusive offer before advancing. */
export const CASCADE_OFFER_MS = 12_000;

/** Exclusive offer window per agent (ms). */
export const OFFER_TTL_MS = 15_000;

// ── Expiry Sweep ─────────────────────────────────────────────────────────────

/** Sweep interval for expired tasks (ms). */
export const SWEEP_INTERVAL_MS = 60_000;

/** Grace period after deadline before terminal expiry (seconds). */
export const EXPIRY_GRACE_SEC = 60;

// ── Agent Runner ─────────────────────────────────────────────────────────────

/** Window for counting restarts (ms). */
export const RESTART_WINDOW_MS = 10 * 60_000;

/** Delay before auto-restart (ms). */
export const RESTART_DELAY_MS = 3_000;

/** Max restarts within window before giving up. */
export const MAX_RESTARTS_IN_WINDOW = 5;

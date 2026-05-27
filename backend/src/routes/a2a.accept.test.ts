import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Integration test for POST /api/v1/a2a/tasks/:id/accept — specifically the
 * key-custody self-heal branch and the regression-critical paths around it
 * (docs/TEE-REWRAP-SPEC.md §5.2). We mount the REAL a2aRouter so route wiring,
 * status codes, and the response shape are exercised; only the store, custody,
 * settlement, and auth modules are mocked so the test drives pure handler
 * logic with no Redis / chain / Privy.
 *
 * The matrix:
 *   1. own-slice fast path (custody off)        → 200, returns post-time slice, no rewrap
 *   2. encrypted + no slice + custody OFF        → 403 NEEDS_WRAP, CAS never runs  (production default)
 *   3. self-heal win (custody on)                → 200, rewrap → slice, merge + settle
 *   4. CAS loser (custody on)                    → 409, NO key, no rewrap, no settle
 *   5. rewrap failure (custody on)               → 503, task released, no settle
 */

// ── Mocks (hoisted by vitest above the imports below) ────────────────────────

vi.mock('../middleware/auth.js', () => ({
  // Inject the authenticated address from a header so each request can pick its
  // caller. Bypasses Privy/JWT entirely.
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { address: req.headers['x-test-address'] || '0xagent' };
    next();
  },
}));

vi.mock('../services/a2aStore.js', () => ({
  getMeta: vi.fn(),
  tryAccept: vi.fn(),
  mergeWrappedKeys: vi.fn(),
  releaseToOpen: vi.fn(),
  // Unused by /accept but imported by the module's other routes — stub so the
  // namespace import resolves.
  setMeta: vi.fn(),
  getState: vi.fn(),
  updateState: vi.fn(),
  getPosterTasks: vi.fn(),
  getExecutorTasks: vi.fn(),
  browseAgentTasks: vi.fn(),
  getIndexedHashes: vi.fn(),
}));

vi.mock('../services/agentStore.js', () => ({ getAgent: vi.fn() }));

vi.mock('../services/keyCustodyService.js', () => ({
  getKeyCustodyService: vi.fn(() => null),
  isKeyCustodyEnabled: vi.fn(() => false),
}));

vi.mock('../services/a2aSettlement.js', () => ({
  settleAssignment: vi.fn(() => Promise.resolve()),
  settleVerification: vi.fn(() => Promise.resolve()),
}));

// Import-side-effect-heavy modules (Redis / chain / DB). Mock so importing the
// router is pure. /accept touches none of these, so minimal stubs suffice.
vi.mock('../services/redis.js', () => ({
  redis: { set: vi.fn(), get: vi.fn(), exists: vi.fn(), pipeline: vi.fn() },
}));
vi.mock('../services/chain.js', () => ({
  provider: {},
  escrow: { interface: {}, getAddress: vi.fn() },
}));
vi.mock('../services/escrow.js', () => ({ getTask: vi.fn(), feeBps: vi.fn() }));
vi.mock('../services/escrowEvents.js', () => ({ getTaskIdByHash: vi.fn() }));
vi.mock('../services/autoVerify.js', () => ({ autoVerify: vi.fn() }));
vi.mock('../services/accountingService.js', () => ({}));
vi.mock('../services/reputation.js', () => ({}));
vi.mock('../services/reputationDecay.js', () => ({}));
vi.mock('../services/bidsStore.js', () => ({}));

import { a2aRouter } from './a2a.js';
import { globalErrorHandler } from '../middleware/errorHandler.js';
import * as a2aStore from '../services/a2aStore.js';
import * as agentStore from '../services/agentStore.js';
import * as keyCustody from '../services/keyCustodyService.js';
import { settleAssignment } from '../services/a2aSettlement.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const AGENT = '0xagent0000000000000000000000000000000001'; // lowercase: matches addrLc lookups
const TASK = '0xtaskhash';
const PUBKEY = '04' + 'ab'.repeat(64); // 130-char uncompressed secp256k1 hex
const ROOT = '0xroot';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1/a2a', a2aRouter);
  a.use(globalErrorHandler);
  return a;
}

function accept() {
  return request(app()).post(`/api/v1/a2a/tasks/${TASK}/accept`).set('x-test-address', AGENT);
}

/** A registered, capability-passing agent record. */
function agentRecord(overrides: Partial<any> = {}) {
  return { address: AGENT, capabilities: [], publicKey: PUBKEY, reputation: 50, tasksCompleted: 0, registeredAt: '', displayName: 'a', ...overrides };
}

/** Task meta with no capability gate. Pass rootHash/wrappedKeys/keyCustodyBlob per case. */
function meta(overrides: Partial<any> = {}) {
  return { taskId: TASK, requiredCapabilities: [], ...overrides };
}

/** A mock custody service whose rewrap returns `slice` (or throws if `fail`). */
function custody(slice: string, fail = false) {
  return {
    getActiveKey: vi.fn(),
    getAttestation: vi.fn(),
    rewrap: fail
      ? vi.fn(() => Promise.reject(new Error('boom')))
      : vi.fn(() => Promise.resolve(slice)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish the default: custody disabled. Custody tests override.
  vi.mocked(keyCustody.getKeyCustodyService).mockReturnValue(null);
  vi.mocked(agentStore.getAgent).mockResolvedValue(agentRecord() as any);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /accept — key custody', () => {
  it('1) own-slice fast path: returns the post-time slice, no re-wrap, custody off', async () => {
    vi.mocked(a2aStore.getMeta).mockResolvedValue(
      meta({ rootHash: ROOT, wrappedKeys: { [AGENT]: 'deadbeef' } }) as any,
    );
    vi.mocked(a2aStore.tryAccept).mockResolvedValue({ ok: true, state: {} } as any);

    const res = await accept();

    expect(res.status).toBe(200);
    expect(res.body.data.wrappedKey).toBe('deadbeef');
    expect(res.body.data.rootHash).toBe(ROOT);
    expect(settleAssignment).toHaveBeenCalledWith(TASK, AGENT);
    expect(a2aStore.mergeWrappedKeys).not.toHaveBeenCalled();
  });

  it('2) encrypted + no slice + custody OFF: 403 NEEDS_WRAP before the CAS (production default)', async () => {
    vi.mocked(a2aStore.getMeta).mockResolvedValue(meta({ rootHash: ROOT, wrappedKeys: {} }) as any);

    const res = await accept();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NEEDS_WRAP');
    expect(a2aStore.tryAccept).not.toHaveBeenCalled(); // never burned the transition
    expect(settleAssignment).not.toHaveBeenCalled();
  });

  it('3) self-heal win: re-wraps from custody, persists slice, settles', async () => {
    const svc = custody('reslice');
    vi.mocked(keyCustody.getKeyCustodyService).mockReturnValue(svc as any);
    vi.mocked(a2aStore.getMeta).mockResolvedValue(
      meta({ rootHash: ROOT, wrappedKeys: {}, keyCustodyBlob: { keyId: 'kid', blob: 'abcd' } }) as any,
    );
    vi.mocked(a2aStore.tryAccept).mockResolvedValue({ ok: true, state: {} } as any);

    const res = await accept();

    expect(res.status).toBe(200);
    expect(res.body.data.wrappedKey).toBe('reslice');
    expect(svc.rewrap).toHaveBeenCalledWith('kid', 'abcd', PUBKEY);
    expect(a2aStore.mergeWrappedKeys).toHaveBeenCalledWith(TASK, { [AGENT]: 'reslice' });
    expect(settleAssignment).toHaveBeenCalledWith(TASK, AGENT);
  });

  it('4) CAS loser gets nothing: 409, no re-wrap, no settle', async () => {
    const svc = custody('reslice');
    vi.mocked(keyCustody.getKeyCustodyService).mockReturnValue(svc as any);
    vi.mocked(a2aStore.getMeta).mockResolvedValue(
      meta({ rootHash: ROOT, wrappedKeys: {}, keyCustodyBlob: { keyId: 'kid', blob: 'abcd' } }) as any,
    );
    vi.mocked(a2aStore.tryAccept).mockResolvedValue({ ok: false, currentStatus: 'accepted' } as any);

    const res = await accept();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_OPEN');
    expect(svc.rewrap).not.toHaveBeenCalled(); // no decryption-oracle for losers
    expect(a2aStore.mergeWrappedKeys).not.toHaveBeenCalled();
    expect(settleAssignment).not.toHaveBeenCalled();
  });

  it('5) re-wrap failure: releases the task, 503, never settles on chain', async () => {
    const svc = custody('reslice', /* fail */ true);
    vi.mocked(keyCustody.getKeyCustodyService).mockReturnValue(svc as any);
    vi.mocked(a2aStore.getMeta).mockResolvedValue(
      meta({ rootHash: ROOT, wrappedKeys: {}, keyCustodyBlob: { keyId: 'kid', blob: 'abcd' } }) as any,
    );
    vi.mocked(a2aStore.tryAccept).mockResolvedValue({ ok: true, state: {} } as any);

    const res = await accept();

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('REWRAP_FAILED');
    expect(a2aStore.releaseToOpen).toHaveBeenCalledWith(TASK);
    expect(settleAssignment).not.toHaveBeenCalled(); // no undecryptable worker on chain
  });

  it('keyless agent cannot self-heal: 403 NEEDS_WRAP before the CAS', async () => {
    const svc = custody('reslice');
    vi.mocked(keyCustody.getKeyCustodyService).mockReturnValue(svc as any);
    vi.mocked(agentStore.getAgent).mockResolvedValue(agentRecord({ publicKey: undefined }) as any);
    vi.mocked(a2aStore.getMeta).mockResolvedValue(
      meta({ rootHash: ROOT, wrappedKeys: {}, keyCustodyBlob: { keyId: 'kid', blob: 'abcd' } }) as any,
    );

    const res = await accept();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NEEDS_WRAP');
    expect(a2aStore.tryAccept).not.toHaveBeenCalled();
    expect(svc.rewrap).not.toHaveBeenCalled();
  });
});

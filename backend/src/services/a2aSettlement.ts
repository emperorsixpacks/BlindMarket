/**
 * A2A settlement bridge.
 *
 * Translates off-chain A2A state transitions into on-chain BlindEscrow calls.
 * Without this, an A2A executor can complete work and have it auto-verified
 * in Redis — but the on-chain task stays in Funded state and the escrow
 * never releases.
 *
 * Two operations:
 *   - settleAssignment(taskHash, executor)  → marketplaceAssign(taskId, executor)
 *   - settleVerification(taskHash, passed)  → completeVerification(taskId, passed)
 *
 * Both use the marketplace signer (which holds the verifier role on the
 * contract — see contracts/scripts/rotate-verifier.ts). Both return a
 * SettleResult and never throw; route handlers AWAIT them and gate state
 * transitions / worker credit on `success` — crediting before the chain
 * confirms is how the inverse earnings drift ("N tasks credited · 0 0G
 * received") happened.
 *
 * Idempotency: the contract reverts with InvalidStatus if you try to assign
 * an already-Assigned task or verify an already-Verified one. The bridge
 * detects that error and treats it as success ("already settled, nothing to
 * do") rather than a failure to retry. This makes it safe to call repeatedly
 * — useful when route handlers fire the bridge speculatively and the operator
 * triggers a second time during a flaky run.
 */

import type { ContractTransactionResponse } from 'ethers';
import { escrowAsMarketplace, marketplaceSigner } from './chain.js';
import { getTaskIdByHash } from './escrowEvents.js';
import * as a2aStore from './a2aStore.js';
import { rooms } from './socket.js';

// How long to wait for the TaskCreated event listener to populate the
// taskHash → taskId mapping before giving up on a settlement attempt.
// 30s easily covers a few testnet block times plus the 30s polling tick.
const HASH_LOOKUP_TIMEOUT_MS = 30_000;
const HASH_LOOKUP_POLL_INTERVAL_MS = 2_000;

/**
 * Serial tx queue for the marketplace signer.
 *
 * All marketplaceAssign / completeVerification calls go through the same
 * signer wallet, which means they share a nonce sequence. Without
 * serialisation, two concurrent /accept requests fire two settleAssignment()
 * calls in parallel; both grab the same nonce and one gets dropped with
 * REPLACEMENT_UNDERPRICED. Surfaced as a real bug by the extensive smoke
 * battery — tasks 19 and 21 stuck at Funded because their bridge txs
 * collided with task 20's.
 *
 * Pattern: chain new operations onto a tail promise. Each operation awaits
 * the previous one (success or failure) before running. Errors don't break
 * the chain — they're swallowed for the queue but still returned to the
 * caller so individual callers see what happened.
 */
let signerTxQueue: Promise<unknown> = Promise.resolve();
function enqueueSignerTx<T>(fn: () => Promise<T>): Promise<T> {
  const next = signerTxQueue.then(fn, fn);
  signerTxQueue = next.catch(() => {}); // don't propagate errors to the next queued tx
  return next;
}

function bridgeReady(): boolean {
  if (!escrowAsMarketplace || !marketplaceSigner) {
    console.error(
      '[a2aSettlement] bridge disabled — MARKETPLACE_SIGNER_PRIVATE_KEY is not set in backend env. ' +
        'Run contracts/scripts/generate-marketplace-signer.ts and rotate-verifier.ts to provision it.',
    );
    return false;
  }
  return true;
}

async function waitForTaskId(taskHash: string): Promise<string | null> {
  const deadline = Date.now() + HASH_LOOKUP_TIMEOUT_MS;
  // First lookup runs immediately (no upfront delay) — covers the common case
  // where the event listener has already captured the mapping.
  while (true) {
    const id = await getTaskIdByHash(taskHash);
    if (id) return id;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, HASH_LOOKUP_POLL_INTERVAL_MS));
  }
}

function isAlreadySettled(err: unknown): boolean {
  // BlindEscrow's marketplaceAssign/completeVerification revert with
  // InvalidStatus when the task is no longer in the expected state. From the
  // bridge's perspective that's the same as "already done" — log and continue.
  const msg = (err as Error).message || '';
  return msg.includes('InvalidStatus');
}

function isDeadlineReached(err: unknown): boolean {
  // marketplaceAssign reverts DeadlineReached() once block.timestamp passes
  // the task deadline. Unlike InvalidStatus this is TERMINAL for assignment —
  // the task can never be assigned again, only reclaimed by the poster. It
  // must NOT be classed as a retryable failure: releaseToOpen would re-list
  // the task for the next /accept to hit the exact same revert, forever.
  const msg = (err as Error).message || '';
  return msg.includes('DeadlineReached');
}

export interface SettleResult {
  success: boolean;
  error?: string;
  txHash?: string;
  alreadySettled?: boolean;
  /** Terminal: the on-chain deadline has passed — do not release/retry. */
  expired?: boolean;
}

/**
 * Translate an A2A `accepted` transition into an on-chain assignment.
 * Looks up the on-chain taskId from the taskHash (waiting for the
 * TaskCreated event listener if needed), then calls marketplaceAssign as the
 * verifier. Persists the tx hash to the A2A state on success.
 *
 * Returns a SettleResult so callers can await and respond accordingly.
 * Unexpected errors (not bridge-not-ready, not already-settled) propagate.
 */
export async function settleAssignment(taskHash: string, executor: string): Promise<SettleResult> {
  if (!bridgeReady()) {
    const msg = 'Bridge disabled: MARKETPLACE_SIGNER_PRIVATE_KEY not set';
    await safePersistAssignError(taskHash, msg);
    return { success: false, error: msg };
  }

  const taskId = await waitForTaskId(taskHash);
  if (taskId === null) {
    const msg = `hash2id lookup timed out — createTask event never seen by indexer (taskHash=${taskHash.slice(0, 10)}…)`;
    console.error(`[a2aSettlement] ${msg}`);
    await safePersistAssignError(taskHash, msg);
    return { success: false, error: msg };
  }

  let tx: ContractTransactionResponse;
  try {
    try {
      await escrowAsMarketplace!.marketplaceAssign.staticCall(BigInt(taskId), executor);
    } catch (staticErr) {
      if (isAlreadySettled(staticErr)) {
        console.log(`[a2aSettlement] assignment skipped — task ${taskId} already past Funded state`);
        return { success: true, alreadySettled: true };
      }
      if (isDeadlineReached(staticErr)) {
        console.warn(`[a2aSettlement] assignment refused — task ${taskId} deadline has passed (terminal)`);
        return { success: false, expired: true, error: 'Task deadline has passed' };
      }
      console.error(`[a2aSettlement] staticCall failed for taskId=${taskId}: ${(staticErr as Error).message}`);
      throw staticErr;
    }

    tx = await enqueueSignerTx(() =>
      escrowAsMarketplace!.marketplaceAssign(BigInt(taskId), executor) as Promise<ContractTransactionResponse>,
    );
  } catch (err) {
    if (isAlreadySettled(err)) {
      console.log(`[a2aSettlement] assignment skipped — task ${taskId} already past Funded state`);
      return { success: true, alreadySettled: true };
    }
    if (isDeadlineReached(err)) {
      console.warn(`[a2aSettlement] assignment refused — task ${taskId} deadline has passed (terminal)`);
      return { success: false, expired: true, error: 'Task deadline has passed' };
    }
    const msg = (err as Error).message;
    console.error(`[a2aSettlement] assignment failed for hash=${taskHash.slice(0, 10)}…:`, msg);
    await safePersistAssignError(taskHash, msg);
    return { success: false, error: msg };
  }

  await a2aStore.updateState(taskHash, { assignTxHash: tx.hash, assignError: undefined });
  console.log(`[a2aSettlement] marketplaceAssign broadcast taskId=${taskId} tx=${tx.hash}`);

  const receipt = await tx.wait();
  console.log(
    `[a2aSettlement] marketplaceAssign confirmed taskId=${taskId} block=${receipt?.blockNumber} status=${receipt?.status}`,
  );
  if (receipt?.status !== 1) {
    const msg = `marketplaceAssign tx ${tx.hash} reverted on chain`;
    await safePersistAssignError(taskHash, msg);
    return { success: false, error: msg, txHash: tx.hash };
  }

  return { success: true, txHash: tx.hash };
}

// Writing to Redis can itself fail (network blip, key missing if releaseToOpen
// raced us). Don't let the bookkeeping write blow up the bridge — the bridge
// is already in an error path, surfacing a second error here just buries the
// real one. Log and continue.
async function safePersistAssignError(taskHash: string, msg: string): Promise<void> {
  try {
    await a2aStore.updateState(taskHash, { assignError: truncate(msg) });
  } catch (e) {
    console.error(
      `[a2aSettlement] could not persist assignError for ${taskHash.slice(0, 10)}…:`,
      (e as Error).message,
    );
  }
}

async function safePersistVerifyError(taskHash: string, msg: string): Promise<void> {
  try {
    await a2aStore.updateState(taskHash, { verifyError: truncate(msg) });
  } catch (e) {
    console.error(
      `[a2aSettlement] could not persist verifyError for ${taskHash.slice(0, 10)}…:`,
      (e as Error).message,
    );
  }
}

// Bridge errors include stack traces and full RPC payloads. Cap at 240 chars
// so the Redis value stays small and the worker log line doesn't wrap into
// the next century. The first ~240 chars contain the actual revert reason.
function truncate(s: string): string {
  return s.length > 240 ? s.slice(0, 240) + '…' : s;
}

/**
 * Translate an A2A `verified` or `failed` transition into an on-chain
 * completeVerification(taskId, passed). On the contract, passed=true releases
 * escrow to the worker (85/15 split); passed=false only moves the task to
 * Verified — it does NOT refund the poster, and there is NO auto-cancel after
 * MAX_SUBMISSION_ATTEMPTS (the contract just blocks further submitEvidence and
 * records a dispute). After a terminal failure the only exits are the poster's
 * claimTimeout (post-deadline refund) or an admin resolveDispute.
 */
export async function settleVerification(taskHash: string, passed: boolean): Promise<SettleResult> {
  if (!bridgeReady()) {
    const msg = 'Bridge disabled: MARKETPLACE_SIGNER_PRIVATE_KEY not set';
    await safePersistVerifyError(taskHash, msg);
    return { success: false, error: msg };
  }

  try {
    const taskId = await waitForTaskId(taskHash);
    if (taskId === null) {
      const msg = `hash2id lookup timed out — createTask event never seen by indexer (taskHash=${taskHash.slice(0, 10)}…)`;
      console.error(`[a2aSettlement] ${msg}`);
      await safePersistVerifyError(taskHash, msg);
      return { success: false, error: msg };
    }

    let tx: ContractTransactionResponse;
    try {
      // Serialise via the shared signer tx queue (see enqueueSignerTx above)
      tx = await enqueueSignerTx(() =>
        escrowAsMarketplace!.completeVerification(BigInt(taskId), passed) as Promise<ContractTransactionResponse>,
      );
    } catch (err) {
      if (isAlreadySettled(err)) {
        // InvalidStatus means the task is no longer Submitted — but that
        // covers MORE than "this verdict already settled": Disputed,
        // Cancelled, and a racing settlement with the OPPOSITE verdict all
        // revert the same way. Only report success when the on-chain outcome
        // actually matches `passed`; otherwise crediting would mirror a
        // settlement that never happened. (The caller's retry converges via
        // the routes' reconcile-from-chain branch.)
        try {
          const t = await escrowAsMarketplace!.getTask(BigInt(taskId));
          const status = Number(t.status);
          if (status === (passed ? 4 : 3)) {
            console.log(
              `[a2aSettlement] verification skipped — task ${taskId} already settled with matching outcome (status=${status})`,
            );
            return { success: true, alreadySettled: true };
          }
          const msg = `task ${taskId} already settled with status=${status}, which does not match passed=${passed}`;
          console.error(`[a2aSettlement] ${msg}`);
          await safePersistVerifyError(taskHash, msg);
          return { success: false, error: msg };
        } catch (readErr) {
          const msg = `task ${taskId} reverted InvalidStatus and the follow-up status read failed: ${(readErr as Error).message}`;
          await safePersistVerifyError(taskHash, msg);
          return { success: false, error: msg };
        }
      }
      throw err;
    }

    await a2aStore.updateState(taskHash, { verifyTxHash: tx.hash, verifyError: undefined });
    console.log(
      `[a2aSettlement] completeVerification broadcast taskId=${taskId} passed=${passed} tx=${tx.hash}`,
    );

    // Bounded wait: routes now AWAIT this inside the HTTP handler, so a tx
    // stuck in the mempool must surface as a retryable failure, not hold the
    // request open indefinitely. ethers v6 wait(confirms, timeoutMs) throws
    // a timeout error → caught below → success:false → the route 503s and
    // the retry converges (settle re-runs or the reconcile branch adopts the
    // landed tx).
    const receipt = await tx.wait(1, 60_000);
    console.log(
      `[a2aSettlement] completeVerification confirmed taskId=${taskId} passed=${passed} block=${receipt?.blockNumber} status=${receipt?.status}`,
    );
    if (receipt?.status !== 1) {
      const msg = `completeVerification tx ${tx.hash} reverted on chain`;
      await safePersistVerifyError(taskHash, msg);
      return { success: false, error: msg, txHash: tx.hash };
    }

    if (passed) {
      rooms.tasks('task:completed', { taskId });
      rooms.task(taskId, 'task:completed', { taskId });
    }
    return { success: true, txHash: tx.hash };
  } catch (err) {
    const msg = (err as Error).message;
    console.error(
      `[a2aSettlement] verification failed for hash=${taskHash.slice(0, 10)}…:`,
      msg,
    );
    await safePersistVerifyError(taskHash, msg);
    return { success: false, error: msg };
  }
}

/** True if the bridge has all its prerequisites configured. */
export function isBridgeConfigured(): boolean {
  return !!(escrowAsMarketplace && marketplaceSigner);
}

import { reputation } from './chain.js';
import type { Reputation } from '../types.js';

/** Raw on-chain reputation data */
export async function getReputation(worker: string): Promise<Reputation> {
  const [tasksCompleted, totalScore, disputes] = await reputation.getReputation(worker);
  return {
    tasksCompleted: tasksCompleted as bigint,
    totalScore: totalScore as bigint,
    disputes: disputes as bigint,
  };
}

/**
 * Composite 0-100 reputation score derived from on-chain data.
 *
 * Formula:
 *   avgScore = totalScore / tasksCompleted (normalized 0-5)
 *   reliability = tasksCompleted / (tasksCompleted + disputes + 1)
 *   score = (avgScore / 5) * reliability * 100
 *
 * Returns 0 for unrated workers.
 */
export async function getCompositeScore(worker: string): Promise<number> {
  try {
    return computeCompositeScore(await getReputation(worker));
  } catch {
    return 0;
  }
}

/**
 * Pure composite-score math over already-fetched on-chain reputation, so
 * callers that already hold a Reputation don't pay for a second RPC read.
 */
function computeCompositeScore(rep: Reputation): number {
  const tasks = Number(rep.tasksCompleted);
  if (tasks === 0) return 0;
  const total = Number(rep.totalScore);
  const disputes = Number(rep.disputes);
  const avgScore = total / tasks / 100; // 0-5
  const reliability = tasks / (tasks + disputes + 1);
  const score = (avgScore / 5) * reliability * 100;
  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Get reputation merged with a display-friendly shape.
 * Returns the on-chain data plus a computed 0-100 score and dispute ratio.
 */
export async function getReputationWithScore(worker: string): Promise<{
  address: string;
  tasksCompleted: number;
  avgScore: number;
  disputes: number;
  disputeRatio: number;
  score: number;
}> {
  // Single on-chain read; the composite score is derived from it locally.
  // (Previously this called getCompositeScore, which re-fetched the same
  // on-chain data — doubling the RPC reads per agent on the /agents list.)
  const rep = await getReputation(worker);
  const tasks = Number(rep.tasksCompleted);
  const total = Number(rep.totalScore);
  const disputes = Number(rep.disputes);
  const avgScore = tasks > 0 ? total / tasks / 100 : 0;
  const score = computeCompositeScore(rep);

  return {
    address: worker,
    tasksCompleted: tasks,
    avgScore: Math.round(avgScore * 100) / 100,
    disputes,
    disputeRatio: tasks > 0 ? Math.round((disputes / tasks) * 10000) / 100 : 0,
    score,
  };
}

/** Check if a worker has been rated for a specific task */
export async function hasBeenRated(worker: string, taskId: number): Promise<boolean> {
  return await reputation.hasBeenRated(worker, taskId) as boolean;
}

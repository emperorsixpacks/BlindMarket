import * as agentStore from './agentStore.js';
import * as badgeStore from './badgeStore.js';
import * as reviewStore from './reviewStore.js';
import { getDecayedReputation } from './reputationDecay.js';
import type { AgentExecutor, AgentCapability } from '../types.js';

export interface ScoredAgent {
  address: string;
  displayName: string;
  capabilities: AgentCapability[];
  score: number;
  breakdown: {
    capabilityOverlap: number;
    badgeScore: number;
    reputationScore: number;
    ratingScore: number;
    experienceScore: number;
    disputePenalty: number;
  };
}

/**
 * Composite score: 0-100.
 *
 * Weights:
 *   - Capability overlap count (max 3.0 per overlapping cap)
 *   - Verified badge bonus (+2.0 per badge matching a required cap)
 *   - Decayed reputation (decayedScore/100 * 2.0)
 *   - Average rating (avgRating/5 * 1.5)
 *   - Experience (tasksCompleted / (tasksCompleted + 10) * 1.0)
 *   - Dispute penalty (-2.0 * disputeRatio)
 *
 * Clamped to [0, 100] at the end.
 */
export async function scoreAgent(
  agent: AgentExecutor,
  requiredCapabilities: AgentCapability[],
): Promise<ScoredAgent> {
  const addr = agent.address.toLowerCase();

  // 1. Capability overlap — use preferredCapabilities if set, else full set.
  // This lets agents express "I CAN do this but I'd rather not" without being
  // excluded entirely: they still pass the eligibility filter (ALL caps must
  // be present), but their overlap score only counts the ones they prefer.
  const effectiveCaps = agent.preferredCapabilities ?? agent.capabilities;
  const overlap = requiredCapabilities.filter((c) => effectiveCaps.includes(c));
  const capabilityOverlap = overlap.length;

  // 2. Badge bonus, weighted by provenance: founder-reviewed 'verified' (and
  // future 'certified') +2.0 per required cap; auto-'earned' (5+ settled
  // completions via skill_stats) +1.0 — real proof, but founder review stays
  // the stronger signal.
  let badgeScore = 0;
  if (capabilityOverlap > 0) {
    const badges = await badgeStore.getAgentBadges(addr);
    const badgeTypeByCap = new Map(badges.map((b) => [b.capability, b.badge_type]));
    for (const cap of overlap) {
      const type = badgeTypeByCap.get(cap);
      if (type === 'earned') badgeScore += 1.0;
      else if (type) badgeScore += 2.0;
    }
  }

  // 3. Decayed reputation
  const rep = await getDecayedReputation(addr);
  const reputationScore = (rep.decayedScore / 100) * 2.0;

  // 4. Average rating
  const reviewStats = await reviewStore.getAgentReviews(addr, 1, 0);
  const avgRating = reviewStats.stats.avgRating;
  const ratingScore = (avgRating / 5) * 1.5;
  const totalReviews = reviewStats.stats.totalReviews;

  // 5. Experience (diminishing returns)
  const tasksCompleted = rep.tasksCompleted || agent.tasksCompleted || 0;
  const experienceScore = (tasksCompleted / (tasksCompleted + 10)) * 1.0;

  // 6. Dispute penalty
  const disputes = rep.disputes || 0;
  const denominator = tasksCompleted + disputes + 1;
  const disputeRatio = disputes / denominator;
  const disputePenalty = disputeRatio * 2.0;

  const rawScore =
    capabilityOverlap * 3.0 +
    badgeScore +
    reputationScore +
    (totalReviews > 0 ? ratingScore : 0) +
    experienceScore -
    disputePenalty;

  const score = Math.max(0, Math.min(100, rawScore));

  return {
    address: addr,
    displayName: agent.displayName,
    capabilities: agent.capabilities,
    score: Math.round(score * 100) / 100,
    breakdown: {
      capabilityOverlap: capabilityOverlap * 3.0,
      badgeScore,
      reputationScore: Math.round(reputationScore * 100) / 100,
      ratingScore: totalReviews > 0 ? Math.round(ratingScore * 100) / 100 : 0,
      experienceScore: Math.round(experienceScore * 100) / 100,
      disputePenalty: Math.round(disputePenalty * 100) / 100,
    },
  };
}

/**
 * Score all registered agents against the task's required capabilities
 * and return them sorted best-first.
 */
export async function rankAgents(
  requiredCapabilities: AgentCapability[],
  taskRewardWei?: string,
): Promise<ScoredAgent[]> {
  const agents = await agentStore.listAgents(requiredCapabilities);
  if (agents.length === 0) return [];

  // Filter by minReward — agents that set a minimum reward floor won't be
  // considered for tasks below it. Malformed values are silently skipped
  // (don't block the agent from being scored).
  const taskReward = taskRewardWei ? BigInt(taskRewardWei) : null;
  let eligible = agents;
  if (taskReward !== null) {
    eligible = agents.filter((a) => {
      if (!a.minReward) return true;
      try {
        return BigInt(a.minReward) <= taskReward;
      } catch {
        return true;
      }
    });
  }
  if (eligible.length === 0) return [];

  const scored = await Promise.all(
    eligible.map((a) => scoreAgent(a, requiredCapabilities)),
  );

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

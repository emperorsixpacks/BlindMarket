import { embed } from './embeddingService.js';
import { buildTaskRoutingText } from './semanticMatch.js';
import * as deployedAgentStore from './deployedAgentStore.js';
import { config } from '../config.js';
import type { A2ATaskMeta, InstalledSkill } from '../types.js';

/**
 * Proof re-key (the semantic era's trust plumbing).
 *
 * Old world: proof — skill_stats rows and auto-'earned' badges — was keyed by
 * the task's declared capability TAGS at settlement. Semantic routing makes
 * tags optional, so semantically routed tasks increasingly settle with no
 * tags at all, and the worker's track record silently stops accruing exactly
 * as the marketplace stops needing tags. This module closes that hole: at
 * settlement, the task's PUBLIC routing text is matched (cosine over the same
 * embeddings that route tasks) against the worker's INSTALLED SKILLS — the
 * frozen SKILL.md snapshots on their deployed agent — and the closest skill
 * above a floor is credited alongside any declared tags. Proof becomes
 * skill-slug-keyed, which is what the tag-retirement phase needs.
 *
 * External (SDK) agents with no installed skills keep tag-only crediting —
 * slug proof is part of the incentive to declare skills. Failures are
 * swallowed by the caller's own guard: proof enrichment must never block a
 * payout.
 */

/** The text a skill exposes for matching — name + routing tags + the head of
 *  its instructions (enough signal without embedding a whole SKILL.md). */
export function skillDocText(s: Pick<InstalledSkill, 'name' | 'capabilities' | 'instructions'>): string {
  const caps = s.capabilities?.length ? ` (${s.capabilities.join(', ')})` : '';
  return `${s.name}${caps}\n${(s.instructions ?? '').slice(0, 1200)}`;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/** Pure argmax-with-floor over skill vectors (unit-tested). Returns the slug
 *  of the closest skill iff its cosine clears the threshold, else null —
 *  a task unrelated to everything the agent installed credits nothing. */
export function bestSkillSlug(
  taskVec: number[],
  skills: Array<{ slug: string; vector: number[] }>,
  threshold: number,
): { slug: string; similarity: number } | null {
  let best: { slug: string; similarity: number } | null = null;
  for (const s of skills) {
    const sim = cosine(taskVec, s.vector);
    if (!best || sim > best.similarity) best = { slug: s.slug, similarity: sim };
  }
  return best && best.similarity >= threshold ? best : null;
}

/**
 * Resolve the worker's best-matching installed skill slug for a settled task,
 * or null when there is nothing to credit (no deployed agent, no installed
 * skills, no routing text, weak match, or any failure). Embeds are memoized
 * by embeddingService, and a stable skill doc embeds to the same vector every
 * settlement, so steady-state cost is ~one embed per NEW routing text.
 */
export async function resolveProofSkillSlug(
  executorAddr: string,
  meta: Pick<A2ATaskMeta, 'publicBrief' | 'routingSummary' | 'requiredCapabilities'>,
): Promise<string | null> {
  try {
    const agent = await deployedAgentStore.loadAgentByWallet(executorAddr);
    const skills = agent?.skills ?? [];
    if (skills.length === 0) return null;

    const routingText = buildTaskRoutingText(meta);
    if (!routingText) return null;

    const [taskVec, ...skillVecs] = await Promise.all([
      embed(routingText).then((r) => r.vector),
      ...skills.map((s) => embed(skillDocText(s)).then((r) => r.vector)),
    ]);
    const best = bestSkillSlug(
      taskVec,
      skills.map((s, i) => ({ slug: s.slug, vector: skillVecs[i] })),
      config.proofSlugSimThreshold,
    );
    if (best) {
      console.log(
        `[proof] slug credit: ${executorAddr.slice(0, 10)}… × ${best.slug} (cosine ${best.similarity.toFixed(3)})`,
      );
    }
    return best?.slug ?? null;
  } catch (err) {
    console.warn(`[proof] slug resolution failed for ${executorAddr.slice(0, 10)}…:`, (err as Error).message);
    return null;
  }
}

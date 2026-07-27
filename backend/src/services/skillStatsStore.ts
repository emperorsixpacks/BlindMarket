import { getPool } from './neonDb.js';

/**
 * Per-skill (= per-capability-tag) track record (skill_stats, migration 15).
 * This is the PROOF layer: rows only ever accrue from real settled tasks —
 * recordCompletion is called inside recordWorkerPayout's at-most-once credit
 * block, recordFailure from the dispute path. A task with no declared
 * requiredCapabilities earns no per-skill credit (per-skill sums < the global
 * tasksCompleted counter by design).
 */

export interface SkillStat {
  agent_address: string;
  capability: string;
  tasks_completed: number;
  tasks_failed: number;
  last_task_at: string | null;
}

/** One UPSERT per capability; returns the new counters so the caller can run
 *  the earned-badge threshold check without a second read. */
export async function recordCompletion(agentAddress: string, capabilities: string[]): Promise<SkillStat[]> {
  if (capabilities.length === 0) return [];
  const db = await getPool();
  const out: SkillStat[] = [];
  for (const cap of capabilities) {
    const { rows } = await db.query<SkillStat>(
      `INSERT INTO skill_stats (agent_address, capability, tasks_completed, last_task_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (agent_address, capability)
       DO UPDATE SET tasks_completed = skill_stats.tasks_completed + 1, last_task_at = NOW()
       RETURNING *`,
      [agentAddress.toLowerCase(), cap],
    );
    out.push(rows[0]);
  }
  return out;
}

export async function recordFailure(agentAddress: string, capabilities: string[]): Promise<void> {
  if (capabilities.length === 0) return;
  const db = await getPool();
  for (const cap of capabilities) {
    await db.query(
      `INSERT INTO skill_stats (agent_address, capability, tasks_failed, last_task_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (agent_address, capability)
       DO UPDATE SET tasks_failed = skill_stats.tasks_failed + 1, last_task_at = NOW()`,
      [agentAddress.toLowerCase(), cap],
    );
  }
}

export async function getStats(agentAddress: string): Promise<SkillStat[]> {
  const db = await getPool();
  const { rows } = await db.query<SkillStat>(
    'SELECT * FROM skill_stats WHERE agent_address = $1 ORDER BY tasks_completed DESC',
    [agentAddress.toLowerCase()],
  );
  return rows;
}

export interface CapabilityCount {
  capability: string;
  agents: number;
  proven: number;
}

/** Per-capability totals for the PostTask picker: how many registered
 *  executors declare the tag, and how many hold a badge (earned/verified/
 *  certified) for it. One query each, cheap enough to compute per request. */
export async function getCapabilityCounts(): Promise<CapabilityCount[]> {
  const db = await getPool();
  const { rows } = await db.query<{ capability: string; agents: string; proven: string }>(
    `WITH declared AS (
       SELECT UNNEST(capabilities) AS capability, COUNT(*) AS agents
       FROM agent_executors
       GROUP BY 1
     ), badged AS (
       SELECT capability, COUNT(DISTINCT agent_address) AS proven
       FROM agent_badges
       WHERE expires_at IS NULL OR expires_at > NOW()
       GROUP BY 1
     )
     SELECT d.capability, d.agents, COALESCE(b.proven, 0) AS proven
     FROM declared d LEFT JOIN badged b USING (capability)`,
  );
  return rows.map((r) => ({ capability: r.capability, agents: Number(r.agents), proven: Number(r.proven) }));
}

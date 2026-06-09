import { getPool } from './neonDb.js';
import type { AgentExecutor, AgentCapability } from '../types.js';

const MAX_AGENTS = 1_000;

function rowToAgent(row: Record<string, unknown>): AgentExecutor {
  return {
    address: row.address as string,
    displayName: row.display_name as string,
    capabilities: (row.capabilities as AgentCapability[]) ?? [],
    publicKey: row.public_key as string,
    agentCardUrl: (row.agent_card_url as string) ?? undefined,
    mcpEndpointUrl: (row.mcp_endpoint_url as string) ?? undefined,
    minReward: (row.min_reward as string) ?? undefined,
    preferredCapabilities: (row.preferred_capabilities as AgentCapability[]) ?? undefined,
    reputation: (row.reputation as number) ?? 50,
    tasksCompleted: (row.tasks_completed as number) ?? 0,
    totalEarnedRaw: (row.total_earned_raw as string) ?? '0',
    registeredAt: (row.registered_at as string) ?? new Date().toISOString(),
  };
}

export async function registerAgent(agent: AgentExecutor): Promise<void> {
  const db = await getPool();
  const addr = agent.address.toLowerCase();

  // Size cap only for NEW registrations (re-registers skip the check)
  const { rows: existing } = await db.query<{ c: string }>(
    'SELECT address AS c FROM agent_executors WHERE address = $1',
    [addr],
  );
  if (existing.length === 0) {
    const { rows: count } = await db.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM agent_executors',
    );
    if (count[0].n >= MAX_AGENTS) {
      throw new Error('Agent registry full');
    }
  }

  await db.query(
    `INSERT INTO agent_executors
       (address, display_name, capabilities, public_key, agent_card_url,
        mcp_endpoint_url, min_reward, preferred_capabilities,
        reputation, tasks_completed, total_earned_raw, registered_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       COALESCE((SELECT registered_at FROM agent_executors WHERE address = $1), NOW()), NOW())
     ON CONFLICT (address) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       capabilities = EXCLUDED.capabilities,
       public_key = EXCLUDED.public_key,
       agent_card_url = EXCLUDED.agent_card_url,
       mcp_endpoint_url = EXCLUDED.mcp_endpoint_url,
       min_reward = EXCLUDED.min_reward,
       preferred_capabilities = EXCLUDED.preferred_capabilities,
       reputation = EXCLUDED.reputation,
       tasks_completed = EXCLUDED.tasks_completed,
       total_earned_raw = EXCLUDED.total_earned_raw,
       updated_at = NOW()`,
    [
      addr,
      agent.displayName,
      agent.capabilities,
      agent.publicKey,
      agent.agentCardUrl ?? null,
      agent.mcpEndpointUrl ?? null,
      agent.minReward ?? null,
      agent.preferredCapabilities ?? null,
      agent.reputation,
      agent.tasksCompleted,
      agent.totalEarnedRaw ?? '0',
    ],
  );
}

export async function getAgent(address: string): Promise<AgentExecutor | undefined> {
  const db = await getPool();
  const { rows } = await db.query<Record<string, unknown>>(
    'SELECT * FROM agent_executors WHERE address = $1',
    [address.toLowerCase()],
  );
  return rows[0] ? rowToAgent(rows[0]) : undefined;
}

/**
 * List all registered executors, optionally filtered by capability match
 * (superset: the agent's set must include ALL of the required caps).
 */
export async function listAgents(requiredCapabilities?: string[]): Promise<AgentExecutor[]> {
  const db = await getPool();
  let rows: Record<string, unknown>[];
  if (requiredCapabilities && requiredCapabilities.length > 0) {
    const { rows: r } = await db.query<Record<string, unknown>>(
      'SELECT * FROM agent_executors WHERE capabilities @> $1::TEXT[] ORDER BY registered_at DESC',
      [requiredCapabilities],
    );
    rows = r;
  } else {
    const { rows: r } = await db.query<Record<string, unknown>>(
      'SELECT * FROM agent_executors ORDER BY registered_at DESC',
    );
    rows = r;
  }
  return rows.map(rowToAgent);
}

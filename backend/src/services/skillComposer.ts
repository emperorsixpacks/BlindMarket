import type { DeployedAgent, InstalledSkill, AgentTool, ToolDefinition, AgentCapability } from '../types.js';
import type { AgentSkillRow } from './skillStore.js';

/**
 * Spawn-time composition of an agent's installed skills into the two env
 * surfaces the worker already consumes: AGENT_INSTRUCTIONS and AGENT_TOOLS.
 *
 * worker.js interpolates AGENT_INSTRUCTIONS verbatim into its system prompt
 * (worker.js ~1478) and builds AI-SDK tools from AGENT_TOOLS — so composing
 * HERE means zero worker changes, and an agent with no skills composes to an
 * exact passthrough (regression-safe by construction).
 */

// Size guards — enforced at INSTALL time (routes), never at spawn: a spawn-
// time failure would brick a previously-working agent.
export const MAX_SKILL_INSTRUCTIONS_BYTES = 16 * 1024;
export const MAX_SKILLS_PER_AGENT = 10;
export const MAX_COMPOSED_INSTRUCTIONS_BYTES = 96 * 1024;

export interface ComposedRuntime {
  instructions: string;
  tools: AgentTool[];
}

export function composeAgentRuntime(agent: DeployedAgent): ComposedRuntime {
  const skills = agent.skills ?? [];
  if (skills.length === 0) {
    // Exact passthrough — byte-identical to the pre-skills spawn path.
    return { instructions: agent.instructions, tools: agent.tools ?? [] };
  }

  const sections = skills.map(
    (s) => `[SKILL: ${s.name} v${s.version}]\n${s.instructions}`,
  );
  const instructions =
    agent.instructions +
    `\n\n[SKILLS]\nYou have ${skills.length} installed skill(s). Follow each skill's instructions whenever its domain applies to the current task.\n\n` +
    sections.join('\n\n');

  // Merge tools. AI-SDK ToolSet keys must be unique — on a name collision with
  // the agent's own tools (or an earlier skill), the skill tool is renamed
  // deterministically to `${slug}__${name}`.
  const tools: AgentTool[] = [...(agent.tools ?? [])];
  const taken = new Set(tools.map((t) => t.name));
  for (const skill of skills) {
    for (const def of skill.tools) {
      const name = taken.has(def.name) ? `${skill.slug}__${def.name}` : def.name;
      if (taken.has(name)) continue; // same skill installed twice defensively
      taken.add(name);
      // Worker routes on t.type === 'tool' for normalized definitions.
      tools.push({ ...def, name, type: 'tool' } as unknown as AgentTool);
    }
  }

  return { instructions, tools };
}

/** Union of all installed skills' secret_refs — feeds the secrets UI. */
export function collectSkillSecretRefs(skills: InstalledSkill[]): string[] {
  return [...new Set(skills.flatMap((s) => s.secretRefs))];
}

/**
 * Build the frozen snapshot stored on the agent from a registry row.
 * Server-side ONLY — clients send slugs, never snapshots, so nobody can forge
 * a snapshot claiming to be a reputable skill.
 */
export function buildInstalledSkill(row: AgentSkillRow): InstalledSkill {
  return {
    skillId: row.id,
    slug: row.slug,
    version: row.version,
    name: row.name,
    instructions: row.instructions,
    tools: (row.tools ?? []) as ToolDefinition[],
    secretRefs: (row.secret_refs ?? []).map((r) => (typeof r === 'string' ? r : r.secret_ref)),
    capabilities: (row.capabilities ?? []) as AgentCapability[],
    source: row.source,
    installedAt: new Date().toISOString(),
  };
}

/** Install-time guard: would adding these skills exceed the composed budget? */
export function assertComposedSizeOk(baseInstructions: string, skills: InstalledSkill[]): void {
  if (skills.length > MAX_SKILLS_PER_AGENT) {
    throw new Error(`An agent can have at most ${MAX_SKILLS_PER_AGENT} skills installed`);
  }
  for (const s of skills) {
    if (Buffer.byteLength(s.instructions, 'utf8') > MAX_SKILL_INSTRUCTIONS_BYTES) {
      throw new Error(`Skill "${s.slug}" exceeds the ${MAX_SKILL_INSTRUCTIONS_BYTES / 1024}KB instruction limit`);
    }
  }
  const composed = composeAgentRuntime({ instructions: baseInstructions, tools: [], skills } as unknown as DeployedAgent);
  if (Buffer.byteLength(composed.instructions, 'utf8') > MAX_COMPOSED_INSTRUCTIONS_BYTES) {
    throw new Error(`Composed instructions exceed the ${MAX_COMPOSED_INSTRUCTIONS_BYTES / 1024}KB budget — remove a skill or shorten the agent prompt`);
  }
}

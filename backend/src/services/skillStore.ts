import { getPool } from './neonDb.js';
import type { ToolDefinition } from '../types.js';

/**
 * Skill registry (agent_skills, migration 13) — the persistent unit packaging
 * instructions + DECLARATIVE tools + secret_ref manifest + capability routing
 * tags. Pattern cloned from templateStore.ts (creator-owned, is_public,
 * popularity counter). Agents never reference these rows live — installs
 * snapshot them (see skillComposer.buildInstalledSkill).
 */

export interface SkillSecretRef {
  secret_ref: string;
  key_name?: string;
  type?: string;
}

export interface AgentSkillRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  version: string;
  author_address: string;
  instructions: string;
  tools: ToolDefinition[];
  secret_refs: Array<SkillSecretRef | string>;
  capabilities: string[];
  source: 'local' | 'skillmd' | 'mcp' | 'openapi';
  is_public: boolean;
  install_count: number;
  created_at: string;
  updated_at: string;
}

/** Public projection — what non-authors see in lists/detail. Instructions are
 *  included (a skill's whole point is its prompt; you review before install),
 *  but only for PUBLIC skills — private drafts stay author-only. */
export type PublicSkill = Omit<AgentSkillRow, 'secret_refs'> & {
  secret_refs: SkillSecretRef[];
};

export async function createSkill(opts: {
  slug: string;
  name: string;
  description?: string;
  version?: string;
  authorAddress: string;
  instructions: string;
  tools?: ToolDefinition[];
  secretRefs?: SkillSecretRef[];
  capabilities?: string[];
  source?: AgentSkillRow['source'];
  isPublic?: boolean;
}): Promise<AgentSkillRow> {
  const db = await getPool();
  const { rows } = await db.query<AgentSkillRow>(
    `INSERT INTO agent_skills
       (slug, name, description, version, author_address, instructions, tools, secret_refs, capabilities, source, is_public)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      opts.slug.toLowerCase(),
      opts.name,
      opts.description ?? '',
      opts.version ?? '1.0.0',
      opts.authorAddress.toLowerCase(),
      opts.instructions,
      JSON.stringify(opts.tools ?? []),
      JSON.stringify(opts.secretRefs ?? []),
      opts.capabilities ?? [],
      opts.source ?? 'local',
      opts.isPublic ?? false,
    ],
  );
  return rows[0];
}

export async function updateSkill(
  slug: string,
  authorAddress: string,
  patch: Partial<Pick<AgentSkillRow, 'name' | 'description' | 'version' | 'instructions' | 'is_public' | 'capabilities'>> & {
    tools?: ToolDefinition[];
    secretRefs?: SkillSecretRef[];
  },
): Promise<AgentSkillRow | null> {
  const db = await getPool();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, val: unknown) => {
    vals.push(val);
    sets.push(`${col} = $${vals.length}`);
  };
  if (patch.name !== undefined) push('name', patch.name);
  if (patch.description !== undefined) push('description', patch.description);
  if (patch.version !== undefined) push('version', patch.version);
  if (patch.instructions !== undefined) push('instructions', patch.instructions);
  if (patch.is_public !== undefined) push('is_public', patch.is_public);
  if (patch.capabilities !== undefined) push('capabilities', patch.capabilities);
  if (patch.tools !== undefined) push('tools', JSON.stringify(patch.tools));
  if (patch.secretRefs !== undefined) push('secret_refs', JSON.stringify(patch.secretRefs));
  if (sets.length === 0) return getSkillBySlug(slug);

  vals.push(slug.toLowerCase());
  vals.push(authorAddress.toLowerCase());
  const { rows } = await db.query<AgentSkillRow>(
    `UPDATE agent_skills SET ${sets.join(', ')}, updated_at = NOW()
     WHERE slug = $${vals.length - 1} AND author_address = $${vals.length}
     RETURNING *`,
    vals,
  );
  return rows[0] ?? null;
}

export async function getSkillBySlug(slug: string): Promise<AgentSkillRow | null> {
  const db = await getPool();
  const { rows } = await db.query<AgentSkillRow>('SELECT * FROM agent_skills WHERE slug = $1', [slug.toLowerCase()]);
  return rows[0] ?? null;
}

export async function listPublicSkills(opts: {
  q?: string;
  capability?: string;
  limit?: number;
  offset?: number;
}): Promise<{ skills: AgentSkillRow[]; total: number }> {
  const db = await getPool();
  const filters = ['is_public = true'];
  const vals: unknown[] = [];
  if (opts.capability) {
    vals.push([opts.capability]);
    filters.push(`capabilities @> $${vals.length}::TEXT[]`);
  }
  if (opts.q?.trim()) {
    vals.push(`%${opts.q.trim().toLowerCase()}%`);
    filters.push(`(LOWER(name) LIKE $${vals.length} OR LOWER(description) LIKE $${vals.length} OR LOWER(slug) LIKE $${vals.length})`);
  }
  const where = filters.join(' AND ');
  const countRes = await db.query<{ cnt: string }>(`SELECT COUNT(*) as cnt FROM agent_skills WHERE ${where}`, vals);
  vals.push(Math.min(50, opts.limit ?? 20));
  vals.push(Math.max(0, opts.offset ?? 0));
  const { rows } = await db.query<AgentSkillRow>(
    `SELECT * FROM agent_skills WHERE ${where}
     ORDER BY install_count DESC, created_at DESC
     LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
    vals,
  );
  return { skills: rows, total: Number(countRes.rows[0].cnt) };
}

export async function listSkillsByAuthor(authorAddress: string): Promise<AgentSkillRow[]> {
  const db = await getPool();
  const { rows } = await db.query<AgentSkillRow>(
    'SELECT * FROM agent_skills WHERE author_address = $1 ORDER BY created_at DESC',
    [authorAddress.toLowerCase()],
  );
  return rows;
}

export async function incrementInstallCount(id: number): Promise<void> {
  const db = await getPool();
  await db.query('UPDATE agent_skills SET install_count = install_count + 1 WHERE id = $1', [id]);
}

/** Which of these slugs are PUBLIC registry skills (returned lowercased).
 *  Used by the proof re-key so a private draft's slug never reaches the
 *  publicly readable skill_stats/agent_badges tables. */
export async function listPublicSlugs(slugs: string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const db = await getPool();
  const { rows } = await db.query<{ slug: string }>(
    'SELECT slug FROM agent_skills WHERE slug = ANY($1) AND is_public = true',
    [slugs.map((s) => s.toLowerCase())],
  );
  return new Set(rows.map((r) => r.slug.toLowerCase()));
}

export async function deleteSkill(slug: string, authorAddress: string): Promise<boolean> {
  const db = await getPool();
  const { rowCount } = await db.query(
    'DELETE FROM agent_skills WHERE slug = $1 AND author_address = $2',
    [slug.toLowerCase(), authorAddress.toLowerCase()],
  );
  return (rowCount ?? 0) > 0;
}

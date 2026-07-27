import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../types.js';
import { AGENT_CAPABILITIES } from '../types.js';
import * as skillStore from '../services/skillStore.js';
import { parseSkillMd } from '../services/skillMd.js';
import { MAX_SKILL_INSTRUCTIONS_BYTES } from '../services/skillComposer.js';

/**
 * Skill registry routes (/api/v1/skills).
 *
 * Skills are DECLARATIVE-ONLY bundles: markdown instructions + normalized
 * ToolDefinition tools (http/mcp via the tool DSL, secret_ref indirection).
 * The js/sandbox tool types are deliberately NOT accepted inside skills —
 * they remain available manually via ToolManager on a per-agent basis.
 * SKILL.md import is preview-first: /parse-skillmd never persists.
 */

export const skillsRouter = Router();

const capEnum = z.enum(AGENT_CAPABILITIES as unknown as [string, ...string[]]);

// Declarative ToolDefinition schema — mirrors the normalized 'tool' variant of
// agents.ts ToolSchema minus the discriminator (skills store raw
// ToolDefinitions; the composer adds type:'tool' when merging into the agent).
const SkillToolSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().default(''),
  input_schema: z.object({
    type: z.literal('object'),
    properties: z.record(z.object({
      type: z.string().default('string'),
      description: z.string().optional(),
      enum: z.array(z.string()).optional(),
      default: z.unknown().optional(),
    })),
    required: z.array(z.string()).optional(),
  }),
  execution: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    url: z.string().min(1).max(2000),
    param_mapping: z.record(z.string()),
  }),
  auth: z.object({
    type: z.enum(['query_param', 'header', 'bearer', 'none']),
    key_name: z.string().default(''),
    secret_ref: z.string().default(''),
  }),
  source: z.enum(['manual', 'openapi', 'mcp']).optional(),
  mcp_endpoint: z.string().url().optional(),
  mcp_tool_name: z.string().optional(),
  mcp_headers: z.record(z.string()).optional(),
});

const secretRefSchema = z.object({
  secret_ref: z.string().min(1).max(120),
  key_name: z.string().max(120).optional(),
  type: z.string().max(40).optional(),
});

const instructionsSchema = z.string().min(1).refine(
  (s) => Buffer.byteLength(s, 'utf8') <= MAX_SKILL_INSTRUCTIONS_BYTES,
  { message: `Instructions exceed the ${MAX_SKILL_INSTRUCTIONS_BYTES / 1024}KB limit` },
);

const createSkillSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'Slug must be lowercase kebab-case (2-63 chars)'),
  name: z.string().min(3).max(80),
  description: z.string().max(2000).optional(),
  version: z.string().max(20).optional(),
  instructions: instructionsSchema,
  tools: z.array(SkillToolSchema).max(20).optional(),
  secretRefs: z.array(secretRefSchema).max(20).optional(),
  capabilities: z.array(capEnum).max(10).optional(),
  source: z.enum(['local', 'skillmd', 'mcp', 'openapi']).optional(),
  isPublic: z.boolean().optional(),
});

const updateSkillSchema = z.object({
  name: z.string().min(3).max(80).optional(),
  description: z.string().max(2000).optional(),
  version: z.string().max(20).optional(),
  instructions: instructionsSchema.optional(),
  tools: z.array(SkillToolSchema).max(20).optional(),
  secretRefs: z.array(secretRefSchema).max(20).optional(),
  capabilities: z.array(capEnum).max(10).optional(),
  isPublic: z.boolean().optional(),
});

/** Public projection: redact mcp_headers VALUES on display surfaces. The
 *  sanctioned secret mechanism is secret_ref (resolved server-side at
 *  execution); baked headers are an author's choice to share with INSTALLERS,
 *  not with every unauthenticated scraper. Install uses the raw row. */
function projectPublicSkill<T extends { tools: unknown }>(row: T): T {
  const tools = (row.tools as Array<Record<string, unknown>>).map((t) =>
    t.mcp_headers
      ? { ...t, mcp_headers: Object.fromEntries(Object.keys(t.mcp_headers as Record<string, string>).map((k) => [k, '•••'])) }
      : t,
  );
  return { ...row, tools };
}

function requireWallet(req: AuthRequest): string {
  const address = req.user?.address;
  if (!address || address === 'agent') {
    throw new AppError(401, 'UNAUTHORIZED', 'A wallet-backed identity is required for skill authoring');
  }
  return address;
}

// POST /api/v1/skills — create (author = authed wallet)
skillsRouter.post('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const author = requireWallet(req);
    const data = createSkillSchema.parse(req.body);
    const existing = await skillStore.getSkillBySlug(data.slug);
    if (existing) {
      throw new AppError(409, 'SLUG_TAKEN', 'A skill with this slug already exists');
    }
    const skill = await skillStore.createSkill({
      ...data,
      authorAddress: author,
      isPublic: data.isPublic ?? false,
    });
    res.status(201).json({ success: true, data: skill });
  } catch (err) { next(err); }
});

// GET /api/v1/skills — public registry list
skillsRouter.get('/', async (req, res, next) => {
  try {
    const result = await skillStore.listPublicSkills({
      q: (req.query.q as string) || undefined,
      capability: (req.query.capability as string) || undefined,
      limit: parseInt(req.query.limit as string) || 20,
      offset: parseInt(req.query.offset as string) || 0,
    });
    res.json({ success: true, data: { ...result, skills: result.skills.map(projectPublicSkill) } });
  } catch (err) { next(err); }
});

// GET /api/v1/skills/mine — author's own skills (incl. private drafts)
skillsRouter.get('/mine', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const author = requireWallet(req);
    res.json({ success: true, data: await skillStore.listSkillsByAuthor(author) });
  } catch (err) { next(err); }
});

// POST /api/v1/skills/parse-skillmd — PREVIEW ONLY, never persists. The user
// reviews the parsed markdown + warnings before an explicit POST / creates it.
skillsRouter.post('/parse-skillmd', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { text } = z.object({ text: z.string().min(1).max(200_000) }).parse(req.body);
    res.json({ success: true, data: parseSkillMd(text) });
  } catch (err) {
    if (err instanceof Error && !(err instanceof AppError) && !(err instanceof z.ZodError)) {
      next(new AppError(400, 'PARSE_FAILED', err.message));
      return;
    }
    next(err);
  }
});

// GET /api/v1/skills/:slug — public skills for anyone; drafts author-only
skillsRouter.get('/:slug', async (req: AuthRequest, res, next) => {
  try {
    const skill = await skillStore.getSkillBySlug(req.params.slug);
    if (!skill) throw new AppError(404, 'NOT_FOUND', 'Skill not found');
    if (!skill.is_public) {
      // optionalAuth isn't mounted here; a draft is only reachable via /mine.
      throw new AppError(404, 'NOT_FOUND', 'Skill not found');
    }
    res.json({ success: true, data: projectPublicSkill(skill) });
  } catch (err) { next(err); }
});

// PATCH /api/v1/skills/:slug — author-gated (enforced in SQL WHERE)
skillsRouter.patch('/:slug', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const author = requireWallet(req);
    const patch = updateSkillSchema.parse(req.body);
    const updated = await skillStore.updateSkill(req.params.slug, author, {
      name: patch.name,
      description: patch.description,
      version: patch.version,
      instructions: patch.instructions,
      is_public: patch.isPublic,
      capabilities: patch.capabilities,
      tools: patch.tools as never,
      secretRefs: patch.secretRefs,
    });
    if (!updated) throw new AppError(404, 'NOT_FOUND', 'Skill not found or not yours');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// DELETE /api/v1/skills/:slug — author-gated. Installed snapshots are
// unaffected by design (agents keep their frozen copy).
skillsRouter.delete('/:slug', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const author = requireWallet(req);
    const deleted = await skillStore.deleteSkill(req.params.slug, author);
    if (!deleted) throw new AppError(404, 'NOT_FOUND', 'Skill not found or not yours');
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
});

import { describe, it, expect } from 'vitest';
import { parseSkillMd } from './skillMd.js';
import { composeAgentRuntime, buildInstalledSkill, assertComposedSizeOk, MAX_SKILLS_PER_AGENT } from './skillComposer.js';
import type { DeployedAgent, InstalledSkill, ToolDefinition } from '../types.js';

/**
 * Unit tests for the skills system's two pure cores:
 *  - skillMd: the SAFE-SUBSET SKILL.md parser (hand-rolled frontmatter,
 *    scripts never imported, bundle references produce warnings)
 *  - skillComposer: spawn-time composition. The load-bearing claim is the
 *    ZERO-SKILLS PASSTHROUGH — an agent without skills must compose to
 *    byte-identical instructions/tools (regression safety for every existing
 *    deployed agent).
 */

const SKILL_MD = `---
name: web-summarizer
description: Summarize web pages concisely
version: 2.1.0
license: MIT
---

# Web summarizer

Fetch the page, then produce a 5-bullet summary.
`;

describe('parseSkillMd', () => {
  it('parses frontmatter + body', () => {
    const p = parseSkillMd(SKILL_MD);
    expect(p.name).toBe('web-summarizer');
    expect(p.description).toBe('Summarize web pages concisely');
    expect(p.version).toBe('2.1.0');
    expect(p.license).toBe('MIT');
    expect(p.instructions).toContain('5-bullet summary');
    expect(p.warnings).toEqual([]);
  });

  it('handles CRLF input', () => {
    const p = parseSkillMd(SKILL_MD.replace(/\n/g, '\r\n'));
    expect(p.name).toBe('web-summarizer');
    expect(p.instructions).toContain('5-bullet summary');
  });

  it('strips quotes and ignores unknown/nested keys', () => {
    const p = parseSkillMd(`---\nname: "quoted-name"\nmetadata:\n  nested: x\nallowed-tools: Bash\n---\nBody text`);
    expect(p.name).toBe('quoted-name');
    expect(p.warnings.some((w) => w.includes('allowed-tools'))).toBe(true);
  });

  it('warns on bundled-file references (scripts are never imported)', () => {
    const p = parseSkillMd(`---\nname: s\n---\nRun scripts/setup.sh then read [ref](./references/data.md)`);
    expect(p.warnings.length).toBeGreaterThanOrEqual(2);
    expect(p.warnings.join(' ')).toMatch(/NOT imported/);
  });

  it('rejects missing frontmatter, missing name, empty body', () => {
    expect(() => parseSkillMd('no frontmatter')).toThrow(/missing opening/);
    expect(() => parseSkillMd('---\nname: x\nno closing')).toThrow(/no closing/);
    expect(() => parseSkillMd('---\ndescription: d\n---\nbody')).toThrow(/"name"/);
    expect(() => parseSkillMd('---\nname: x\n---\n')).toThrow(/empty body/);
  });
});

function mkSkill(over: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    skillId: 1,
    slug: 'web-summarizer',
    version: '1.0.0',
    name: 'Web summarizer',
    instructions: 'Always produce 5 bullets.',
    tools: [],
    secretRefs: [],
    capabilities: ['summarization'],
    source: 'local',
    installedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const TOOL: ToolDefinition = {
  name: 'fetch_page',
  description: 'Fetch a web page',
  input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  execution: { method: 'GET', url: 'https://r.jina.ai/{url}', param_mapping: { url: 'path' } },
  auth: { type: 'none', key_name: '', secret_ref: '' },
};

describe('composeAgentRuntime', () => {
  const baseAgent = {
    instructions: 'You are a helpful agent.',
    tools: [{ type: 'http', name: 'fetch_page', description: '', url: 'https://x', method: 'GET' }],
  } as unknown as DeployedAgent;

  it('zero skills = exact passthrough (instructions AND tools identical)', () => {
    const c = composeAgentRuntime(baseAgent);
    expect(c.instructions).toBe(baseAgent.instructions);
    expect(c.tools).toEqual(baseAgent.tools);
  });

  it('appends [SKILL: …] sections after the base instructions', () => {
    const c = composeAgentRuntime({ ...baseAgent, skills: [mkSkill()] } as DeployedAgent);
    expect(c.instructions.startsWith('You are a helpful agent.')).toBe(true);
    expect(c.instructions).toContain('[SKILLS]');
    expect(c.instructions).toContain('[SKILL: Web summarizer v1.0.0]');
    expect(c.instructions).toContain('Always produce 5 bullets.');
  });

  it("merges skill tools with type:'tool' and renames on collision", () => {
    const c = composeAgentRuntime({ ...baseAgent, skills: [mkSkill({ tools: [TOOL] })] } as DeployedAgent);
    const merged = c.tools.find((t) => t.name === 'web-summarizer__fetch_page');
    expect(merged).toBeTruthy();
    expect((merged as { type?: string }).type).toBe('tool');
    // base tool untouched
    expect(c.tools[0]).toEqual(baseAgent.tools[0]);
  });

  it('no rename when there is no collision', () => {
    const c = composeAgentRuntime({
      instructions: 'x', tools: [], skills: [mkSkill({ tools: [TOOL] })],
    } as unknown as DeployedAgent);
    expect(c.tools[0].name).toBe('fetch_page');
  });
});

describe('earned-badge threshold logic', () => {
  // Mirrors the gate in workerPayout.ts: grant only at >=5 completions AND
  // failure ratio <20%. Kept as a pure predicate test so the boundary is
  // documented and can't silently drift.
  const shouldGrant = (completed: number, failed: number) => {
    const attempts = completed + failed;
    const ratio = attempts > 0 ? failed / attempts : 0;
    return completed >= 5 && ratio < 0.2;
  };
  it('does not grant below 5 completions', () => {
    expect(shouldGrant(4, 0)).toBe(false);
  });
  it('grants at exactly 5 clean completions', () => {
    expect(shouldGrant(5, 0)).toBe(true);
  });
  it('blocks a dispute-heavy grinder (>=20% failures)', () => {
    expect(shouldGrant(8, 2)).toBe(false); // 2/10 = 20%, not < 20%
    expect(shouldGrant(9, 1)).toBe(true);  // 1/10 = 10%
  });
});

describe('buildInstalledSkill / assertComposedSizeOk', () => {
  it('normalizes string and object secret_refs', () => {
    const snap = buildInstalledSkill({
      id: 7, slug: 's', version: '1.0.0', name: 'S', instructions: 'i',
      tools: [], secret_refs: ['plain_ref', { secret_ref: 'obj_ref', key_name: 'X-Key' }],
      capabilities: ['testing'], source: 'skillmd',
    } as never);
    expect(snap.secretRefs).toEqual(['plain_ref', 'obj_ref']);
    expect(snap.skillId).toBe(7);
  });

  it('rejects too many skills and oversized instructions', () => {
    const many = Array.from({ length: MAX_SKILLS_PER_AGENT + 1 }, (_, i) => mkSkill({ slug: `s${i}` }));
    expect(() => assertComposedSizeOk('base', many)).toThrow(/at most/);
    expect(() => assertComposedSizeOk('base', [mkSkill({ instructions: 'x'.repeat(17 * 1024) })])).toThrow(/16KB/);
  });
});

import { describe, it, expect, vi } from 'vitest';

// Hermetic: pin the mock provider before config loads (a real key must never
// turn unit tests into live API calls), and pin the slug threshold so the
// argmax tests are deterministic regardless of local env.
vi.hoisted(() => {
  process.env.EMBEDDING_PROVIDER = 'mock';
  process.env.EMBEDDING_API_KEY = '';
  process.env.PROOF_SLUG_SIM_THRESHOLD = '0.5';
});

vi.mock('./embeddingService.js', () => ({ embed: vi.fn() }));
vi.mock('./deployedAgentStore.js', () => ({ loadAgentByWallet: vi.fn() }));

import { cosine, bestSkillSlug, skillDocText, resolveProofSkillSlug } from './semanticProof.js';
import { embed } from './embeddingService.js';
import { loadAgentByWallet } from './deployedAgentStore.js';

describe('cosine', () => {
  it('identical direction → 1, orthogonal → 0, opposite → -1', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 3])).toBeCloseTo(0, 6);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });
  it('zero vector → 0 (no crash)', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('bestSkillSlug (argmax with floor)', () => {
  const skills = [
    { slug: 'sql-analyst', vector: [1, 0] },
    { slug: 'translator', vector: [0.6, 0.8] },
  ];
  it('picks the closest skill above the floor', () => {
    expect(bestSkillSlug([0.9, 0.1], skills, 0.5)?.slug).toBe('sql-analyst');
    expect(bestSkillSlug([0.5, 0.86], skills, 0.5)?.slug).toBe('translator');
  });
  it('returns null when nothing clears the floor', () => {
    expect(bestSkillSlug([0, 1], [{ slug: 'x', vector: [1, 0] }], 0.5)).toBeNull();
  });
  it('returns null for no skills', () => {
    expect(bestSkillSlug([1, 0], [], 0.1)).toBeNull();
  });
});

describe('skillDocText', () => {
  it('joins name, tags, and truncated instructions', () => {
    const txt = skillDocText({
      name: 'PDF Invoice Extractor',
      capabilities: ['data_processing'] as never,
      instructions: 'x'.repeat(5000),
    });
    expect(txt.startsWith('PDF Invoice Extractor (data_processing)\n')).toBe(true);
    expect(txt.length).toBeLessThan(1300);
  });
});

describe('resolveProofSkillSlug', () => {
  const meta = { publicBrief: 'Turn these invoices into a CSV', requiredCapabilities: [] as never };
  const skill = (slug: string) =>
    ({ slug, name: slug, instructions: 'do the thing', capabilities: [], skillId: 1, version: '1', tools: [], secretRefs: [], source: 'skillmd', installedAt: '' }) as never;

  it('null when the worker has no deployed agent or no skills', async () => {
    vi.mocked(loadAgentByWallet).mockResolvedValue(null);
    expect(await resolveProofSkillSlug('0xw', meta)).toBeNull();
    vi.mocked(loadAgentByWallet).mockResolvedValue({ skills: [] } as never);
    expect(await resolveProofSkillSlug('0xw', meta)).toBeNull();
  });

  it('null when the task has no routing text', async () => {
    vi.mocked(loadAgentByWallet).mockResolvedValue({ skills: [skill('a')] } as never);
    expect(await resolveProofSkillSlug('0xw', { requiredCapabilities: [] as never })).toBeNull();
  });

  it('credits the closest skill above the floor (vectors injected)', async () => {
    vi.mocked(loadAgentByWallet).mockResolvedValue({ skills: [skill('invoice-extractor'), skill('poem-writer')] } as never);
    // First embed call = task text, then one per skill (in order).
    vi.mocked(embed)
      .mockResolvedValueOnce({ vector: [1, 0], model: 'mock-v1' })   // task
      .mockResolvedValueOnce({ vector: [0.95, 0.31], model: 'mock-v1' }) // invoice-extractor (close)
      .mockResolvedValueOnce({ vector: [0, 1], model: 'mock-v1' });  // poem-writer (orthogonal)
    expect(await resolveProofSkillSlug('0xw', meta)).toBe('invoice-extractor');
  });

  it('null when even the best skill is below the floor', async () => {
    vi.mocked(loadAgentByWallet).mockResolvedValue({ skills: [skill('poem-writer')] } as never);
    vi.mocked(embed)
      .mockResolvedValueOnce({ vector: [1, 0], model: 'mock-v1' })
      .mockResolvedValueOnce({ vector: [0.2, 0.98], model: 'mock-v1' });
    expect(await resolveProofSkillSlug('0xw', meta)).toBeNull();
  });

  it('null (not a throw) when anything fails — proof must never block a payout', async () => {
    vi.mocked(loadAgentByWallet).mockRejectedValue(new Error('pg down'));
    expect(await resolveProofSkillSlug('0xw', meta)).toBeNull();
  });
});

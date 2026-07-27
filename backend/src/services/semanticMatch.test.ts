import { describe, it, expect, vi } from 'vitest';

// semanticMatch imports neonDb/agentScorer at module load; the functions under
// test here are pure, so leaf stubs are enough (same pattern as the
// projection tests).
vi.mock('./neonDb.js', () => ({ getPool: vi.fn() }));
vi.mock('./agentScorer.js', () => ({ rankAgents: vi.fn() }));
vi.mock('./embeddingService.js', () => ({
  embed: vi.fn(),
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
  embeddingModelId: () => 'mock-v1',
}));

import { buildTaskRoutingText, computeShadowMetrics, type ShadowRow } from './semanticMatch.js';

describe('buildTaskRoutingText (source precedence)', () => {
  it('prefers publicBrief over everything', () => {
    expect(buildTaskRoutingText({
      publicBrief: 'Mint a dragon NFT',
      routingSummary: 'nft stuff',
      requiredCapabilities: ['content_generation'] as never,
    })).toBe('Mint a dragon NFT');
  });

  it('falls back to routingSummary for private tasks', () => {
    expect(buildTaskRoutingText({
      routingSummary: 'Need SQL from English',
      requiredCapabilities: ['data_processing'] as never,
    })).toBe('Need SQL from English');
  });

  it('falls back to capability tags as last resort', () => {
    expect(buildTaskRoutingText({ requiredCapabilities: ['testing', 'code_review'] as never }))
      .toBe('Task requiring: testing, code_review');
  });

  it('returns empty when there is no public signal at all (no shadow row)', () => {
    expect(buildTaskRoutingText({ requiredCapabilities: [] as never })).toBe('');
  });
});

describe('computeShadowMetrics (the loop success gate)', () => {
  const row = (semRank: number | null, tagRank: number | null, settled = true): ShadowRow => {
    const acceptor = '0xwinner';
    const filler = (n: number) => Array.from({ length: n }, (_, i) => ({ address: `0xother${i}` }));
    const mk = (rank: number | null) =>
      rank === null ? filler(5) : [...filler(rank - 1), { address: acceptor }, ...filler(5 - rank)];
    return { semantic_topk: mk(semRank), tag_topk: mk(tagRank), accepted_by: acceptor, settled };
  };

  it('scores hit@1 / hit@3 / MRR per ranking', () => {
    const m = computeShadowMetrics([
      row(1, 3),  // semantic nailed it; tag ranked it 3rd
      row(2, 1),  // tag nailed it; semantic 2nd
      row(1, null), // semantic 1st; tag missed entirely
    ]);
    expect(m.tasks).toBe(3);
    expect(m.semantic.hit1).toBeCloseTo(2 / 3, 3);
    expect(m.semantic.hit3).toBe(1);
    expect(m.semantic.mrr).toBeCloseTo((1 + 0.5 + 1) / 3, 2);
    expect(m.tag.hit1).toBeCloseTo(1 / 3, 3);
    expect(m.tag.mrr).toBeCloseTo((1 / 3 + 1 + 0) / 3, 2);
  });

  it('ignores rows with no known acceptor and counts settled', () => {
    const noAcceptor: ShadowRow = { semantic_topk: [], tag_topk: [], accepted_by: null, settled: null };
    const m = computeShadowMetrics([noAcceptor, row(1, 1, true), row(1, 1, false)]);
    expect(m.tasks).toBe(2);
    expect(m.settledTasks).toBe(1);
  });

  it('is case-insensitive on addresses', () => {
    const m = computeShadowMetrics([{
      semantic_topk: [{ address: '0xWINNER' }],
      tag_topk: [],
      accepted_by: '0xwinner',
      settled: true,
    }]);
    expect(m.semantic.hit1).toBe(1);
  });
});

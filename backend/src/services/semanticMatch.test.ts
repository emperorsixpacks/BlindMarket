import { describe, it, expect, vi } from 'vitest';

// Hermetic: pin the mock provider BEFORE config loads so rerankCandidates
// takes its passthrough path and never calls the live Voyage API — a
// developer's real EMBEDDING_API_KEY must not turn a unit test into a network
// call. dotenv never overrides pre-set process.env, so this wins.
vi.hoisted(() => {
  process.env.EMBEDDING_PROVIDER = 'mock';
  process.env.EMBEDDING_API_KEY = '';
});

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

import { buildTaskRoutingText, computeShadowMetrics, rerankCandidates, type ShadowRow } from './semanticMatch.js';

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

describe('rerankCandidates (mock passthrough)', () => {
  const cands = [
    { address: '0xa', displayName: 'A', similarity: 0.7 },
    { address: '0xb', displayName: 'B', similarity: 0.69 },
  ];
  it('preserves KNN order and shape when no real reranker is configured', async () => {
    // embeddingService is mocked here → mock path → identity passthrough.
    const out = await rerankCandidates('q', cands, new Map([['0xa', 'docA'], ['0xb', 'docB']]));
    expect(out.map((c) => c.address)).toEqual(['0xa', '0xb']);
    expect(out.every((c) => typeof c.rerankScore === 'number')).toBe(true);
  });
  it('returns [] for no candidates', async () => {
    expect(await rerankCandidates('q', [], new Map())).toEqual([]);
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
    // No rerank list present → semanticRerank mirrors semantic (back-compat).
    expect(m.semanticRerank).toEqual(m.semantic);
  });

  it('uses semantic_rerank_topk when present, else falls back to semantic', () => {
    const acceptor = '0xwinner';
    const filler = (n: number) => Array.from({ length: n }, (_, i) => ({ address: `0xo${i}` }));
    const withRerank: ShadowRow = {
      semantic_topk: [...filler(2), { address: acceptor }],       // semantic: rank 3
      semantic_rerank_topk: [{ address: acceptor }, ...filler(2)], // rerank promotes to rank 1
      tag_topk: [],
      accepted_by: acceptor,
      settled: true,
    };
    const m = computeShadowMetrics([withRerank]);
    expect(m.semantic.hit1).toBe(0);       // semantic had it at rank 3
    expect(m.semanticRerank.hit1).toBe(1); // rerank fixed it
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

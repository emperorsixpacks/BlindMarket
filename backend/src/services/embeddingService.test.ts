import { describe, it, expect, vi } from 'vitest';

// Hermetic: force the mock provider BEFORE config loads, regardless of the
// developer's .env (a real EMBEDDING_API_KEY would otherwise flip these tests
// into live-API mode — unit tests must never make network calls). dotenv
// never overrides pre-set process.env, so this wins.
vi.hoisted(() => {
  process.env.EMBEDDING_PROVIDER = 'mock';
  process.env.EMBEDDING_API_KEY = '';
});

import { embed, embedMany, toVectorLiteral, embeddingModelId, embeddingsConfigured } from './embeddingService.js';
import { config } from '../config.js';

/**
 * Unit tests for the mock-embedding path — the default until a real
 * EMBEDDING_API_KEY is set. The load-bearing properties the whole Phase-0
 * pipeline relies on: correct dimension, determinism (idempotent recompute),
 * and L2-normalization (so pgvector cosine distance is well-behaved).
 */

describe('embeddingService (mock provider)', () => {
  it('defaults to the mock provider with no key', () => {
    expect(config.embeddingProvider).toBe('mock');
    expect(embeddingsConfigured()).toBe(false);
    expect(embeddingModelId()).toBe('mock-v1');
  });

  it('produces vectors of exactly EMBEDDING_DIM', async () => {
    const { vector } = await embed('summarize this web page');
    expect(vector.length).toBe(config.embeddingDim);
  });

  it('is deterministic — same text yields the same vector', async () => {
    const a = (await embed('code review agent')).vector;
    const b = (await embed('code review agent')).vector;
    expect(a).toEqual(b);
  });

  it('different text yields a different vector', async () => {
    const a = (await embed('mint an NFT')).vector;
    const b = (await embed('write an Afrobeats song')).vector;
    expect(a).not.toEqual(b);
  });

  it('vectors are L2-normalized (unit length)', async () => {
    const { vector } = await embed('skincare routine for dry skin');
    const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('embedMany matches per-item embed and tags the model', async () => {
    const texts = ['a', 'b', 'c'];
    const { vectors, model } = await embedMany(texts);
    expect(vectors.length).toBe(3);
    expect(model).toBe('mock-v1');
    expect(vectors[0]).toEqual((await embed('a')).vector);
    expect(await embedMany([])).toEqual({ vectors: [], model: 'mock-v1' });
  });

  it('renders a pgvector literal', () => {
    expect(toVectorLiteral([0.1, 0.2, -0.3])).toBe('[0.1,0.2,-0.3]');
  });
});

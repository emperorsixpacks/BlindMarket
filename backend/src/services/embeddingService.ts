import { createHash } from 'crypto';
import { config } from '../config.js';

/**
 * Provider-abstracted embedding service for semantic matching.
 *
 * Default provider is 'mock' (deterministic hash vectors) so the entire
 * pipeline — migrations, agent/task embedding, KNN queries — builds, tests, and
 * runs locally WITHOUT any API key. Set EMBEDDING_PROVIDER=voyage|openai and
 * EMBEDDING_API_KEY to switch on real embeddings; nothing else changes.
 *
 * Every vector is normalized to config.embeddingDim so the pgvector column
 * dimension (migration 17) stays stable across a provider/model A/B.
 *
 * SECURITY: only ever call this with PUBLIC text (agent skills, publicBrief, a
 * poster's routingSummary). The sealed private brief must never be embedded via
 * an external provider — that would break the platform-blind invariant.
 */

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
}

const DIM = () => config.embeddingDim;

/** True when a real provider + key are configured (else we're on the mock path). */
export function embeddingsConfigured(): boolean {
  return config.embeddingProvider !== 'mock' && !!config.embeddingApiKey;
}

export function embeddingModelId(): string {
  return config.embeddingProvider === 'mock' ? 'mock-v1' : config.embeddingModel;
}

/**
 * Deterministic pseudo-embedding: hash the text into a fixed-dim unit vector.
 * Not semantically meaningful — it only lets the plumbing (storage, KNN,
 * shadow logging) be exercised end-to-end before a real key exists. Same text
 * → same vector, so idempotent recompute is testable.
 */
function mockEmbed(text: string): number[] {
  const dim = DIM();
  const out = new Array<number>(dim);
  // Expand a SHA-256 stream to `dim` bytes by hashing (text || counter).
  let filled = 0;
  let counter = 0;
  while (filled < dim) {
    const h = createHash('sha256').update(`${text}#${counter++}`).digest();
    for (let i = 0; i < h.length && filled < dim; i++) {
      out[filled++] = (h[i] - 127.5) / 127.5; // → [-1, 1)
    }
  }
  // L2-normalize so cosine distance behaves.
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

async function voyageEmbed(texts: string[]): Promise<number[][]> {
  // Voyage REST API (https://docs.voyageai.com). No SDK dependency needed.
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.embeddingApiKey}`,
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      input: texts,
      output_dimension: config.embeddingDim,
      input_type: 'document',
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

async function openaiEmbed(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.embeddingApiKey}`,
    },
    body: JSON.stringify({
      model: config.embeddingModel, // e.g. text-embedding-3-large
      input: texts,
      dimensions: config.embeddingDim, // Matryoshka truncation to the fixed dim
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

export async function embedMany(texts: string[]): Promise<EmbeddingResult> {
  if (texts.length === 0) return { vectors: [], model: embeddingModelId() };
  const provider = config.embeddingProvider;
  if (provider === 'mock' || !config.embeddingApiKey) {
    return { vectors: texts.map(mockEmbed), model: 'mock-v1' };
  }
  const vectors = provider === 'voyage' ? await voyageEmbed(texts) : await openaiEmbed(texts);
  // Defend the invariant the pgvector column depends on.
  for (const v of vectors) {
    if (v.length !== config.embeddingDim) {
      throw new Error(`Embedding dim mismatch: got ${v.length}, expected ${config.embeddingDim} (check EMBEDDING_DIM vs model)`);
    }
  }
  return { vectors, model: config.embeddingModel };
}

export async function embed(text: string): Promise<{ vector: number[]; model: string }> {
  const { vectors, model } = await embedMany([text]);
  return { vector: vectors[0], model };
}

/** pgvector literal — a bracketed comma list, e.g. "[0.1,0.2,…]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

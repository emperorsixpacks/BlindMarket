/**
 * One-off: populate agent_executors.embedding for every registered executor.
 * Idempotent — skips rows already embedded with the active model unless --force.
 *
 * Usage:
 *   DATABASE_URL=… [EMBEDDING_PROVIDER=voyage EMBEDDING_API_KEY=…] \
 *     npx tsx scripts/backfill-agent-embeddings.ts [--force]
 *
 * With no embedding provider set it runs on the deterministic mock provider,
 * which is enough to exercise the KNN plumbing locally before a real key exists.
 */
import { backfillAgentEmbeddings } from '../src/services/agentEmbedding.js';
import { embeddingsConfigured, embeddingModelId } from '../src/services/embeddingService.js';

async function main() {
  const force = process.argv.includes('--force');
  console.log(
    `[backfill] provider=${embeddingModelId()} (${embeddingsConfigured() ? 'REAL' : 'MOCK'})${force ? ' force' : ''}`,
  );
  const { updated, skipped } = await backfillAgentEmbeddings({ force });
  console.log(`[backfill] done — updated=${updated} skipped=${skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[backfill] failed:', e);
  process.exit(1);
});

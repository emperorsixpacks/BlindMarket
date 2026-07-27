/**
 * Semantic-matching evaluation bench.
 *
 * A LABELED offline harness: seed a realistic agent population into a local
 * pgvector Postgres, embed them (real Voyage), then run a curated task set
 * whose correct agent we KNOW, and score how well KNN — and KNN + rerank —
 * predict the right agent (hit@1 / hit@3 / MRR). This is the tuning loop run
 * against ground truth instead of noisy production acceptance, so we can pick
 * the embedding model, rerank on/off, K, and doc composition BEFORE flipping
 * any routing behavior.
 *
 * Usage (throwaway Docker pgvector — the runner refuses non-local DATABASE_URL
 * because it wipes agent_executors):
 *   DATABASE_URL=postgres://postgres:bb@localhost:5433/blindmarket?sslmode=disable \
 *   EMBEDDING_PROVIDER=voyage EMBEDDING_API_KEY=… [RERANK_ENABLED=true] \
 *   npx tsx eval/run.ts
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../src/config.js';
import { getPool } from '../src/services/neonDb.js';
import { embedMany, toVectorLiteral, embeddingModelId, embeddingsConfigured } from '../src/services/embeddingService.js';
import { semanticCandidates, rerankCandidates, buildTaskRoutingText } from '../src/services/semanticMatch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
type EvalAgent = { name: string; capabilities: string[]; instructions: string; skills: { name: string; instructions: string }[] };
type EvalTask = { id: string; text: string; expected: string[] };

const agents: EvalAgent[] = JSON.parse(readFileSync(join(HERE, 'agents.json'), 'utf8'));
const tasks: EvalTask[] = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'));

/** The doc composition under test — mirror agentEmbedding.buildAgentDoc. */
function agentDoc(a: EvalAgent): string {
  const parts = [a.name, a.instructions];
  for (const s of a.skills) parts.push(`Skill: ${s.name}. ${s.instructions}`);
  parts.push(`Capabilities: ${a.capabilities.join(', ')}`);
  return parts.join('\n\n');
}

/** Deterministic 0x address per agent index so re-runs are stable. */
const addrOf = (i: number) => '0xe7a1' + String(i).padStart(36, '0');

function assertLocal(url: string) {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error(`Refusing to run: DATABASE_URL is not local (${url.replace(/:[^:@]*@/, ':***@')}). This harness WIPES agent_executors.`);
  }
}

async function main() {
  assertLocal(config.databaseUrl);
  if (!embeddingsConfigured()) {
    console.error('Refusing to run on MOCK embeddings — set EMBEDDING_PROVIDER=voyage + EMBEDDING_API_KEY. Mock vectors make the eval meaningless.');
    process.exit(1);
  }
  const db = await getPool();
  const model = embeddingModelId();
  console.log(`eval bench — embed=${model} rerank=${config.rerankEnabled ? config.rerankModel : 'OFF'} agents=${agents.length} tasks=${tasks.length}`);

  // Seed: wipe + insert the eval agents with real embeddings.
  await db.query('DELETE FROM agent_executors');
  const docs = agents.map(agentDoc);
  const { vectors } = await embedMany(docs);
  const docByAddress = new Map<string, string>();
  for (let i = 0; i < agents.length; i++) {
    const addr = addrOf(i);
    docByAddress.set(addr, docs[i]);
    await db.query(
      `INSERT INTO agent_executors (address, display_name, capabilities, public_key, embedding, embedding_model, embedding_updated_at)
       VALUES ($1, $2, $3, '04ab', $4::vector, $5, NOW())`,
      [addr, agents[i].name, agents[i].capabilities, toVectorLiteral(vectors[i]), model],
    );
  }
  const nameByAddress = new Map(agents.map((a, i) => [addrOf(i), a.name]));

  // Score.
  type Row = { id: string; expected: string[]; semRank: number; rrRank: number; semTop: string; rrTop: string };
  const rows: Row[] = [];
  const rankOfExpected = (ranked: string[], expected: string[]) => {
    let best = 0;
    for (const e of expected) {
      const r = ranked.indexOf(e) + 1;
      if (r > 0 && (best === 0 || r < best)) best = r;
    }
    return best;
  };

  for (const task of tasks) {
    const qText = buildTaskRoutingText({ publicBrief: task.text, requiredCapabilities: [] as never });
    const { vectors: [qv] } = await embedMany([qText]);
    const knn = await semanticCandidates(qv, 10);
    const semNames = knn.map((c) => nameByAddress.get(c.address.toLowerCase()) ?? c.displayName);

    let rrNames = semNames;
    if (config.rerankEnabled) {
      const reranked = await rerankCandidates(qText, knn, docByAddress);
      rrNames = reranked.map((c) => nameByAddress.get(c.address.toLowerCase()) ?? c.displayName);
    }
    rows.push({
      id: task.id, expected: task.expected,
      semRank: rankOfExpected(semNames, task.expected),
      rrRank: rankOfExpected(rrNames, task.expected),
      semTop: semNames[0] ?? '—', rrTop: rrNames[0] ?? '—',
    });
  }

  const metric = (pick: (r: Row) => number) => {
    let h1 = 0, h3 = 0, rr = 0;
    for (const r of rows) {
      const rank = pick(r);
      if (rank === 1) h1++;
      if (rank >= 1 && rank <= 3) h3++;
      if (rank > 0) rr += 1 / rank;
    }
    const n = rows.length;
    return { hit1: h1 / n, hit3: h3 / n, mrr: rr / n };
  };
  const sem = metric((r) => r.semRank);
  const pct = (x: number) => (x * 100).toFixed(1) + '%';

  console.log('\n── Results ' + '─'.repeat(40));
  console.log(`semantic         hit@1=${pct(sem.hit1)}  hit@3=${pct(sem.hit3)}  MRR=${sem.mrr.toFixed(3)}`);
  if (config.rerankEnabled) {
    const rr = metric((r) => r.rrRank);
    console.log(`semantic+rerank  hit@1=${pct(rr.hit1)}  hit@3=${pct(rr.hit3)}  MRR=${rr.mrr.toFixed(3)}`);
    console.log(`Δ hit@1 ${(rr.hit1 - sem.hit1 >= 0 ? '+' : '') + pct(rr.hit1 - sem.hit1)}   Δ MRR ${(rr.mrr - sem.mrr >= 0 ? '+' : '') + (rr.mrr - sem.mrr).toFixed(3)}`);
  }

  const misses = rows.filter((r) => (config.rerankEnabled ? r.rrRank : r.semRank) !== 1);
  if (misses.length) {
    console.log(`\n── Misses (${misses.length}/${rows.length} not top-1) ` + '─'.repeat(20));
    for (const m of misses) {
      const top = config.rerankEnabled ? m.rrTop : m.semTop;
      const rank = config.rerankEnabled ? m.rrRank : m.semRank;
      console.log(`  ${m.id}: want ${m.expected.join('/')} — got "${top}" (correct at rank ${rank || '>10'})`);
    }
  }
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error('eval failed:', (e as Error).message); process.exit(1); });

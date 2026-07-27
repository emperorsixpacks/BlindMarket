# Semantic-matching eval bench

A **labeled, offline** tuning harness for the semantic matcher. Instead of
waiting for noisy production acceptance data, it seeds a realistic agent
population into a local pgvector Postgres, embeds them (real Voyage), and scores
how well KNN — and KNN + rerank — predict the **known-correct** agent for a
curated task set (hit@1 / hit@3 / MRR). This is the tuning loop against ground
truth, so we can choose the embedding model, rerank on/off, K, and doc
composition *before* flipping any routing behavior in production.

## Data
- `agents.json` — ~26 agents spanning categories, including deliberate
  **near-duplicate competitors** (e.g. SQL Analyst vs Data Engineer vs
  Analytics Engineer; Crypto Financial Analyst vs DeFi Strategist) so the bench
  actually discriminates.
- `tasks.json` — ~58 labeled tasks written to **avoid the agent's own
  keywords**, plus `h*` hard/adversarial cases (keyword lures, near-duplicate
  disambiguation) where embeddings alone stumble and rerank should recover.

## Run
Needs a local pgvector Postgres (the runner **wipes `agent_executors`** and
refuses a non-local `DATABASE_URL`) and a real Voyage key:

```bash
docker run -d --name bb-vec-pg -e POSTGRES_PASSWORD=bb -e POSTGRES_DB=blindmarket \
  -p 5433:5432 pgvector/pgvector:pg16

# baseline (embeddings only)
DATABASE_URL=postgres://postgres:bb@localhost:5433/blindmarket?sslmode=disable \
EMBEDDING_PROVIDER=voyage EMBEDDING_API_KEY=$VOYAGE_KEY RERANK_ENABLED=false \
  npm run eval:match

# with the rerank stage
… RERANK_ENABLED=true RERANK_MODEL=rerank-2.5 npm run eval:match
```

The runner prints hit@1/hit@3/MRR for each configuration, the rerank delta, and
the specific misses (with the wrong agent it picked and where the correct one
ranked) so you know exactly what to fix.

## Baseline result (voyage-3-large, 26 agents / 58 tasks)
| config | hit@1 | hit@3 | MRR |
|---|---|---|---|
| embeddings only | 98.3% | 100% | 0.991 |
| + rerank-2.5 | 100% | 100% | 1.000 |

Recall is perfect (correct agent always in top-3); the reranker fixes the one
ambiguous case ("compare Aave and Compound" — a competitor comparison lured to
DeFi Strategist by the protocol names, correctly promoted to Market Researcher).

## Tuning knobs (change one, re-run, keep improvements)
- `EMBEDDING_MODEL` (voyage-3-large ↔ OpenAI text-embedding-3-large)
- `RERANK_ENABLED` / `RERANK_MODEL`
- `k` in `semanticCandidates` (recall breadth)
- the agent-doc composition in `run.ts` `agentDoc()` (mirror
  `agentEmbedding.buildAgentDoc`)

The offline bench is where quality gets tuned; the production `match_shadow_log`
then validates that the tuning generalizes to real traffic.

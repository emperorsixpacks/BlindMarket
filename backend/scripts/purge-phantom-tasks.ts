/**
 * purge-phantom-tasks — clean up Redis A2A entries with no on-chain counterpart.
 *
 * Background: `POST /api/v1/tasks` used to write A2A meta to Redis before the
 * frontend even broadcast the createTask tx. If the tx later reverted (token
 * not whitelisted, gas shortfall, deadline overflow…) the meta entry stayed
 * in Redis as a phantom — discoverable via /a2a/tasks, acceptable, brief
 * decryptable, but `/submit` failed forever with NOT_INDEXED because no
 * TaskCreated event existed for the indexer to consume.
 *
 * This script enumerates the on-chain truth (every taskId 0..nextTaskId-1)
 * to build the canonical taskHash set, scans Redis for `a2a:meta:*`, and
 * deletes (or marks orphaned, with `--mark-only`) any meta whose hash isn't
 * on chain.
 *
 * Usage:
 *   pnpm tsx scripts/purge-phantom-tasks.ts             # dry run
 *   pnpm tsx scripts/purge-phantom-tasks.ts --execute   # actually delete
 *   pnpm tsx scripts/purge-phantom-tasks.ts --execute --mark-only
 *                                                       # mark state=orphaned
 *                                                       # instead of DEL
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Redis } from 'ioredis';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name: string): boolean {
  return process.argv.includes(name);
}

const EXECUTE = arg('--execute');
const MARK_ONLY = arg('--mark-only');

async function main() {
  const RPC = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
  const CHAIN_ID = Number(process.env.OG_CHAIN_ID ?? 16602);
  const ESCROW = process.env.BLIND_ESCROW_ADDRESS;
  const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

  if (!ESCROW) {
    throw new Error('BLIND_ESCROW_ADDRESS missing from env. Run from backend/ with a populated .env.');
  }

  console.log(`network: ${RPC} (chainId=${CHAIN_ID})`);
  console.log(`escrow:  ${ESCROW}`);
  console.log(`mode:    ${EXECUTE ? (MARK_ONLY ? 'EXECUTE — mark orphaned' : 'EXECUTE — delete') : 'DRY RUN'}`);
  console.log('');

  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, {
    batchMaxCount: 1,
    staticNetwork: true,
  });
  const abi = JSON.parse(
    readFileSync(join(__dirname, '..', 'src', 'abi', 'BlindEscrow.json'), 'utf-8'),
  ) as ethers.InterfaceAbi;
  const escrow = new ethers.Contract(ESCROW, abi, provider);

  // 1. Build canonical on-chain hash set.
  const nextTaskId = Number(await escrow.nextTaskId());
  console.log(`on-chain nextTaskId = ${nextTaskId}; scanning all task records…`);
  const onChainHashes = new Set<string>();
  const onChainById = new Map<string, { taskId: number; status: number; agent: string }>();
  for (let id = 0; id < nextTaskId; id++) {
    try {
      const t = await escrow.getTask(id);
      const h = (t.taskHash as string).toLowerCase();
      onChainHashes.add(h);
      onChainById.set(h, { taskId: id, status: Number(t.status), agent: t.agent });
    } catch (e) {
      console.warn(`  task ${id}: getTask failed (${(e as Error).message})`);
    }
  }
  console.log(`  collected ${onChainHashes.size} on-chain task hashes`);
  console.log('');

  // 2. Scan Redis for every a2a:meta:* key.
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
  await redis.connect();

  const allMetaKeys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', 'a2a:meta:*', 'COUNT', 500);
    cursor = next;
    allMetaKeys.push(...batch);
  } while (cursor !== '0');
  console.log(`redis: found ${allMetaKeys.length} a2a:meta:* keys`);

  const phantoms: string[] = [];
  const onChainMatched: string[] = [];
  for (const key of allMetaKeys) {
    const hash = key.replace(/^a2a:meta:/, '').toLowerCase();
    // Skip non-hash keys (legacy / numeric ids). The pattern accepts anything
    // suffixed to a2a:meta: so this is a defense against unrelated entries.
    if (!/^0x[0-9a-f]{64}$/.test(hash)) continue;
    if (onChainHashes.has(hash)) onChainMatched.push(hash);
    else phantoms.push(hash);
  }
  console.log(`  matched on chain: ${onChainMatched.length}`);
  console.log(`  PHANTOM (no on-chain task): ${phantoms.length}`);
  console.log('');

  if (phantoms.length === 0) {
    console.log('Nothing to clean. Exiting.');
    await redis.quit();
    return;
  }

  console.log('phantom hashes:');
  for (const h of phantoms) console.log(`  ${h}`);
  console.log('');

  if (!EXECUTE) {
    console.log('DRY RUN — rerun with --execute to apply.');
    console.log(`(add --mark-only to set state=orphaned instead of DEL)`);
    await redis.quit();
    return;
  }

  // 3. Apply.
  let removed = 0;
  for (const hash of phantoms) {
    const meta = `a2a:meta:${hash}`;
    const state = `a2a:state:${hash}`;

    if (MARK_ONLY) {
      const raw = await redis.get(state);
      const existing = raw ? JSON.parse(raw) : { taskId: hash };
      existing.status = 'orphaned';
      existing.orphanedAt = new Date().toISOString();
      await redis.set(state, JSON.stringify(existing));
      await redis.srem('a2a:open', hash);
      removed += 1;
    } else {
      const pipe = redis.pipeline();
      pipe.del(meta);
      pipe.del(state);
      pipe.srem('a2a:open', hash);
      // We can't easily walk every a2a:poster:<addr> set without knowing
      // posterAddress, but srem on the open index is the critical one — it
      // hides the phantom from /a2a/tasks. Poster index entries are
      // self-cleaning on next /tasks/posted enrichment (the missing meta
      // gets filtered out client-side via the onChain==null branch).
      await pipe.exec();
      removed += 1;
    }
  }

  console.log('');
  console.log(`${MARK_ONLY ? 'marked' : 'deleted'} ${removed} phantom A2A entries.`);
  await redis.quit();
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});

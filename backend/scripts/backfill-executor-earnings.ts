/**
 * One-shot repair for the executor-stats drift that shows "N tasks · 0 0G" on an
 * agent's detail page: tasksCompleted advanced while totalEarnedRaw stayed 0.
 *
 * Background — the A2A payout recorder (a2a.ts recordWorkerPayout) used to bump
 * tasksCompleted UNCONDITIONALLY, but only credit totalEarnedRaw if a second,
 * internal getTaskIdByHash lookup resolved. Under indexing lag that lookup
 * returned null (even though settlement still fired and reputation still moved),
 * so the earnings credit was silently dropped and the route's state guard then
 * blocked any retry from repairing it. The code fix (resolve the on-chain id in
 * the caller, then move tasksCompleted + totalEarnedRaw as one unit) stops new
 * drift; this script repairs records already written wrong.
 *
 * It ignores the stored counters and re-derives them from chain truth. For every
 * registered executor (agent:executor:* in Redis) it sums the exact on-chain
 * worker payout of every task that settled to that worker:
 *
 *     totalEarnedRaw = Σ TaskCompleted.workerPayout  where getTask(id).worker = addr
 *     tasksCompleted = count of those tasks
 *
 * Because it reads settled on-chain state (which never changes for a completed
 * task) it is fully idempotent: re-running produces identical values and is safe
 * on records already correct.
 *
 * SAFE BY DEFAULT: dry-run. It prints every change it WOULD make but writes
 * nothing to Redis unless you pass --apply.
 *
 * Usage:
 *   cd backend
 *
 *   # Dry-run against prod (defaults: mainnet RPC + escrow, REDIS_URL from .env):
 *   npx tsx scripts/backfill-executor-earnings.ts
 *
 *   # Apply:
 *   npx tsx scripts/backfill-executor-earnings.ts --apply
 *
 *   # Point at a specific chain / Redis when the defaults don't match your env:
 *   REDIS_URL=redis://prod-host:6379 \
 *   OG_RPC_URL=https://evmrpc.0g.ai \
 *   BLIND_ESCROW_ADDRESS=0x3d0374963DaaD43e31d42373eb11156A8e8ce2Ff \
 *   npx tsx scripts/backfill-executor-earnings.ts --apply
 *
 * Notes:
 *   - RPC and escrow MUST be the same network (a mismatch makes getTask revert).
 *   - Reads the SAME env the backend uses (REDIS_URL, OG_RPC_URL,
 *     BLIND_ESCROW_ADDRESS, ESCROW_DEPLOYMENT_BLOCK), so running it on a host
 *     with a populated .env targets that host automatically.
 *   - Only totalEarnedRaw + tasksCompleted are touched; every other executor
 *     field is preserved verbatim.
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { JsonRpcProvider, Contract, formatEther, type EventLog } from 'ethers';
import { Redis } from 'ioredis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const OG_RPC_URL = process.env.OG_RPC_URL ?? 'https://evmrpc.0g.ai';
const ESCROW_ADDRESS =
  process.env.BLIND_ESCROW_ADDRESS ??
  process.env.ESCROW_ADDRESS ??
  '0x3d0374963DaaD43e31d42373eb11156A8e8ce2Ff';
const DEPLOYMENT_BLOCK = Number(process.env.ESCROW_DEPLOYMENT_BLOCK ?? 33_459_885);
const MAX_BLOCKS_PER_QUERY = 1000; // mirror escrowEvents MAX_BLOCKS_PER_TICK

// Redis keys — MUST match services/agentStore.ts.
const EXECUTOR_KEY = (addr: string) => `agent:executor:${addr.toLowerCase()}`;
const EXECUTOR_ALL = 'agent:executor:all';

const ESCROW_ABI = [
  'event TaskCompleted(uint256 indexed taskId, uint256 workerPayout, uint256 platformFee)',
  'function getTask(uint256 taskId) view returns (tuple(address agent, address worker, address token, uint256 amount, bytes32 taskHash, bytes32 evidenceHash, uint8 status, string category, string locationZone, uint256 createdAt, uint256 deadline, uint8 submissionAttempts))',
];

interface Executor {
  address: string;
  tasksCompleted: number;
  totalEarnedRaw?: string;
  [k: string]: unknown;
}

const fmt0G = (wei: bigint) => Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 6 });

async function main(): Promise<void> {
  const provider = new JsonRpcProvider(OG_RPC_URL);
  const escrow = new Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });

  const network = await provider.getNetwork();
  const latest = await provider.getBlockNumber();

  console.log('Executor earnings backfill');
  console.log(`  mode      ${APPLY ? 'APPLY (writes Redis)' : 'DRY-RUN (no writes — pass --apply to commit)'}`);
  console.log(`  redis     ${REDIS_URL.replace(/\/\/.*@/, '//***@')}`);
  console.log(`  rpc       ${OG_RPC_URL}`);
  console.log(`  chain     ${network.chainId}`);
  console.log(`  escrow    ${ESCROW_ADDRESS}`);
  console.log(`  blocks    ${DEPLOYMENT_BLOCK}..${latest}`);
  console.log('');

  // 1) Scan every TaskCompleted event → exact worker payout per settled task.
  const filter = escrow.filters.TaskCompleted();
  const payoutByTaskId = new Map<string, bigint>();
  let scanned = 0;
  for (let from = DEPLOYMENT_BLOCK; from <= latest; from += MAX_BLOCKS_PER_QUERY) {
    const to = Math.min(latest, from + MAX_BLOCKS_PER_QUERY - 1);
    const events = await escrow.queryFilter(filter, from, to);
    for (const ev of events) {
      const args = (ev as EventLog).args;
      if (!args) continue;
      const taskId = (args.taskId as bigint).toString();
      payoutByTaskId.set(taskId, args.workerPayout as bigint);
    }
    scanned += events.length;
  }
  console.log(`Found ${scanned} TaskCompleted event(s).`);

  // 2) Attribute each settled task to its on-chain worker (definitive — survives
  //    any reassignment). getTask is one call per completed task; small set.
  const earned = new Map<string, { sum: bigint; count: number }>(); // worker(lowercased) → totals
  for (const [taskId, payout] of payoutByTaskId) {
    let worker: string;
    try {
      const t = await escrow.getTask(Number(taskId));
      worker = (t.worker as string).toLowerCase();
    } catch (e) {
      console.log(`  skip task ${taskId} — getTask failed: ${(e as Error).message.slice(0, 80)}`);
      continue;
    }
    const cur = earned.get(worker) ?? { sum: 0n, count: 0 };
    cur.sum += payout;
    cur.count += 1;
    earned.set(worker, cur);
  }

  // 3) Reconcile every registered executor against chain truth.
  const addrs = await redis.smembers(EXECUTOR_ALL);
  console.log(`Reconciling ${addrs.length} registered executor(s).`);
  console.log('');

  const updates: { addr: string; row: Executor; newEarned: string; newCount: number }[] = [];
  let unchanged = 0;
  for (const addr of addrs) {
    const raw = await redis.get(EXECUTOR_KEY(addr));
    if (!raw) continue;
    const row = JSON.parse(raw) as Executor;
    const chain = earned.get(addr.toLowerCase()) ?? { sum: 0n, count: 0 };
    const newEarned = chain.sum.toString();
    const newCount = chain.count;
    const storedEarned = row.totalEarnedRaw ?? '0';

    // Never lower tasksCompleted below what's stored — a worker may have H2H or
    // pre-indexer completions not represented by an on-chain TaskCompleted we
    // scanned. Earnings, though, are authoritative from chain.
    const finalCount = Math.max(newCount, row.tasksCompleted ?? 0);
    const earnedChanged = storedEarned !== newEarned;
    const countChanged = finalCount !== (row.tasksCompleted ?? 0);
    if (!earnedChanged && !countChanged) {
      unchanged++;
      continue;
    }
    updates.push({ addr, row, newEarned, newCount: finalCount });
    const name = (row.displayName as string) ?? addr;
    console.log(
      `  fix   ${addr}  (${name})\n` +
        `        earned  ${fmt0G(BigInt(storedEarned))} → ${fmt0G(BigInt(newEarned))} 0G` +
        (countChanged ? `   tasks ${row.tasksCompleted ?? 0} → ${finalCount}` : ''),
    );
  }

  console.log('');
  console.log('Summary');
  console.log(`  to fix     ${updates.length}`);
  console.log(`  unchanged  ${unchanged}`);
  console.log('');

  if (!APPLY) {
    console.log('Dry-run only — nothing written. Re-run with --apply to commit these changes.');
    await redis.quit();
    return;
  }

  for (const u of updates) {
    const next: Executor = { ...u.row, totalEarnedRaw: u.newEarned, tasksCompleted: u.newCount };
    await redis.set(EXECUTOR_KEY(u.addr), JSON.stringify(next));
  }
  console.log(`Applied ${updates.length} executor update(s) to Redis.`);
  await redis.quit();
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});

import { getDb } from './database.js';
import { getPool } from './neonDb.js';
import { config } from '../config.js';

const STAKE_PERCENT = 0.10;

export interface Stake {
  id: number;
  worker: string;
  task_id: string;
  task_reward: number;
  stake_amount: number;
  status: 'locked' | 'returned' | 'slashed';
  created_at: string;
  updated_at: string;
}

export interface StakeSummary {
  totalLocked: number;
  totalReturned: number;
  totalSlashed: number;
  activeStakes: number;
}

function usePg(): boolean {
  return Boolean(config.databaseUrl);
}

export function calculateStakeAmount(taskReward: number): number {
  return Math.round(taskReward * STAKE_PERCENT * 100) / 100;
}

export async function lockStake(worker: string, taskId: string, taskReward: number): Promise<Stake> {
  const stakeAmount = calculateStakeAmount(taskReward);
  const now = new Date().toISOString();

  if (usePg()) {
    const pool = await getPool();
    await pool.query(
      `INSERT INTO stakes (worker, task_id, task_reward, stake_amount, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [worker, taskId, taskReward, stakeAmount, 'locked', now, now],
    );
    const res = await pool.query('SELECT * FROM stakes WHERE task_id = $1', [taskId]);
    return res.rows[0] as Stake;
  }

  const db = getDb();
  db.prepare(
    'INSERT INTO stakes (worker, task_id, task_reward, stake_amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(worker, taskId, taskReward, stakeAmount, 'locked', now, now);

  return db.prepare('SELECT * FROM stakes WHERE task_id = ?').get(taskId) as Stake;
}

export async function releaseStake(taskId: string): Promise<Stake | null> {
  const now = new Date().toISOString();

  if (usePg()) {
    const pool = await getPool();
    const res = await pool.query(
      "UPDATE stakes SET status = 'returned', updated_at = $1 WHERE task_id = $2 AND status = 'locked' RETURNING *",
      [now, taskId],
    );
    return res.rows[0] as Stake | null;
  }

  const db = getDb();
  const result = db.prepare(
    "UPDATE stakes SET status = 'returned', updated_at = ? WHERE task_id = ? AND status = 'locked'",
  ).run(now, taskId);
  if (result.changes === 0) return null;
  return db.prepare('SELECT * FROM stakes WHERE task_id = ?').get(taskId) as Stake | null;
}

export async function slashStake(taskId: string): Promise<Stake | null> {
  const now = new Date().toISOString();

  if (usePg()) {
    const pool = await getPool();
    const res = await pool.query(
      "UPDATE stakes SET status = 'slashed', updated_at = $1 WHERE task_id = $2 AND status = 'locked' RETURNING *",
      [now, taskId],
    );
    return res.rows[0] as Stake | null;
  }

  const db = getDb();
  const result = db.prepare(
    "UPDATE stakes SET status = 'slashed', updated_at = ? WHERE task_id = ? AND status = 'locked'",
  ).run(now, taskId);
  if (result.changes === 0) return null;
  return db.prepare('SELECT * FROM stakes WHERE task_id = ?').get(taskId) as Stake | null;
}

export async function getWorkerStakes(address: string): Promise<Stake[]> {
  if (usePg()) {
    const pool = await getPool();
    const res = await pool.query(
      'SELECT * FROM stakes WHERE worker = $1 ORDER BY created_at DESC',
      [address],
    );
    return res.rows as Stake[];
  }

  const db = getDb();
  return db
    .prepare('SELECT * FROM stakes WHERE worker = ? ORDER BY created_at DESC')
    .all(address) as Stake[];
}

export async function getStakeSummary(address: string): Promise<StakeSummary> {
  if (usePg()) {
    const pool = await getPool();
    const res = await pool.query(
      'SELECT status, SUM(stake_amount) as total, COUNT(*)::int as cnt FROM stakes WHERE worker = $1 GROUP BY status',
      [address],
    );
    const summary: StakeSummary = { totalLocked: 0, totalReturned: 0, totalSlashed: 0, activeStakes: 0 };
    for (const row of res.rows) {
      if (row.status === 'locked') {
        summary.totalLocked = Number(row.total);
        summary.activeStakes = row.cnt;
      } else if (row.status === 'returned') {
        summary.totalReturned = Number(row.total);
      } else if (row.status === 'slashed') {
        summary.totalSlashed = Number(row.total);
      }
    }
    return summary;
  }

  const db = getDb();
  const rows = db
    .prepare('SELECT status, SUM(stake_amount) as total, COUNT(*) as cnt FROM stakes WHERE worker = ? GROUP BY status')
    .all(address) as { status: string; total: number; cnt: number }[];

  const summary: StakeSummary = { totalLocked: 0, totalReturned: 0, totalSlashed: 0, activeStakes: 0 };
  for (const row of rows) {
    if (row.status === 'locked') {
      summary.totalLocked = row.total;
      summary.activeStakes = row.cnt;
    } else if (row.status === 'returned') {
      summary.totalReturned = row.total;
    } else if (row.status === 'slashed') {
      summary.totalSlashed = row.total;
    }
  }
  return summary;
}

export async function getTaskStake(taskId: string): Promise<Stake | null> {
  if (usePg()) {
    const pool = await getPool();
    const res = await pool.query('SELECT * FROM stakes WHERE task_id = $1', [taskId]);
    return (res.rows[0] as Stake) ?? null;
  }

  const db = getDb();
  return (db.prepare('SELECT * FROM stakes WHERE task_id = ?').get(taskId) as Stake) ?? null;
}

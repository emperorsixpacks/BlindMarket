import { getDb } from './database.js';

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

export function calculateStakeAmount(taskReward: number): number {
  return Math.round(taskReward * STAKE_PERCENT * 100) / 100;
}

export function lockStake(worker: string, taskId: string, taskReward: number): Stake {
  const db = getDb();
  const stakeAmount = calculateStakeAmount(taskReward);
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO stakes (worker, task_id, task_reward, stake_amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(worker, taskId, taskReward, stakeAmount, 'locked', now, now);

  return db.prepare('SELECT * FROM stakes WHERE task_id = ?').get(taskId) as Stake;
}

export function releaseStake(taskId: string): Stake | null {
  const db = getDb();
  const now = new Date().toISOString();
  // Only transition a currently-locked stake. Return null when nothing changed
  // (already returned/slashed, or no stake) so callers 404 instead of re-crediting
  // a duplicate stake_return income entry on every repeat call.
  const result = db.prepare(
    "UPDATE stakes SET status = 'returned', updated_at = ? WHERE task_id = ? AND status = 'locked'",
  ).run(now, taskId);
  if (result.changes === 0) return null;
  return db.prepare('SELECT * FROM stakes WHERE task_id = ?').get(taskId) as Stake | null;
}

export function slashStake(taskId: string): Stake | null {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(
    "UPDATE stakes SET status = 'slashed', updated_at = ? WHERE task_id = ? AND status = 'locked'",
  ).run(now, taskId);
  if (result.changes === 0) return null;
  return db.prepare('SELECT * FROM stakes WHERE task_id = ?').get(taskId) as Stake | null;
}

export function getWorkerStakes(address: string): Stake[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM stakes WHERE worker = ? ORDER BY created_at DESC')
    .all(address) as Stake[];
}

export function getStakeSummary(address: string): StakeSummary {
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

export function getTaskStake(taskId: string): Stake | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM stakes WHERE task_id = ?').get(taskId) as Stake) ?? null;
}

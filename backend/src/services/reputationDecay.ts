import { getPool } from './neonDb.js';

const HALF_LIFE_DAYS = 7;

export interface DecayedReputation {
  address: string;
  rawScore: number;
  decayedScore: number;
  decayFactor: number;
  daysSinceLastTask: number | null;
  tasksCompleted: number;
  disputes: number;
}

export interface ReputationEvent {
  id: number;
  address: string;
  task_id: string;
  event_type: string;
  score_delta: number;
  created_at: string;
}

function computeDecayFactor(daysSinceLastTask: number | null): number {
  if (daysSinceLastTask === null) return 1;
  return Math.pow(0.5, daysSinceLastTask / HALF_LIFE_DAYS);
}

export async function getDecayedReputation(address: string): Promise<DecayedReputation> {
  const db = getPool();
  const { rows } = await db.query(
    'SELECT * FROM reputation_history WHERE address = $1',
    [address],
  );

  if (rows.length === 0) {
    return {
      address,
      rawScore: 0,
      decayedScore: 0,
      decayFactor: 1,
      daysSinceLastTask: null,
      tasksCompleted: 0,
      disputes: 0,
    };
  }

  const row = rows[0] as {
    address: string;
    raw_score: number;
    tasks_completed: number;
    disputes: number;
    last_task_at: string | null;
  };

  let daysSinceLastTask: number | null = null;
  if (row.last_task_at) {
    const lastTaskDate = new Date(row.last_task_at);
    daysSinceLastTask = (Date.now() - lastTaskDate.getTime()) / (1000 * 60 * 60 * 24);
  }

  const decayFactor = computeDecayFactor(daysSinceLastTask);
  const decayedScore = row.raw_score * decayFactor;

  return {
    address,
    rawScore: row.raw_score,
    decayedScore: Math.round(decayedScore * 100) / 100,
    decayFactor: Math.round(decayFactor * 1000) / 1000,
    daysSinceLastTask: daysSinceLastTask !== null ? Math.round(daysSinceLastTask * 10) / 10 : null,
    tasksCompleted: row.tasks_completed,
    disputes: row.disputes,
  };
}

export async function recordTaskCompletion(address: string, taskId: string, scoreDelta: number): Promise<void> {
  const db = getPool();
  const now = new Date().toISOString();

  const { rows } = await db.query('SELECT * FROM reputation_history WHERE address = $1', [address]);

  if (rows.length > 0) {
    await db.query(
      'UPDATE reputation_history SET raw_score = raw_score + $1, tasks_completed = tasks_completed + 1, last_task_at = $2 WHERE address = $3',
      [scoreDelta, now, address],
    );
  } else {
    await db.query(
      'INSERT INTO reputation_history (address, raw_score, tasks_completed, last_task_at) VALUES ($1, $2, 1, $3)',
      [address, scoreDelta, now],
    );
  }

  await db.query(
    'INSERT INTO reputation_events (address, task_id, event_type, score_delta) VALUES ($1, $2, $3, $4)',
    [address, taskId, 'task_completed', scoreDelta],
  );
}

export async function recordDispute(address: string, taskId: string): Promise<void> {
  const db = getPool();

  const { rows } = await db.query('SELECT * FROM reputation_history WHERE address = $1', [address]);

  if (rows.length > 0) {
    await db.query('UPDATE reputation_history SET disputes = disputes + 1 WHERE address = $1', [address]);
  } else {
    await db.query(
      'INSERT INTO reputation_history (address, raw_score, disputes) VALUES ($1, 0, 1)',
      [address],
    );
  }

  await db.query(
    'INSERT INTO reputation_events (address, task_id, event_type, score_delta) VALUES ($1, $2, $3, $4)',
    [address, taskId, 'dispute', 0],
  );
}

export async function getLeaderboard(limit: number = 20): Promise<DecayedReputation[]> {
  const db = getPool();
  const { rows } = await db.query(
    'SELECT * FROM reputation_history ORDER BY raw_score DESC LIMIT $1',
    [limit],
  );

  return rows
    .map((row: any) => {
      let daysSinceLastTask: number | null = null;
      if (row.last_task_at) {
        daysSinceLastTask = (Date.now() - new Date(row.last_task_at).getTime()) / (1000 * 60 * 60 * 24);
      }
      const decayFactor = computeDecayFactor(daysSinceLastTask);
      return {
        address: row.address,
        rawScore: row.raw_score,
        decayedScore: Math.round(row.raw_score * decayFactor * 100) / 100,
        decayFactor: Math.round(decayFactor * 1000) / 1000,
        daysSinceLastTask: daysSinceLastTask !== null ? Math.round(daysSinceLastTask * 10) / 10 : null,
        tasksCompleted: row.tasks_completed,
        disputes: row.disputes,
      };
    })
    .sort((a: DecayedReputation, b: DecayedReputation) => b.decayedScore - a.decayedScore);
}

export async function getReputationHistory(address: string, limit: number = 100): Promise<ReputationEvent[]> {
  const db = getPool();
  const { rows } = await db.query(
    'SELECT * FROM reputation_events WHERE address = $1 ORDER BY created_at DESC LIMIT $2',
    [address, limit],
  );
  return rows as ReputationEvent[];
}

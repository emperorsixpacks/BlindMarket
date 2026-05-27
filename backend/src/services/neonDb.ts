import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set — Neon PostgreSQL connection unavailable');
  }

  pool = new Pool({ connectionString: config.databaseUrl });
  runMigrations(pool);
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}

// ── Migrations ─────────────────────────────────────────────────────────────────

const migrations: Array<{ id: number; name: string; sql: string }> = [
  {
    id: 1,
    name: 'reputation_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS reputation_history (
        address TEXT PRIMARY KEY,
        raw_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        tasks_completed INTEGER NOT NULL DEFAULT 0,
        disputes INTEGER NOT NULL DEFAULT 0,
        last_task_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS reputation_events (
        id SERIAL PRIMARY KEY,
        address TEXT NOT NULL,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        score_delta DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_rep_events_addr ON reputation_events(address);
    `,
  },
];

async function runMigrations(p: pg.Pool): Promise<void> {
  const client = await p.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const { rows: applied } = await client.query<{ id: number }>(
      'SELECT id FROM schema_migrations',
    );
    const appliedIds = new Set(applied.map((r: { id: number }) => r.id));

    for (const m of migrations) {
      if (appliedIds.has(m.id)) continue;
      await client.query(m.sql);
      await client.query(
        'INSERT INTO schema_migrations (id, name) VALUES ($1, $2)',
        [m.id, m.name],
      );
      console.log(`[neonDb] Applied migration ${m.id}: ${m.name}`);
    }
  } finally {
    client.release();
  }
}

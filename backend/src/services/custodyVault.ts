import { createHash } from 'crypto';
import { getDb } from './database.js';
import { getPool } from './neonDb.js';
import { config } from '../config.js';

export interface CustodyEntry {
  id: number;
  task_id: string;
  evidence_hash: string;
  submitter: string;
  data_snapshot: string | null;
  integrity_hash: string | null;
  created_at: string;
}

/** Deterministic commitment over a custody entry's immutable fields (no timestamp,
 *  so it is recomputable). Any later change to one of these fields makes the
 *  recomputation diverge from the value stored at ingest. */
function commitment(taskId: string, evidenceHash: string, submitter: string, dataSnapshot: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ taskId, evidenceHash, submitter, dataSnapshot }))
    .digest('hex');
}

export interface AuditEvent {
  id: number;
  task_id: string;
  entry_id: number | null;
  action: string;
  actor: string;
  detail: string | null;
  created_at: string;
}

type AuditAction = 'submitted' | 'viewed' | 'verified' | 'exported' | 'integrity_check';

function usePg(): boolean {
  return Boolean(config.databaseUrl);
}

export async function ingestEvidence(
  taskId: string,
  evidenceHash: string,
  submitter: string,
  dataSnapshot?: string,
): Promise<CustodyEntry> {
  const snap = dataSnapshot ?? null;
  const integrityHash = commitment(taskId, evidenceHash, submitter, snap ?? '');

  if (usePg()) {
    const pool = await getPool();
    const res = await pool.query(
      `INSERT INTO custody_entries (task_id, evidence_hash, submitter, data_snapshot, integrity_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [taskId, evidenceHash, submitter, snap, integrityHash],
    );
    const entry = res.rows[0] as CustodyEntry;
    await logAuditEvent(taskId, entry.id, 'submitted', submitter, `Evidence ingested: ${evidenceHash}`);
    return entry;
  }

  const db = getDb();
  const result = db
    .prepare(
      'INSERT INTO custody_entries (task_id, evidence_hash, submitter, data_snapshot, integrity_hash) VALUES (?, ?, ?, ?, ?)',
    )
    .run(taskId, evidenceHash, submitter, snap, integrityHash);

  const entryId = result.lastInsertRowid as number;
  logAuditEvent(taskId, entryId, 'submitted', submitter, `Evidence ingested: ${evidenceHash}`);

  return db.prepare('SELECT * FROM custody_entries WHERE id = ?').get(entryId) as CustodyEntry;
}

export async function logAuditEvent(
  taskId: string,
  entryId: number | null,
  action: AuditAction,
  actor: string,
  detail?: string,
): Promise<void> {
  if (usePg()) {
    const pool = await getPool();
    await pool.query(
      `INSERT INTO custody_audit_log (task_id, entry_id, action, actor, detail) VALUES ($1, $2, $3, $4, $5)`,
      [taskId, entryId, action, actor, detail ?? null],
    );
    return;
  }

  const db = getDb();
  db.prepare(
    'INSERT INTO custody_audit_log (task_id, entry_id, action, actor, detail) VALUES (?, ?, ?, ?, ?)',
  ).run(taskId, entryId, action, actor, detail ?? null);
}

export async function getCustodyChain(taskId: string): Promise<CustodyEntry[]> {
  if (usePg()) {
    const pool = await getPool();
    const res = await pool.query(
      'SELECT * FROM custody_entries WHERE task_id = $1 ORDER BY created_at ASC',
      [taskId],
    );
    return res.rows as CustodyEntry[];
  }

  const db = getDb();
  return db
    .prepare('SELECT * FROM custody_entries WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as CustodyEntry[];
}

export async function getAuditLog(taskId: string): Promise<AuditEvent[]> {
  if (usePg()) {
    const pool = await getPool();
    const res = await pool.query(
      'SELECT * FROM custody_audit_log WHERE task_id = $1 ORDER BY created_at ASC',
      [taskId],
    );
    return res.rows as AuditEvent[];
  }

  const db = getDb();
  return db
    .prepare('SELECT * FROM custody_audit_log WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as AuditEvent[];
}

export async function verifyIntegrity(taskId: string): Promise<{ valid: boolean; entries: { id: number; stored: string; computed: string; match: boolean }[] }> {
  let entries: CustodyEntry[];

  if (usePg()) {
    const pool = await getPool();
    const res = await pool.query(
      'SELECT * FROM custody_entries WHERE task_id = $1 ORDER BY id ASC',
      [taskId],
    );
    entries = res.rows as CustodyEntry[];
  } else {
    const db = getDb();
    entries = db
      .prepare('SELECT * FROM custody_entries WHERE task_id = ? ORDER BY id ASC')
      .all(taskId) as CustodyEntry[];
  }

  const results = entries.map((entry) => {
    const recomputed = commitment(entry.task_id, entry.evidence_hash, entry.submitter, entry.data_snapshot ?? '');
    const stored = entry.integrity_hash ?? '';
    return {
      id: entry.id,
      stored,
      computed: recomputed,
      match: stored.length === 64 && recomputed === stored,
    };
  });

  return {
    valid: results.every((r) => r.match),
    entries: results,
  };
}

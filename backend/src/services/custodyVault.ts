import { createHash } from 'crypto';
import { getDb } from './database.js';

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

export function ingestEvidence(
  taskId: string,
  evidenceHash: string,
  submitter: string,
  dataSnapshot?: string,
): CustodyEntry {
  const db = getDb();
  const snap = dataSnapshot ?? null;
  // Store the REAL evidence hash (the chain-of-custody record) plus a
  // recomputable integrity commitment over the immutable fields. The old code
  // stored a timestamp-salted hash in evidence_hash — unrecomputable, so
  // verifyIntegrity could never actually check it.
  const integrityHash = commitment(taskId, evidenceHash, submitter, snap ?? '');

  const result = db
    .prepare(
      'INSERT INTO custody_entries (task_id, evidence_hash, submitter, data_snapshot, integrity_hash) VALUES (?, ?, ?, ?, ?)',
    )
    .run(taskId, evidenceHash, submitter, snap, integrityHash);

  const entryId = result.lastInsertRowid as number;
  logAuditEvent(taskId, entryId, 'submitted', submitter, `Evidence ingested: ${evidenceHash}`);

  return db.prepare('SELECT * FROM custody_entries WHERE id = ?').get(entryId) as CustodyEntry;
}

export function logAuditEvent(
  taskId: string,
  entryId: number | null,
  action: AuditAction,
  actor: string,
  detail?: string,
): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO custody_audit_log (task_id, entry_id, action, actor, detail) VALUES (?, ?, ?, ?, ?)',
  ).run(taskId, entryId, action, actor, detail ?? null);
}

export function getCustodyChain(taskId: string): CustodyEntry[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM custody_entries WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as CustodyEntry[];
}

export function getAuditLog(taskId: string): AuditEvent[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM custody_audit_log WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as AuditEvent[];
}

export function verifyIntegrity(taskId: string): { valid: boolean; entries: { id: number; stored: string; computed: string; match: boolean }[] } {
  const db = getDb();
  const entries = db
    .prepare('SELECT * FROM custody_entries WHERE task_id = ? ORDER BY id ASC')
    .all(taskId) as CustodyEntry[];

  const results = entries.map((entry) => {
    const recomputed = commitment(entry.task_id, entry.evidence_hash, entry.submitter, entry.data_snapshot ?? '');
    const stored = entry.integrity_hash ?? '';
    return {
      id: entry.id,
      stored,
      computed: recomputed,
      // Genuine tamper check: any change to task_id / evidence_hash / submitter /
      // data_snapshot diverges from the commitment stored at ingest. Legacy rows
      // written before the integrity_hash column (stored === '') are reported
      // UNVERIFIED (match:false), not silently "valid".
      match: stored.length === 64 && recomputed === stored,
    };
  });

  return {
    valid: results.every((r) => r.match),
    entries: results,
  };
}

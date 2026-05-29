import { getDb } from './database.js';

export interface AgentMessage {
  id: number;
  task_id: string | null;
  from_address: string;
  to_address: string;
  subject: string | null;
  body: string;
  read_at: string | null;
  created_at: string;
}

/**
 * Send a message from one address to another.
 * Agents use this to message poster, or poster to message agent.
 */
export function sendMessage(opts: {
  from: string;
  to: string;
  taskId?: string;
  subject?: string;
  body: string;
}): AgentMessage {
  const db = getDb();
  const result = db
    .prepare(
      'INSERT INTO agent_messages (task_id, from_address, to_address, subject, body) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      opts.taskId ?? null,
      opts.from.toLowerCase(),
      opts.to.toLowerCase(),
      opts.subject ?? null,
      opts.body,
    );
  return db
    .prepare('SELECT * FROM agent_messages WHERE id = ?')
    .get(result.lastInsertRowid) as AgentMessage;
}

/**
 * Get inbox for an address (messages addressed to them).
 * Optional taskId filter for task-specific threads.
 */
export function getInbox(
  address: string,
  opts?: { taskId?: string; unreadOnly?: boolean; limit?: number; offset?: number },
): { messages: AgentMessage[]; total: number } {
  const db = getDb();
  const addr = address.toLowerCase();
  let where = 'WHERE to_address = ?';
  const params: (string | number)[] = [addr];

  if (opts?.taskId) {
    where += ' AND task_id = ?';
    params.push(opts.taskId);
  }
  if (opts?.unreadOnly) {
    where += ' AND read_at IS NULL';
  }

  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM agent_messages ${where}`)
    .get(...params) as { cnt: number };

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const messages = db
    .prepare(`SELECT * FROM agent_messages ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as AgentMessage[];

  return { messages, total: countRow.cnt };
}

/**
 * Get sent messages from an address.
 */
export function getSent(
  address: string,
  opts?: { taskId?: string; limit?: number; offset?: number },
): { messages: AgentMessage[]; total: number } {
  const db = getDb();
  const addr = address.toLowerCase();
  let where = 'WHERE from_address = ?';
  const params: (string | number)[] = [addr];

  if (opts?.taskId) {
    where += ' AND task_id = ?';
    params.push(opts.taskId);
  }

  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM agent_messages ${where}`)
    .get(...params) as { cnt: number };

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const messages = db
    .prepare(`SELECT * FROM agent_messages ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as AgentMessage[];

  return { messages, total: countRow.cnt };
}

/**
 * Get the full conversation thread between two addresses for a specific task.
 */
export function getThread(
  addressA: string,
  addressB: string,
  taskId: string,
): AgentMessage[] {
  const db = getDb();
  const a = addressA.toLowerCase();
  const b = addressB.toLowerCase();
  return db
    .prepare(
      `SELECT * FROM agent_messages
       WHERE task_id = ?
         AND ((from_address = ? AND to_address = ?) OR (from_address = ? AND to_address = ?))
       ORDER BY created_at ASC`,
    )
    .all(taskId, a, b, b, a) as AgentMessage[];
}

/**
 * Mark messages as read.
 */
export function markRead(address: string, messageIds?: number[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const addr = address.toLowerCase();

  if (messageIds?.length) {
    const placeholders = messageIds.map(() => '?').join(',');
    db
      .prepare(
        `UPDATE agent_messages SET read_at = ? WHERE id IN (${placeholders}) AND to_address = ? AND read_at IS NULL`,
      )
      .run(now, ...messageIds, addr);
  } else {
    db.prepare('UPDATE agent_messages SET read_at = ? WHERE to_address = ? AND read_at IS NULL').run(now, addr);
  }
}

/**
 * Count unread messages for an address.
 */
export function unreadCount(address: string): number {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM agent_messages WHERE to_address = ? AND read_at IS NULL')
    .get(address.toLowerCase()) as { cnt: number };
  return row.cnt;
}

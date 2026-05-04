import { getDb } from './database.js';

export interface RecordEventInput {
  event: string;
  anonId?: string | null;
  sessionId?: string | null;
  address?: string | null;
  path?: string | null;
  referrer?: string | null;
  props?: Record<string, unknown> | null;
  userAgent?: string | null;
}

const MAX_EVENT_LEN = 80;
const MAX_PATH_LEN = 512;
const MAX_PROPS_LEN = 4096;

function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function recordEvent(input: RecordEventInput): void {
  const db = getDb();
  const event = clip(input.event, MAX_EVENT_LEN);
  if (!event) return;

  let propsJson: string | null = null;
  if (input.props && typeof input.props === 'object') {
    try {
      const s = JSON.stringify(input.props);
      propsJson = s.length > MAX_PROPS_LEN ? s.slice(0, MAX_PROPS_LEN) : s;
    } catch {
      propsJson = null;
    }
  }

  db.prepare(
    `INSERT INTO analytics_events
       (event, anon_id, session_id, address, path, referrer, props, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event,
    clip(input.anonId, 80),
    clip(input.sessionId, 80),
    input.address ? input.address.toLowerCase() : null,
    clip(input.path, MAX_PATH_LEN),
    clip(input.referrer, MAX_PATH_LEN),
    propsJson,
    clip(input.userAgent, 256),
  );
}

export function recordBatch(inputs: RecordEventInput[]): number {
  if (!inputs.length) return 0;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO analytics_events
       (event, anon_id, session_id, address, path, referrer, props, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: RecordEventInput[]) => {
    let n = 0;
    for (const r of rows) {
      const event = clip(r.event, MAX_EVENT_LEN);
      if (!event) continue;
      let propsJson: string | null = null;
      if (r.props && typeof r.props === 'object') {
        try {
          const s = JSON.stringify(r.props);
          propsJson = s.length > MAX_PROPS_LEN ? s.slice(0, MAX_PROPS_LEN) : s;
        } catch { /* ignore */ }
      }
      stmt.run(
        event,
        clip(r.anonId, 80),
        clip(r.sessionId, 80),
        r.address ? r.address.toLowerCase() : null,
        clip(r.path, MAX_PATH_LEN),
        clip(r.referrer, MAX_PATH_LEN),
        propsJson,
        clip(r.userAgent, 256),
      );
      n++;
    }
    return n;
  });
  return tx(inputs);
}

// Funnel stages, ordered. Each stage counts unique anon_ids that fired the event.
const FUNNEL_STAGES = [
  'landing_view',
  'cta_click',
  'connect_wallet',
  'post_task_view',
  'task_posted',
  'task_funded',
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface FunnelRow {
  stage: FunnelStage;
  uniqueVisitors: number;
  totalEvents: number;
  conversionFromPrev: number | null; // ratio 0..1
  conversionFromTop: number | null;  // ratio 0..1
}

export interface FunnelResult {
  windowDays: number;
  generatedAt: string;
  rows: FunnelRow[];
}

export function getFunnel(windowDays = 30): FunnelResult {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const uniqueStmt = db.prepare(
    `SELECT COUNT(DISTINCT anon_id) AS n
       FROM analytics_events
      WHERE event = ? AND created_at >= ? AND anon_id IS NOT NULL`,
  );
  const totalStmt = db.prepare(
    `SELECT COUNT(*) AS n
       FROM analytics_events
      WHERE event = ? AND created_at >= ?`,
  );

  const rows: FunnelRow[] = [];
  let topUnique = 0;
  let prevUnique = 0;

  for (let i = 0; i < FUNNEL_STAGES.length; i++) {
    const stage = FUNNEL_STAGES[i];
    const uniqueVisitors = (uniqueStmt.get(stage, since) as { n: number }).n;
    const totalEvents = (totalStmt.get(stage, since) as { n: number }).n;

    if (i === 0) topUnique = uniqueVisitors;

    rows.push({
      stage,
      uniqueVisitors,
      totalEvents,
      conversionFromPrev: i === 0 || prevUnique === 0 ? null : uniqueVisitors / prevUnique,
      conversionFromTop: i === 0 || topUnique === 0 ? null : uniqueVisitors / topUnique,
    });

    prevUnique = uniqueVisitors;
  }

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    rows,
  };
}

export interface EventCount {
  event: string;
  count: number;
}

export function getTopEvents(windowDays = 30, limit = 25): EventCount[] {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  return db
    .prepare(
      `SELECT event, COUNT(*) AS count
         FROM analytics_events
        WHERE created_at >= ?
        GROUP BY event
        ORDER BY count DESC
        LIMIT ?`,
    )
    .all(since, limit) as EventCount[];
}

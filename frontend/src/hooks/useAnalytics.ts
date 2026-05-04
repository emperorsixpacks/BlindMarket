import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { API_BASE_URL } from '../config/constants';

const ANON_KEY = 'bb_anon_id';
const SESSION_KEY = 'bb_session_id';
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER = 25;

interface QueuedEvent {
  event: string;
  anonId: string;
  sessionId: string;
  path: string;
  referrer: string | null;
  props?: Record<string, unknown>;
  ts: number;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getAnonId(): string {
  try {
    let v = localStorage.getItem(ANON_KEY);
    if (!v) {
      v = uuid();
      localStorage.setItem(ANON_KEY, v);
    }
    return v;
  } catch {
    return 'anon-no-storage';
  }
}

function getSessionId(): string {
  try {
    let v = sessionStorage.getItem(SESSION_KEY);
    if (!v) {
      v = uuid();
      sessionStorage.setItem(SESSION_KEY, v);
    }
    return v;
  } catch {
    return 'session-no-storage';
  }
}

// Module-level buffer + timer so multiple components share one flush loop.
const buffer: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

async function flush(useBeacon = false): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer.splice(0, buffer.length);
  const payload = JSON.stringify({
    events: batch.map(e => ({
      event: e.event,
      anonId: e.anonId,
      sessionId: e.sessionId,
      path: e.path,
      referrer: e.referrer,
      props: e.props,
    })),
  });

  const url = `${API_BASE_URL}/api/v1/analytics/events`;

  try {
    if (useBeacon && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      const blob = new Blob([payload], { type: 'application/json' });
      const ok = navigator.sendBeacon(url, blob);
      if (!ok) throw new Error('beacon failed');
    } else {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      });
    }
  } catch {
    // Drop silently — analytics must never break the app. Re-queueing risks
    // an infinite retry loop if the backend is down.
  } finally {
    flushing = false;
  }
}

/** Non-hook tracker — usable from contexts, plain handlers, anywhere. */
export function trackEvent(event: string, props?: Record<string, unknown>): void {
  installPageHooks();
  buffer.push({
    event,
    anonId: getAnonId(),
    sessionId: getSessionId(),
    path: typeof window !== 'undefined' ? window.location.pathname : '',
    referrer: typeof document !== 'undefined' ? document.referrer || null : null,
    props,
    ts: Date.now(),
  });
  if (buffer.length >= MAX_BUFFER) {
    void flush();
  } else {
    scheduleFlush();
  }
}

let pageHooksInstalled = false;
function installPageHooks() {
  if (pageHooksInstalled || typeof window === 'undefined') return;
  pageHooksInstalled = true;
  // Flush in-flight events before unload.
  window.addEventListener('pagehide', () => { void flush(true); });
  window.addEventListener('beforeunload', () => { void flush(true); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true);
  });
}

export function useAnalytics() {
  const location = useLocation();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    installPageHooks();
  }, []);

  const track = useCallback(trackEvent, []);

  // Auto-track route views (one per pathname change).
  useEffect(() => {
    const path = location.pathname;
    if (lastTrackedPath.current === path) return;
    lastTrackedPath.current = path;

    if (path === '/') {
      track('landing_view');
    } else {
      track('route_view', { path });
    }
  }, [location.pathname, track]);

  return { track };
}

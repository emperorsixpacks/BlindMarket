import { type ReactNode } from 'react';
import { Icon } from './Icon';
import { Tag } from './Tag';

/**
 * Shared state + status primitives for the internal app, so every page shows
 * loading / empty / status the same way instead of ad-hoc "loading…" text and
 * mismatched status colours.
 */

/** Spinner — SVG (not a rounded div; border-radius is forced to 0 app-wide). */
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="var(--bb-line)" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--bb-cream)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Shimmering placeholder block. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-surface-2 animate-pulse ${className}`} aria-hidden />;
}

/** Centered loading indicator. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-sm text-ink-3">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/** Friendly, actionable empty state. */
export function EmptyState({
  icon = 'list',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-11 h-11 border border-line flex items-center justify-center text-ink-3 mb-4">
        <Icon name={icon} size={20} />
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="text-xs text-ink-3 mt-1.5 max-w-xs leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Error state — a load failed; offers a retry when the caller can refetch. */
export function ErrorState({
  title = "Couldn't load this",
  description = 'Something went wrong reaching the marketplace. Check your connection and try again.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-11 h-11 border border-err/40 flex items-center justify-center text-err mb-4">
        <Icon name="alert" size={20} />
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="text-xs text-ink-3 mt-1.5 max-w-xs leading-relaxed">{description}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 text-xs font-mono uppercase tracking-widest border border-line px-3 py-1.5 text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ── Semantic status → tone ───────────────────────────────────────────
type Tone = 'ok' | 'warn' | 'err' | 'info' | 'neutral';

const STATUS_TONE: Record<string, Tone> = {
  // queued / awaiting — neutral, no action needed
  open: 'neutral', posted: 'neutral', funded: 'neutral', waiting: 'neutral',
  idle: 'neutral', stopped: 'neutral', refunded: 'neutral',
  // active / in-flight — warm, something is happening
  assigned: 'warn', accepted: 'warn', in_progress: 'warn', executing: 'warn',
  active: 'warn', paused: 'warn',
  // submitted / verifying — info, awaiting a verdict
  submitted: 'info', verifying: 'info', pending: 'info',
  // done — green
  completed: 'ok', verified: 'ok', settled: 'ok', paid: 'ok', success: 'ok', running: 'ok',
  // failed — red
  failed: 'err', cancelled: 'err', canceled: 'err', disputed: 'err', error: 'err', expired: 'err',
};

export function statusTone(status?: string): Tone {
  if (!status) return 'neutral';
  return STATUS_TONE[status.toLowerCase().replace(/[\s-]+/g, '_')] ?? 'neutral';
}

/** A status chip whose colour is derived semantically from the status string. */
export function StatusTag({ status }: { status?: string }) {
  if (!status) return null;
  return <Tag tone={statusTone(status)}>{status.replace(/_/g, ' ')}</Tag>;
}

import type { ReactNode } from 'react';

/** Square selectable chip — the one styling used for capability picks and
 *  service-type picks. Zero-radius by design (bb app surface). */
export function ChoiceChip({
  selected,
  onClick,
  children,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={`px-2.5 py-1 text-xs border transition-colors ${
        selected
          ? 'bg-cream/10 border-cream/40 text-cream'
          : 'bg-surface-2 border-line text-ink-3 hover:text-ink-2'
      }`}
    >
      {children}
    </button>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { get } from '../../lib/api';

/**
 * Live platform-stats block for the landing page.
 *
 * Pulls from GET /api/v1/stats (existing endpoint, extended with the totals
 * fields used here). Renders four cards: registered users, active workers,
 * active agents, completed tasks. Refetches every 30 seconds so a visitor
 * sitting on the page sees the numbers tick as activity happens.
 *
 * Visuals:
 *   - Numbers count up from 0 to their target the first time the block scrolls
 *     into view. Classic landing-page social-proof motion.
 *   - Subsequent value updates (from the 30s refetch) animate from the
 *     previous value to the new one, not from 0 — so a number going up by 1
 *     doesn't trigger a full re-roll.
 *   - The live indicator pulses while data is fresh.
 *   - Cards lift slightly on hover (desktop only — no hover state on touch).
 *
 * Respects prefers-reduced-motion by skipping the count animation entirely
 * and showing the final number as soon as the data lands.
 */

interface Stats {
  registeredUsers?: number;
  activeWorkers?: number;
  totalAgents?: number;
  completedTasks?: number;
  // Legacy fields the sidebar uses; we fall back to them if a new field is
  // missing so the block doesn't render zeros if the backend is stale.
  activeAgents?: number;
  openTasks?: number;
}

interface StatTile {
  label: string;
  value: number | undefined;
  sub?: string;
}

/**
 * Animate `value` whenever it changes — starting from the previous rendered
 * value, not from 0. The first reveal (when value goes from undefined → a
 * number) counts up from 0; subsequent updates roll from old → new.
 *
 * Uses requestAnimationFrame so we don't fight React's render loop or
 * accumulate setInterval drift. Cubic ease-out (slow finish) matches what
 * users intuit as a "counter settling" animation.
 */
function useCountAnimation(target: number | undefined, enabled: boolean, durationMs = 1100): number | undefined {
  const [display, setDisplay] = useState<number | undefined>(undefined);
  const fromRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target == null) return;
    if (!enabled) {
      // Animation off (not in view yet, or reduced motion): pin to target.
      setDisplay(target);
      return;
    }

    // Start from whatever we last showed (so a refresh from 7 → 8 ticks
    // one digit, not zero-to-eight). On first reveal, display is undefined
    // and we fall through to 0.
    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) {
      setDisplay(target);
      return;
    }

    const start = performance.now();
    function step(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      // Cubic ease-out: 1 - (1-t)^3
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + delta * eased;
      setDisplay(t === 1 ? target! : current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target!;
        rafRef.current = null;
      }
    }
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, enabled, durationMs]);

  return display;
}

/** Display helper — formats with thousands separator, rounds during animation. */
function formatCount(n: number | undefined): string {
  if (n == null) return '—';
  return Math.round(n).toLocaleString();
}

/** Single animated stat card. Owns its own count animation hook so all four
 *  tiles roll up independently and in parallel under the parent's stagger. */
function StatCard({ tile, animate, indexDelay }: { tile: StatTile; animate: boolean; indexDelay: number }) {
  const reduceMotion = useReducedMotion();
  // Hold off the count animation until the card has finished sliding in
  // under the parent's stagger — otherwise the digits roll up while the
  // card is still drifting in from below and the two motions blur together.
  const [readyToCount, setReadyToCount] = useState(false);
  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => setReadyToCount(true), indexDelay * 1000 + 200);
    return () => clearTimeout(t);
  }, [animate, indexDelay]);

  const displayed = useCountAnimation(
    tile.value,
    !reduceMotion && readyToCount,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: indexDelay }}
      whileHover={reduceMotion ? undefined : { y: -3, transition: { duration: 0.2 } }}
      className="bg-bg p-5 sm:p-7 cursor-default group transition-colors hover:bg-surface-2/50"
    >
      <div className="text-[10px] sm:text-[11px] font-mono uppercase tracking-widest text-ink-3 group-hover:text-ink-2 transition-colors">
        {tile.label}
      </div>
      <div className="text-3xl sm:text-4xl font-bold text-ink mt-2 sm:mt-3 leading-none tracking-tight tabular-nums">
        {formatCount(reduceMotion ? tile.value : displayed)}
      </div>
      {tile.sub && (
        <div className="text-[10px] sm:text-[11px] font-mono text-ink-3 mt-2 sm:mt-3">
          {tile.sub}
        </div>
      )}
    </motion.div>
  );
}

export function LandingStats() {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef, { once: true, margin: '-80px' });

  const { data } = useQuery<Stats>({
    queryKey: ['landing-stats'],
    queryFn: () => get<Stats>('/api/v1/stats'),
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const tiles: StatTile[] = [
    { label: 'Registered users', value: data?.registeredUsers, sub: 'posters · operators' },
    { label: 'Active workers',   value: data?.activeWorkers ?? data?.activeAgents, sub: 'agents running now' },
    { label: 'Active agents',    value: data?.totalAgents, sub: 'deployed all-time' },
    { label: 'Completed tasks',  value: data?.completedTasks, sub: 'verified on chain' },
  ];

  return (
    <section ref={containerRef} className="border-y border-line bg-surface/40">
      <div className="max-w-6xl mx-auto px-6 py-12 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-8 sm:mb-10"
        >
          <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-ink-3">
            {/* Pulsing dot — the same motion the hero badge uses, kept short
                so it reads as a heartbeat rather than a distraction. */}
            <motion.span
              className="w-1.5 h-1.5 bg-ok inline-block"
              animate={reduceMotion ? {} : { opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
            Live · 0G testnet
          </div>
        </motion.div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line">
          {tiles.map((t, i) => (
            <StatCard
              key={t.label}
              tile={t}
              animate={inView}
              indexDelay={i * 0.08}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { get } from '../../lib/api';

/**
 * Live platform-stats block for the landing page.
 *
 * Pulls from GET /api/v1/stats (existing endpoint, extended with the totals
 * fields used here). Renders four cards: registered users, active workers,
 * active agents, completed tasks. Refetches every 30 seconds so a visitor
 * sitting on the page sees the numbers tick up as activity happens.
 *
 * Mirrors the visual language of the rest of the landing page: hairline
 * borders, monospace label rule, big sans-serif numbers. No emoji or
 * decorative iconography — same restraint as the existing landing sections.
 */

interface Stats {
  // New fields (added to /api/v1/stats specifically for this block)
  registeredUsers?: number;
  activeWorkers?: number;
  totalAgents?: number;
  completedTasks?: number;
  // Legacy fields the sidebar uses; we fall back to them if a new field is
  // missing so the block doesn't render zeros if the backend is stale.
  activeAgents?: number;
  openTasks?: number;
}

function formatCount(n: number | undefined): string {
  if (n == null) return '—';
  // Three-digit grouping for legibility. Won't bother with K/M shorthand
  // until we have numbers big enough to warrant it.
  return n.toLocaleString();
}

interface StatTile {
  label: string;
  value: number | undefined;
  sub?: string;
}

export function LandingStats() {
  const reduceMotion = useReducedMotion();

  const { data } = useQuery<Stats>({
    queryKey: ['landing-stats'],
    queryFn: () => get<Stats>('/api/v1/stats'),
    refetchInterval: 30_000,
    // Keep the previous numbers on screen while a refetch is in flight so
    // the block never flashes back to "—" once it has data.
    staleTime: 30_000,
  });

  const tiles: StatTile[] = [
    {
      label: 'Registered users',
      value: data?.registeredUsers,
      sub: 'posters · operators',
    },
    {
      label: 'Active workers',
      value: data?.activeWorkers ?? data?.activeAgents,
      sub: 'agents running now',
    },
    {
      label: 'Active agents',
      value: data?.totalAgents,
      sub: 'deployed all-time',
    },
    {
      label: 'Completed tasks',
      value: data?.completedTasks,
      sub: 'verified on chain',
    },
  ];

  return (
    <section className="border-y border-line bg-surface/40">
      <div className="max-w-6xl mx-auto px-6 py-12 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-8 sm:mb-10"
        >
          <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-ink-3">
            <span className="w-1.5 h-1.5 bg-ok inline-block" />
            Live · 0G testnet
          </div>
        </motion.div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line">
          {tiles.map((t, i) => (
            <motion.div
              key={t.label}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: i * 0.06 }}
              className="bg-bg p-5 sm:p-7"
            >
              <div className="text-[10px] sm:text-[11px] font-mono uppercase tracking-widest text-ink-3">
                {t.label}
              </div>
              <div className="text-3xl sm:text-4xl font-bold text-ink mt-2 sm:mt-3 leading-none tracking-tight tabular-nums">
                {formatCount(t.value)}
              </div>
              {t.sub && (
                <div className="text-[10px] sm:text-[11px] font-mono text-ink-3 mt-2 sm:mt-3">
                  {t.sub}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

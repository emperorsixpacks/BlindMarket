import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { LogoMark } from './LogoMark';
import { get } from '../../lib/api';
import { useSocket } from '../../hooks/useSocket';

// Sidebar IA — pure A2A focus per the Track 3 brief. Human-facing nav items
// (task_feed, worker_view, agent_market, validators, leaderboard) are removed;
// their routes still exist as deep-links but aren't surfaced in nav. The four
// visible sections cover the agent-to-agent lifecycle end to end:
//   POST    → kick off an A2A task; review your posted ones
//   AGENTS  → deploy and manage the agents that will execute
//   A2A     → the agent-task board (browse / executions / register)
//   ACCOUNT → earnings + settings
const navGroups = [
  {
    label: 'docs',
    items: [
      { to: '/how-it-works', label: 'how_it_works' },
    ],
  },
  {
    label: 'post',
    items: [
      { to: '/tasks/new', label: 'post_task', exact: true },
      // Tasks the connected wallet has posted — useful for seeing settlement
      // status after the agent picks it up.
      { to: '/tasks/mine', label: 'my_tasks', exact: true },
    ],
  },
  {
    label: 'agents',
    items: [
      // /agents/deploy is a chooser page; /agents/deploy/ui and /sdk are the
      // actual flows. No `exact` so deploy_agent stays highlighted on all three.
      { to: '/agents/deploy', label: 'deploy_agent' },
      { to: '/agents/mine', label: 'my_agents', exact: true },
    ],
  },
  {
    label: 'a2a',
    items: [
      { to: '/a2a', label: 'agent_board', exact: true },
    ],
  },
  {
    label: 'account',
    items: [
      { to: '/earnings', label: 'earnings' },
      { to: '/settings', label: 'settings' },
    ],
  },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  const { data: stats, refetch } = useQuery({
    queryKey: ['stats'],
    queryFn: () => get<{ openTasks: number; activeAgents: number; activeValidators: number }>('/api/v1/stats'),
  });
  useSocket('platform', { 'stats:update': () => refetch() });

  return (
    <>
      {/* Mobile backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-30 md:hidden"
            aria-hidden
          />
        )}
      </AnimatePresence>

      <aside
        className={`w-[240px] h-screen fixed left-0 top-0 bg-surface border-r border-line flex flex-col z-40 transition-transform duration-200 ease-out md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Logo + close (mobile only) */}
        <div className="flex items-center justify-between px-6 h-16 border-b border-line">
          <Link to="/" className="flex items-center gap-3" onClick={onClose}>
            <LogoMark size={26} blade="var(--bb-ink)" slit="var(--bb-surface)" />
            <span className="text-sm font-mono font-bold text-ink uppercase tracking-wider">blindmarket</span>
          </Link>
          <button
            onClick={onClose}
            aria-label="close menu"
            className="md:hidden -mr-2 p-2 text-ink-3 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-4">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-6">
              {/* Section header — explicitly non-interactive. Slightly dimmer
                  weight, with a short underline rule + select-none so it
                  reads as a divider rather than a nav row. */}
              <div className="px-6 mb-3 select-none cursor-default">
                <span className="inline-block pb-1 border-b border-line text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-ink-3/80">
                  {group.label}
                </span>
              </div>
              {group.items.map((item) => {
                const active = item.exact
                  ? location.pathname === item.to
                  : item.to === '/'
                    ? location.pathname === '/'
                    : location.pathname === item.to || location.pathname.startsWith(item.to + '/');
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`relative block px-6 py-2 text-[13px] font-mono transition-colors duration-150 ${active ? 'text-ink' : 'text-ink-2 hover:text-ink hover:bg-surface-2'
                      }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-0 bg-surface-2 border-l-2 border-cream pointer-events-none"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    <span className="relative flex items-center">
                      {active && <span className="text-cream mr-1">&#9656;</span>}
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer status */}
        <div className="px-6 py-4 border-t border-line space-y-1">
          <div className="text-[10px] font-mono text-ink-3">v0.4.2 · testnet</div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-ok inline-block" />
            <span className="text-[10px] font-mono text-ok">tee online</span>
          </div>
          {stats && (
            <div className="text-[10px] font-mono text-ink-3 space-y-0.5 pt-1">
              <div>{stats.activeAgents} agents · {stats.openTasks} open tasks</div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

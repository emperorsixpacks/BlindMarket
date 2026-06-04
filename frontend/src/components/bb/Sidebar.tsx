import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { LogoMark } from './LogoMark';
import { Icon } from './Icon';
import { get } from '../../lib/api';
import { useSocket } from '../../hooks/useSocket';
import { isMainnet } from '../../config/constants';

// Sidebar IA — agent-to-agent lifecycle, top to bottom. Modernized: sans
// Title-Case labels, an icon per item, and the marketplace promoted to the
// top as the primary destination. Routes for removed human-facing surfaces
// still exist as deep-links; they're just not surfaced here.
type NavItem = { to: string; label: string; icon: string; exact?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: '',
    items: [
      { to: '/a2a', label: 'Marketplace', icon: 'briefcase', exact: true },
    ],
  },
  {
    label: 'Tasks',
    items: [
      { to: '/tasks/new', label: 'Post a task', icon: 'compose', exact: true },
      { to: '/tasks/mine', label: 'My tasks', icon: 'clock', exact: true },
      { to: '/tasks/templates', label: 'Templates', icon: 'list', exact: true },
    ],
  },
  {
    label: 'Agents',
    items: [
      { to: '/agents/browse', label: 'Browse agents', icon: 'search', exact: true },
      // /agents/deploy is the chooser; /ui and /sdk are children — no `exact`
      // so "Create agent" stays active across all three.
      { to: '/agents/deploy', label: 'Create agent', icon: 'user' },
      { to: '/agents/mine', label: 'My agents', icon: 'list', exact: true },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/messages', label: 'Messages', icon: 'compose', exact: true },
      { to: '/earnings', label: 'Earnings', icon: 'wallet', exact: true },
      { to: '/settings', label: 'Settings', icon: 'settings', exact: true },
    ],
  },
  {
    label: 'Docs',
    items: [
      { to: '/how-it-works', label: 'How it works', icon: 'shield', exact: true },
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
    queryFn: () => get<{
      openTasks: number;
      activeAgents: number;
      activeValidators: number;
      // Platform totals surfaced in the live-stats widget below. Optional so a
      // stale backend that predates these fields still renders (shows "—").
      completedTasks?: number;
      registeredUsers?: number;
      totalAgents?: number;
      activeWorkers?: number;
    }>('/api/v1/stats'),
  });
  useSocket('platform', { 'stats:update': () => refetch() });

  // Live platform counts for the footer widget. `activeWorkers` is the backend
  // alias of activeAgents (agents currently running); totalAgents is all agents
  // ever deployed. Labelled distinctly so the two don't read as the same stat.
  const liveStats: Array<{ label: string; value?: number; live?: boolean }> = [
    { label: 'Completed tasks', value: stats?.completedTasks },
    { label: 'Registered users', value: stats?.registeredUsers },
    { label: 'Agents running', value: stats?.activeWorkers ?? stats?.activeAgents, live: true },
    { label: 'Agents deployed', value: stats?.totalAgents },
  ];

  const isActive = (item: NavItem) =>
    item.exact
      ? location.pathname === item.to
      : location.pathname === item.to || location.pathname.startsWith(item.to + '/');

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
        {/* Brand */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-line">
          <Link to="/" className="flex items-center gap-2.5" onClick={onClose}>
            <LogoMark size={24} blade="var(--bb-ink)" slit="var(--bb-surface)" />
            <span className="text-sm font-semibold text-ink tracking-tight">BlindMarket</span>
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

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4">
          {navGroups.map((group, gi) => (
            <div key={group.label || `g${gi}`} className={group.label ? 'mb-1 mt-5 first:mt-0' : 'mb-1'}>
              {group.label && (
                <div className="px-5 mb-1.5 select-none cursor-default">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                    {group.label}
                  </span>
                </div>
              )}
              {group.items.map((item) => {
                const active = isActive(item);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex items-center gap-3 px-5 py-2 text-sm transition-colors duration-150 ${active ? 'text-ink font-medium' : 'text-ink-2 hover:text-ink hover:bg-surface-2'}`}
                  >
                    {active && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-0 bg-surface-2 border-l-2 border-cream pointer-events-none"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    <span className={`relative shrink-0 ${active ? 'text-cream' : 'text-ink-3'}`}>
                      <Icon name={item.icon} size={17} />
                    </span>
                    <span className="relative">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Live platform stats — compact widget. Shares the ['stats'] query
            above, so it updates live off the same stats:update socket event. */}
        <div className="px-5 py-4 border-t border-line">
          <div className="flex items-center gap-1.5 mb-2.5">
            <span className="w-1.5 h-1.5 bg-ok inline-block animate-bb-pulse" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Live platform</span>
          </div>
          <dl className="space-y-1.5">
            {liveStats.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1.5 min-w-0 text-[11px] text-ink-3">
                  {s.live && <span className="w-1 h-1 bg-ok inline-block shrink-0 animate-bb-pulse" />}
                  <span className="truncate">{s.label}</span>
                </dt>
                <dd className="text-[11px] font-medium text-ink tabular-nums shrink-0">
                  {s.value == null ? '—' : s.value.toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Footer status */}
        <div className="px-5 py-4 border-t border-line space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-ok inline-block" />
            <span className="text-[11px] text-ok">TEE online</span>
          </div>
          {stats && (
            <div className="text-[11px] text-ink-3">
              {stats.openTasks} open tasks
            </div>
          )}
          <div className="text-[10px] font-mono text-ink-3 pt-0.5">v0.4.2{!isMainnet && ' · testnet'}</div>
        </div>
      </aside>
    </>
  );
}

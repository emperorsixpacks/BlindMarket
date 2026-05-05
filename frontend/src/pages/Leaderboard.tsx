import { useLeaderboard } from '../hooks/useReputation';
import { Breadcrumb, PageHeader, StatCard, Tag } from '../components/bb';
import { truncateAddress } from '../lib/utils';
import { Link } from 'react-router-dom';

export default function Leaderboard() {
  const { data, isLoading } = useLeaderboard(50);
  const leaderboard = data?.leaderboard ?? [];

  return (
    <div>
      <Breadcrumb items={['marketplace', 'leaderboard']} />
      <PageHeader
        title="Reputation leaderboard"
        description="The top-performing workers and agents on the network."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 border border-line mb-8">
        <StatCard label="top score" value={leaderboard[0]?.decayedScore.toFixed(1) ?? '—'} sub="all time" />
        <div className="border-l border-line">
          <StatCard label="active workers" value={String(leaderboard.length)} sub="this week" subColor="ok" />
        </div>
        <div className="border-l border-line">
          <StatCard label="total tasks" value={String(leaderboard.reduce((acc, l) => acc + l.tasksCompleted, 0))} sub="across network" />
        </div>
        <div className="border-l border-line">
          <StatCard label="avg. rating" value="4.8" sub="high quality" subColor="ok" />
        </div>
      </div>

      <div className="border border-line">
        <div className="grid grid-cols-[60px_1fr_120px_120px_100px] gap-4 px-5 py-3 border-b border-line text-[11px] font-mono font-semibold uppercase tracking-widest text-ink-3">
          <span>rank</span>
          <span>identity</span>
          <span>reputation</span>
          <span>completed</span>
          <span>status</span>
        </div>

        {isLoading ? (
          <div className="px-5 py-20 text-center text-xs font-mono text-ink-3">Loading network data…</div>
        ) : leaderboard.length === 0 ? (
          <div className="px-5 py-20 text-center text-xs font-mono text-ink-3">No activity recorded yet.</div>
        ) : (
          leaderboard.map((entry, i) => (
            <div key={entry.address} className="grid grid-cols-[60px_1fr_120px_120px_100px] gap-4 px-5 py-4 border-b border-line last:border-b-0 text-[13px] font-mono items-center">
              <span className="text-ink-3">#{i + 1}</span>
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 bg-surface-2 border border-line flex items-center justify-center text-[10px] font-bold text-ink-3">
                  {entry.address.slice(2, 4).toUpperCase()}
                </div>
                <span className="text-ink truncate">{truncateAddress(entry.address)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-ink font-bold">{entry.decayedScore.toFixed(1)}</span>
                <span className={
                  (entry.decayFactor ?? 1) > 0.9 ? 'text-ok' :
                  (entry.decayFactor ?? 1) > 0.5 ? 'text-warn' :
                  'text-err'
                }>
                  {(entry.decayFactor ?? 1) > 0.9 ? '↑' : (entry.decayFactor ?? 1) > 0.5 ? '→' : '↓'}
                </span>
              </div>
              <span className="text-ink-3">{entry.tasksCompleted} tasks</span>
              <Tag tone={(entry.decayFactor ?? 1) > 0.5 ? 'ok' : 'neutral'}>
                {(entry.decayFactor ?? 1) > 0.9 ? 'active' : 'dormant'}
              </Tag>
            </div>
          ))
        )}
      </div>
      
      <div className="mt-6 flex justify-center">
        <Link to="/tasks" className="text-xs font-mono text-cream hover:underline">
          browse tasks to build your reputation →
        </Link>
      </div>
    </div>
  );
}

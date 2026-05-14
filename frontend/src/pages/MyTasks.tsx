import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Breadcrumb, PageHeader, SectionRule, Tag, StatCard } from '../components/bb';
import { useSocket } from '../hooks/useSocket';
import { useBidWatcher } from '../hooks/useBidWatcher';
import { API_BASE_URL } from '../config/constants';

interface Task {
  taskId: string;
  category: string;
  locationZone: string;
  reward: string;
  status: number;
  agent: string;
  worker?: string;
  createdAt?: string;
  requiredCapabilities?: string[];
  // Whether the backend's a2aStore has a meta entry for this task. False
  // means the task is invisible to executor agents (created before the
  // current A2A code path was wired up — see GET /api/v1/tasks enrichment).
  a2aIndexed?: boolean;
}

const STATUS_LABELS: Record<number, string> = {
  0: 'open', 1: 'assigned', 2: 'submitted', 3: 'verified', 4: 'completed', 5: 'cancelled', 6: 'disputed',
};
const STATUS_TONE: Record<number, 'ok' | 'warn' | 'err' | 'neutral'> = {
  0: 'neutral', 1: 'warn', 2: 'warn', 3: 'ok', 4: 'ok', 5: 'err', 6: 'err',
};

function formatReward(wei: string) {
  try { return `$${(Number(BigInt(wei)) / 1e18).toFixed(2)}`; } catch { return wei; }
}

export default function MyTasks() {
  const { address } = useAccount();
  const qc = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ['my-tasks', address],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/tasks?limit=100`);
      const json = await res.json();
      if (!json.success) return [];
      return (json.data?.tasks ?? []).filter(
        (t: Task) => t.agent?.toLowerCase() === address?.toLowerCase()
      );
    },
    enabled: !!address,
  });

  useSocket('tasks', {
    'task:created': () => qc.invalidateQueries({ queryKey: ['my-tasks', address] }),
    'task:assigned': () => qc.invalidateQueries({ queryKey: ['my-tasks', address] }),
    'task:completed': () => qc.invalidateQueries({ queryKey: ['my-tasks', address] }),
  });

  // Just-in-time wrap loop for tasks posted from this browser. Polls every
  // task with a stashed AES key for new bidders and ECIES-wraps the key to
  // them. Active for as long as this page is mounted.
  useBidWatcher(!!address);

  const open = tasks.filter(t => t.status === 0).length;
  const active = tasks.filter(t => t.status === 1 || t.status === 2).length;
  const completed = tasks.filter(t => t.status === 4).length;
  const totalSpent = tasks
    .filter(t => t.status === 4)
    .reduce((s, t) => s + Number(BigInt(t.reward || '0')) / 1e18, 0);

  return (
    <div>
      <Breadcrumb items={['tasks', 'mine']} />
      <PageHeader
        title="My tasks"
        description="Tasks you've posted — track status, assignments, and completions."
        right={
          <Link to="/tasks/new" className="px-4 py-2 border border-cream text-[11px] font-mono text-cream hover:bg-cream hover:text-bg transition-colors uppercase tracking-widest">
            + post task
          </Link>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 border border-line mb-8">
        <StatCard label="open" value={String(open)} sub="awaiting worker" />
        <div className="border-l border-line"><StatCard label="active" value={String(active)} sub="in progress" subColor="warn" /></div>
        <div className="border-t border-l-0 sm:border-t-0 sm:border-l border-line"><StatCard label="completed" value={String(completed)} sub="all time" subColor="ok" /></div>
        <div className="border-t border-l border-line sm:border-t-0"><StatCard label="total spent" value={`$${totalSpent.toFixed(2)}`} sub="USDC paid out" /></div>
      </div>

      <div className="border border-line">
        <SectionRule num="01" title="posted tasks" side={`${tasks.length} total`} />

        {!address ? (
          <div className="px-5 py-10 text-center text-xs font-mono text-ink-3">connect wallet to see your tasks</div>
        ) : isLoading ? (
          <div className="px-5 py-10 text-center text-xs font-mono text-ink-3">loading…</div>
        ) : tasks.length === 0 ? (
          <div className="px-5 py-10 flex flex-col items-center gap-3">
            <p className="text-xs font-mono text-ink-3">no tasks posted yet.</p>
            <Link to="/tasks/new" className="text-xs font-mono text-cream hover:underline">post your first task →</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line border-t border-line">
            {tasks.map(t => {
              // A task is "stranded" when it's still Funded on chain but the
              // A2A executor board doesn't know about it — agents can never
              // accept it. Only flag for tasks that would otherwise look
              // acceptable (open / no worker), to avoid confusing completed
              // history with a problem.
              const isStranded = t.a2aIndexed === false && t.status === 0;
              return (
                <Link
                  key={t.taskId}
                  to={`/tasks/${t.taskId}`}
                  className={`group bg-bg hover:bg-surface-2 transition-colors p-5 flex flex-col gap-3 min-h-[180px] ${
                    isStranded ? 'border-l-2 border-l-warn' : ''
                  }`}
                >
                  {/* Top row — id + status */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-ink-3">#{t.taskId}</span>
                    <div className="flex items-center gap-2">
                      {isStranded && <Tag tone="warn">stranded</Tag>}
                      <Tag tone={STATUS_TONE[t.status] ?? 'neutral'}>{STATUS_LABELS[t.status] ?? t.status}</Tag>
                    </div>
                  </div>

                  {/* Title */}
                  <div className="flex-1">
                    <div className="text-sm font-mono text-ink">{t.category}</div>
                    <div className="text-[11px] font-mono text-ink-3 mt-0.5">{t.locationZone || 'global'}</div>
                    {t.requiredCapabilities && t.requiredCapabilities.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {t.requiredCapabilities.slice(0, 4).map(c => (
                          <span key={c} className="text-[10px] font-mono text-ink-3 border border-line px-1.5 py-0.5">
                            {c.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                    {isStranded && (
                      <div className="mt-3 text-[10px] font-mono text-warn leading-relaxed">
                        not on the agent board — created before the current A2A indexer was wired up.
                        no agent will pick this up. cancel & refund to reclaim escrow.
                      </div>
                    )}
                  </div>

                  {/* Bottom row — reward + worker + view affordance */}
                  <div className="pt-3 border-t border-line flex items-end justify-between">
                    <div>
                      <div className="text-lg font-mono font-semibold text-cream leading-none">{formatReward(t.reward)}</div>
                      <div className="text-[10px] font-mono text-ink-3 mt-1.5 uppercase tracking-widest">
                        {t.worker
                          ? `worker · ${t.worker.slice(0, 6)}…${t.worker.slice(-4)}`
                          : 'no worker yet'}
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-ink-3 group-hover:text-cream transition-colors">view →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

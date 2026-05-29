import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Breadcrumb,
  PageHeader,
  SectionRule,
  Button,
  Tag,
  DataTable,
  type Column,
} from '../components/bb';
import { searchAgents, type AgentSearchResult } from '../services/marketplace';
import { AGENT_CAPABILITIES } from '../config/capabilities';
import { truncateAddress } from '../lib/utils';

export default function AgentMarketplace() {
  const [capability, setCapability] = useState('');
  const [minRating, setMinRating] = useState(0);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['agent-search', capability, minRating],
    queryFn: () => searchAgents(capability || undefined, minRating || undefined, 50),
  });

  const columns: Column<AgentSearchResult>[] = [
    {
      key: 'name',
      header: 'Agent',
      width: '1fr',
      primary: true,
      cell: (r) => (
        <div>
          <div className="text-ink font-medium truncate">{r.name}</div>
          <div className="text-[11px] font-mono text-ink-3 mt-0.5">{truncateAddress(r.address)}</div>
        </div>
      ),
    },
    {
      key: 'capabilities',
      header: 'Capabilities',
      width: '1fr',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.capabilities.slice(0, 3).map((c) => (
            <Tag key={c} tone="info">{c.replace(/_/g, ' ')}</Tag>
          ))}
          {r.capabilities.length > 3 && (
            <span className="text-[11px] text-ink-3">+{r.capabilities.length - 3}</span>
          )}
        </div>
      ),
    },
    {
      key: 'rating',
      header: 'Rating',
      width: '80px',
      cell: (r) => (
        <span className="font-mono text-ink">
          {r.totalReviews > 0 ? `${r.avgRating.toFixed(1)}` : '—'}
        </span>
      ),
    },
    {
      key: 'tasks',
      header: 'Tasks',
      width: '70px',
      align: 'right',
      cell: (r) => <span className="font-mono text-ink-3">{r.tasksCompleted}</span>,
    },
    {
      key: 'badges',
      header: 'Badges',
      width: '100px',
      trailing: true,
      cell: (r) => r.badges.length > 0
        ? <span className="text-ok text-xs">✓ {r.badges.length} verified</span>
        : <span className="text-ink-3 text-xs">—</span>,
    },
  ];

  return (
    <div>
      <Breadcrumb items={['marketplace', 'agents', 'browse']} />
      <PageHeader
        title="Browse agents"
        description="Discover agents by capability and reputation. Click through to view their details and past work."
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 mb-8">
        <div className="flex-1 min-w-[200px]">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3 mb-1.5">Capability</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCapability('')}
              className={`px-2.5 py-1 text-xs border transition-colors ${!capability ? 'bg-cream/10 border-cream/40 text-cream' : 'bg-surface-2 border-line text-ink-3 hover:text-ink-2'}`}
            >
              All
            </button>
            {AGENT_CAPABILITIES.map((c) => (
              <button
                key={c}
                onClick={() => setCapability(capability === c ? '' : c)}
                className={`px-2.5 py-1 text-xs border transition-colors ${capability === c ? 'bg-cream/10 border-cream/40 text-cream' : 'bg-surface-2 border-line text-ink-3 hover:text-ink-2'}`}
              >
                {c.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
        <div className="w-[140px]">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3 mb-1.5">Min rating</div>
          <select
            value={minRating}
            onChange={(e) => setMinRating(Number(e.target.value))}
            className="w-full bg-surface-2 border border-line px-3 py-1.5 text-xs text-ink font-mono"
          >
            <option value={0}>Any</option>
            <option value={3}>★ 3+</option>
            <option value={4}>★★ 4+</option>
            <option value={4.5}>★★★ 4.5+</option>
          </select>
        </div>
      </div>

      <SectionRule num="01" title="Agents" side={data ? `${data.total} found` : undefined} />
      <DataTable<AgentSearchResult>
        columns={columns}
        rows={data?.agents}
        rowKey={(r) => r.address}
        rowHref={(r) => `/agents/${r.address}`}
        loading={isLoading}
        loadingLabel="Searching agents…"
        error={isError}
        onRetry={() => refetch()}
        empty={{
          icon: 'search',
          title: 'No agents found',
          description: capability
            ? `No agents match the "${capability}" capability. Try a different filter.`
            : 'No agents are registered on the marketplace yet.',
          action: (
            <Link to="/agents/deploy">
              <Button variant="outline" label="Deploy an agent" size="sm" />
            </Link>
          ),
        }}
      />
    </div>
  );
}

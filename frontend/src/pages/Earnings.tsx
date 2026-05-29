import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import {
  Breadcrumb,
  PageHeader,
  SectionRule,
  Panel,
  StatCard,
  Tag,
  StatusTag,
  DataTable,
  type Column,
} from '../components/bb';
import { useAccountingEntries, useAccountingSummary } from '../hooks/useAccounting';
import { useAuth } from '../context/AuthContext';
import type { Transaction } from '../services/accounting';
import { API_BASE_URL } from '../config/constants';

type Tab = 'transactions' | 'my_agents';

const TABS: { id: Tab; label: string }[] = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'my_agents', label: 'My agents' },
];

type Agent = {
  id: string;
  name: string;
  walletAddress: string;
  status: string;
  inftTokenId?: number;
};

function format0G(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : n > 0 ? '+' : '';
  return `${sign}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} 0G`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const delta = Date.now() - d.getTime();
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function shortHash(h: string | null): string {
  if (!h) return '—';
  const s = h.replace(/^0x/, '');
  return `0x${s.slice(0, 4)}…${s.slice(-4)}`;
}

function typeTone(type: string): 'err' | 'warn' | 'neutral' | 'ok' {
  if (type === 'slash') return 'err';
  if (type === 'fee') return 'warn';
  if (type === 'payout') return 'ok';
  return 'neutral';
}

/** Title Case the tx type for display (payout/fee/slash/…). */
function typeLabel(type: string): string {
  if (!type) return '—';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function amountClass(n: number): string {
  return n > 0 ? 'text-ok' : n < 0 ? 'text-err' : 'text-ink-3';
}

export default function Earnings() {
  const [tab, setTab] = useState<Tab>('transactions');
  const { isAuthenticated } = useAuth();
  const { address } = useAccount();
  const { data: summary, isLoading: summaryLoading } = useAccountingSummary();
  const { data: entriesRes, isLoading: entriesLoading, error: entriesError } = useAccountingEntries();
  const { data: agents, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents', address],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/agents?owner=${address}`);
      const json = await res.json();
      return json.success ? (json.data as Agent[]) : [];
    },
    enabled: !!address,
  });

  const entries: Transaction[] = entriesRes?.transactions ?? [];
  const pending = entries.filter((e) => e.status === 'pending');

  const pendingColumns: Column<Transaction>[] = [
    {
      key: 'task',
      header: 'Task',
      width: '90px',
      primary: true,
      cell: (p) => <span className="font-mono text-ink-2">{p.task_id ? `#${p.task_id}` : '—'}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      width: '110px',
      cell: (p) => <Tag tone={typeTone(p.type)}>{typeLabel(p.type)}</Tag>,
    },
    {
      key: 'amount',
      header: 'Amount',
      width: '130px',
      align: 'right',
      cell: (p) => <span className="font-mono font-semibold text-ink">{format0G(p.amount)}</span>,
    },
    {
      key: 'fee',
      header: 'Fee',
      width: '120px',
      align: 'right',
      cell: (p) => <span className="font-mono text-ink-3">{format0G(p.fee)}</span>,
    },
    {
      key: 'tx',
      header: 'Tx hash',
      width: '1fr',
      cell: (p) => <span className="font-mono text-ink-3">{shortHash(p.tx_hash)}</span>,
    },
    {
      key: 'submitted',
      header: 'Submitted',
      width: '110px',
      align: 'right',
      cell: (p) => <span className="font-mono text-ink-3">{formatTime(p.created_at)}</span>,
    },
  ];

  const txColumns: Column<Transaction>[] = [
    {
      key: 'time',
      header: 'Time',
      width: '110px',
      primary: true,
      cell: (tx) => <span className="font-mono text-ink-2">{formatTime(tx.created_at)}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      width: '100px',
      cell: (tx) => <Tag tone={typeTone(tx.type)}>{typeLabel(tx.type)}</Tag>,
    },
    {
      key: 'ref',
      header: 'Ref',
      width: '70px',
      cell: (tx) => <span className="font-mono text-ink-3">{tx.task_id ? `#${tx.task_id}` : '—'}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      width: '120px',
      align: 'right',
      cell: (tx) => <span className={`font-mono font-semibold ${amountClass(tx.amount)}`}>{format0G(tx.amount)}</span>,
    },
    {
      key: 'net',
      header: 'Net',
      width: '110px',
      align: 'right',
      cell: (tx) => <span className="font-mono text-ink-3">{format0G(tx.net)}</span>,
    },
    {
      key: 'tx',
      header: 'Tx hash',
      width: '1fr',
      cell: (tx) => <span className="font-mono text-ink-3">{shortHash(tx.tx_hash)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '90px',
      trailing: true,
      align: 'right',
      cell: (tx) => <StatusTag status={tx.status} />,
    },
  ];

  const agentColumns: Column<Agent>[] = [
    {
      key: 'agent',
      header: 'Agent',
      width: '1fr',
      primary: true,
      cell: (a) => <span className="font-semibold text-ink">{a.name}</span>,
    },
    {
      key: 'wallet',
      header: 'Wallet',
      width: '160px',
      cell: (a) => (
        <span className="font-mono text-ink-3">
          {a.walletAddress.slice(0, 8)}…{a.walletAddress.slice(-4)}
        </span>
      ),
    },
    {
      key: 'inft',
      header: 'INFT',
      width: '100px',
      cell: (a) => <span className="font-mono text-ink-3">{a.inftTokenId != null ? `#${a.inftTokenId}` : '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '90px',
      trailing: true,
      align: 'right',
      cell: (a) => <StatusTag status={a.status} />,
    },
  ];

  return (
    <div>
      <Breadcrumb items={['account', 'earnings']} />
      <PageHeader
        title="Earnings"
        description="Wallet balance, payouts, and withdrawal history."
      />

      {!isAuthenticated && (
        <div className="mb-6 px-4 py-3 border border-line bg-surface-2 text-xs text-ink-3 leading-relaxed">
          Connect your wallet to see your earnings. Showing anonymized totals only.
        </div>
      )}

      {/* Stat cards — live from accounting API */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 border border-line mb-8">
        <StatCard
          label="Total earned"
          value={summaryLoading ? '…' : format0G(summary?.totalEarned)}
          sub={summary && summary.taskCount > 0 ? `${summary.taskCount} tasks` : 'Across all time'}
        />
        <div className="border-l border-line">
          <StatCard
            label="Net revenue"
            value={summaryLoading ? '…' : format0G(summary?.netRevenue)}
            sub="After fees"
            subColor="ok"
          />
        </div>
        <div className="border-l border-line">
          <StatCard
            label="Total fees"
            value={summaryLoading ? '…' : format0G(summary?.totalFees)}
            sub="15% platform"
            subColor="warn"
          />
        </div>
        <div className="border-l border-line">
          <StatCard
            label="Pending"
            value={String(pending.length)}
            sub="Unresolved"
            subColor={pending.length > 0 ? 'warn' : 'ok'}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-line mb-8">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`pb-3 -mb-px text-sm border-b-2 transition-colors ${
              tab === t.id
                ? 'text-ink font-medium border-cream'
                : 'text-ink-3 border-transparent hover:text-ink-2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'my_agents' ? (
        <Panel>
          <SectionRule num="01" title="My agents" side={`${agents?.length ?? 0} deployed`} />
          <div className="mt-4">
            <DataTable<Agent>
              columns={agentColumns}
              rows={address ? agents : []}
              rowKey={(a) => a.id}
              loading={agentsLoading}
              loadingLabel="Loading agents…"
              empty={
                !address
                  ? {
                      icon: 'wallet',
                      title: 'Connect your wallet',
                      description: 'Connect a wallet to see the agents you’ve deployed.',
                    }
                  : {
                      icon: 'user',
                      title: 'No agents deployed',
                      description: 'Register an executor with the CLI: blind register --name my-agent',
                    }
              }
            />
          </div>
        </Panel>
      ) : (
        <>
          {/* Pending payments */}
          <div className="mb-8">
            <SectionRule num="01" title="Pending payments" side={`${pending.length}`} />
            <div className="mt-4">
              <DataTable<Transaction>
                columns={pendingColumns}
                rows={pending}
                rowKey={(p) => String(p.id)}
                loading={entriesLoading}
                loadingLabel="Loading payments…"
                empty={{
                  icon: 'clock',
                  title: 'No pending payments',
                  description: 'Settled payouts appear in the transaction log below.',
                }}
              />
            </div>
          </div>

          {/* Transaction log */}
          <Panel>
            <SectionRule num="02" title="Transaction log" side={`${entries.length} entries`} />
            <div className="mt-4">
              {entriesError ? (
                <div className="border border-line px-5 py-8 text-center text-xs font-mono text-err break-all">
                  Failed to load accounting: {(entriesError as Error).message}
                </div>
              ) : (
                <DataTable<Transaction>
                  columns={txColumns}
                  rows={entries}
                  rowKey={(tx) => String(tx.id)}
                  loading={entriesLoading}
                  loadingLabel="Loading transactions…"
                  empty={{
                    icon: 'chart',
                    title: 'No transactions yet',
                    description: 'Complete or post a task to begin building your ledger.',
                  }}
                />
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

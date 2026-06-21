import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useBalance, useWalletClient } from 'wagmi';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BrowserProvider, parseEther } from 'ethers';
import { useCurrentAccount, useSuiClient, useSignAndExecuteTransaction, useSignPersonalMessage } from '@mysten/dapp-kit';
import {
  Breadcrumb,
  PageHeader,
  SectionRule,
  Tag,
  StatCard,
  Button,
  FormField,
  FormInput,
  FormTextarea,
  StatusTag,
  LoadingState,
  EmptyState,
  ErrorState,
  Icon,
} from '../components/bb';
import { truncateAddress } from '../lib/utils';
import { get, authedPatch, authedPost } from '../lib/api';
import { API_BASE_URL } from '../config/constants';
import { AGENT_CAPABILITIES } from '../config/capabilities';
import { useChainAddress } from '../hooks/useChainWallet';
import { getNativeCurrency } from '../config/constants';
import { buildSuiTransferCoin } from '../lib/suiTxBuilder';
import {
  getAgentReviews,
  submitReview,
  getAgentBadges,
  getWebhooks,
  registerWebhook as apiRegisterWebhook,
  deleteWebhook,
} from '../services/marketplace';
import type { AgentReview, AgentReviewStats, AgentBadge, AgentWebhook } from '../services/marketplace';

// Top-up amount when the agent runs low on gas. Same default as the deploy
// funding step — round trip + LLM call + submitEvidence costs ~0.0004 0G, so
// 0.005 0G covers ~125 tasks before the next top-up.
const TOP_UP_AMOUNT = '0.005';
const SUI_TOP_UP_AMOUNT = '50000000'; // 0.05 SUI in MIST (9 decimals)

// Below this the agent can't reliably pay for a submitEvidence + a USDC sweep
// tx. UI surfaces a "Top up gas" call to action when balance is under this.
const LOW_GAS_THRESHOLD = 0.005;
const SUI_LOW_GAS_THRESHOLD = 0.005; // 0.005 SUI

interface AgentTool {
  type: string; name: string; description: string; url?: string; endpointUrl?: string; method?: string; toolName?: string;
  headers?: { name: string; value: string; isSensitive: boolean }[];
}
interface AgentDetails {
  id: string; name: string; provider: string; model: string; status: string;
  ownerAddress: string; deployedAt: string; instructions: string;
  walletAddress?: string; publicKey?: string; inftTokenId?: number;
  tasksCompleted?: number; totalEarned?: string; tools?: AgentTool[];
  capabilities?: string[];
  minReward?: string;
  chainType?: 'evm' | 'sui';
  reputation?: { score: number; avgScore: number; tasksCompleted: number; disputes: number };
  decayedReputation?: { rawScore: number; decayedScore: number; tasksCompleted: number; disputes: number };
}

import AgentMetricsPanel from '../components/AgentMetricsPanel';

type Tab = 'logs' | 'tools' | 'tasks' | 'reviews' | 'webhooks' | 'edit' | 'metrics';

const TAB_LABELS: Record<Tab, string> = {
  logs: 'Logs',
  tools: 'Tools',
  tasks: 'Tasks',
  reviews: 'Reviews',
  webhooks: 'Webhooks',
  edit: 'Edit',
  metrics: 'Metrics',
};

const ACTION_LABELS: Record<'start' | 'pause' | 'stop' | 'restart', string> = {
  start: 'Start',
  pause: 'Pause',
  stop: 'Stop',
  restart: 'Restart',
};

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const address = useChainAddress();
  const { data: walletClient } = useWalletClient();
  const qc = useQueryClient();

  // SUI wallet
  const suiAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const [agent, setAgent] = useState<AgentDetails | null>(null);
  // Detect agent wallet type — use explicit chainType if available,
  // fall back to address format detection for legacy agents.
  const isSui = agent?.chainType
    ? agent.chainType === 'sui'
    : agent?.walletAddress?.length === 66 && agent.walletAddress.startsWith('0x');

  console.log('[AgentDetail] walletAddress:', agent?.walletAddress, 'length:', agent?.walletAddress?.length, 'chainType:', agent?.chainType, '=> isSui:', isSui);

  const agentCurrency = getNativeCurrency(isSui ? 'sui' : 'og');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('logs');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Edit state
  const [editInstructions, setEditInstructions] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editCapabilities, setEditCapabilities] = useState<string[]>([]);
  const [editMinReward, setEditMinReward] = useState('');

  // Reviews state
  const [reviews, setReviews] = useState<AgentReview[]>([]);
  const [reviewStats, setReviewStats] = useState<AgentReviewStats | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitError, setReviewSubmitError] = useState('');

  // Badges state
  const [badges, setBadges] = useState<AgentBadge[]>([]);

  // Gas-management UI state — separate from the agent's start/pause/stop
  // actions so the buttons can show their own progress without interfering.
  const [topUpStatus, setTopUpStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [topUpError, setTopUpError] = useState('');
  const [withdrawStatus, setWithdrawStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [withdrawInfo, setWithdrawInfo] = useState<{ txHash: string; amount: string } | null>(null);
  const [withdrawError, setWithdrawError] = useState('');

  // Owner-link recovery state — for the "deployed with one wallet, signed in
  // as another" lock-out. Drives the inline recovery button in the action-error
  // banner (signature-gated POST /agents/:id/link-owner).
  const [linkStatus, setLinkStatus] = useState<'idle' | 'signing' | 'linking' | 'error'>('idle');
  const [linkError, setLinkError] = useState('');

  // EVM balance (for 0G chain)
  const { data: evmBalance, refetch: refetchEvmBalance } = useBalance({
    address: agent?.walletAddress as `0x${string}` | undefined,
    query: { enabled: !!agent?.walletAddress && !isSui },
  });

  // SUI balance
  const [suiBalanceMist, setSuiBalanceMist] = useState<string>('0');
  useEffect(() => {
    if (!isSui || !agent?.walletAddress) { setSuiBalanceMist('0'); return; }
    let cancelled = false;
    console.log('[AgentDetail] fetching SUI balance for', agent.walletAddress);
    suiClient.getBalance({ owner: agent.walletAddress })
      .then(r => { console.log('[AgentDetail] SUI balance result:', r.totalBalance); if (!cancelled) setSuiBalanceMist(r.totalBalance); })
      .catch(err => { console.warn('[AgentDetail] SUI balance failed:', err); if (!cancelled) setSuiBalanceMist('0'); });
    return () => { cancelled = true; };
  }, [isSui, agent?.walletAddress, suiClient]);

  const refetchSuiBalance = useCallback(() => {
    if (!isSui || !agent?.walletAddress) { setSuiBalanceMist('0'); return; }
    suiClient.getBalance({ owner: agent.walletAddress })
      .then(r => setSuiBalanceMist(r.totalBalance))
      .catch(() => setSuiBalanceMist('0'));
  }, [isSui, agent?.walletAddress, suiClient]);

  const balanceEther = isSui
    ? parseInt(suiBalanceMist) / (10 ** agentCurrency.decimals)
    : evmBalance ? parseFloat(evmBalance.formatted) : 0;
  const balanceSymbol = agentCurrency.symbol;
  const isLowGas = isSui
    ? balanceEther < SUI_LOW_GAS_THRESHOLD
    : !!evmBalance && balanceEther < LOW_GAS_THRESHOLD;

  const refetchBalance = useCallback(() => {
    if (isSui) return refetchSuiBalance();
    refetchEvmBalance();
  }, [isSui, refetchSuiBalance, refetchEvmBalance]);

  const loadAgent = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setFetchError(false);
    get<AgentDetails>(`/api/v1/agents/${id}`)
      .then(data => {
        setAgent(data);
        setEditInstructions(data.instructions ?? '');
        setEditModel(data.model ?? '');
        setEditCapabilities(data.capabilities ?? []);
        setEditMinReward(
          data.minReward
            ? (BigInt(data.minReward) / 10n ** 18n).toString()
            : '',
        );
      })
      // A rejected fetch can't tell 404 from a transient 500/network drop, so
      // surface a retryable error rather than masquerading as "not found".
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadAgent(); }, [loadAgent]);

  useEffect(() => {
    if (!agent?.walletAddress) return;
    let cancelled = false;
    getAgentBadges(agent.walletAddress).then(b => { if (!cancelled) setBadges(b); }).catch(() => {});
    return () => { cancelled = true; };
  }, [agent?.walletAddress]);

  useEffect(() => {
    if (!agent?.walletAddress) return;
    let cancelled = false;
    getAgentReviews(agent.walletAddress, 20)
      .then((result) => {
        if (!cancelled) { setReviews(result.reviews); setReviewStats(result.stats); }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [agent?.walletAddress]);

  useEffect(() => {
    if (!id) return;
    const es = new EventSource(`${API_BASE_URL}/api/v1/agents/${id}/logs`);
    es.onmessage = e => {
      try { setLogs(prev => [...prev.slice(-199), JSON.parse(e.data)]); } catch { }
    };
    return () => es.close();
  }, [id]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const scrollToBottom = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      setAutoScroll(true);
    }
  };

  const handleLogScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    setAutoScroll(scrollTop + clientHeight >= scrollHeight - 20);
  };

  const action = useMutation({
    mutationFn: (act: 'start' | 'pause' | 'stop' | 'restart') =>
      authedPost<AgentDetails>(`/api/v1/agents/${id}/${act}`, {}),
    onSuccess: (data) => { setAgent(data); qc.invalidateQueries({ queryKey: ['my-agents'] }); },
  });

  // Signature-gated owner-link recovery. When start/stop 403s because the agent
  // was deployed with a different wallet than the current Privy sign-in, the
  // user proves control of the owner wallet (their active wagmi wallet) by
  // signing a server nonce. That adds their Privy identity to authorizedOwners,
  // after which authorizeOwner stops rejecting them. We then retry the action.
  async function handleLinkOwner() {
    setLinkStatus('signing');
    setLinkError('');
    try {
      const challenge = await authedPost<{ nonce: string; message: string; ownerAddress: string }>(
        `/api/v1/agents/${id}/link-owner/challenge`,
        {},
      );

      let signature: string;
      if (isSui) {
        // SUI wallet: try signing with @mysten/dapp-kit.
        console.log('[link-owner] using SUI signPersonalMessage, account:', suiAccount?.address);
        const result = await signPersonalMessage({
          message: new TextEncoder().encode(challenge.message),
        });
        console.log('[link-owner] SUI signature base64:', result.signature);
        signature = result.signature;
      } else {
        // EVM wallet: sign with wagmi/ethers (EIP-191)
        if (!walletClient) throw new Error('Wallet not connected');
        signature = await walletClient.signMessage({ message: challenge.message });
      }

      setLinkStatus('linking');
      await authedPost(`/api/v1/agents/${id}/link-owner`, { nonce: challenge.nonce, signature });
      setLinkStatus('idle');
      // Refresh the record (now carries authorizedOwners) and retry whatever
      // action triggered the lock-out (defaults to start).
      try { setAgent(await get<AgentDetails>(`/api/v1/agents/${id}`)); } catch { /* non-blocking */ }
      action.mutate(action.variables ?? 'start');
    } catch (err) {
      setLinkError((err as Error).message || 'Could not link this wallet');
      setLinkStatus('error');
    }
  }

  // authedPatch so the Privy JWT flows to the backend, where requireAuth +
  // authorizeOwner verify the caller (no more plaintext ownerAddress claim).
  const save = useMutation({
    mutationFn: () =>
      authedPatch<AgentDetails>(`/api/v1/agents/${id}`, {
        instructions: editInstructions,
        model: editModel,
        capabilities: editCapabilities,
        minReward: editMinReward
          ? (BigInt(Math.round(Number(editMinReward) * 1e18))).toString()
          : undefined,
      }),
    onSuccess: (data) => { setAgent(data); setTab('logs'); },
  });

  // Owner-signed transfer from owner wallet → agent wallet. No backend
  // involvement; same primitive as the deploy-funding step. We refresh the
  // balance after the tx confirms so the UI tile updates immediately
  // instead of waiting on a poll cycle.
  async function handleTopUp() {
    if (!address || !agent?.walletAddress) return;
    setTopUpStatus('sending');
    setTopUpError('');
    try {
      if (isSui) {
        if (!suiAccount) throw new Error('SUI wallet not connected');
        const tx = buildSuiTransferCoin(agent.walletAddress, SUI_TOP_UP_AMOUNT);
        await signAndExecute({ transaction: tx });
      } else {
        if (!walletClient) throw new Error('EVM wallet not connected');
        const provider = new BrowserProvider(walletClient.transport);
        const signer = await provider.getSigner();
        const tx = await signer.sendTransaction({
          to: agent.walletAddress,
          value: parseEther(TOP_UP_AMOUNT),
        });
        await tx.wait();
      }
      await refetchBalance();
      setTopUpStatus('idle');
    } catch (err) {
      setTopUpError((err as Error).message || 'Top-up failed');
      setTopUpStatus('error');
    }
  }

  // Backend signs the withdrawal tx using the agent's stored rawPrivateKey and
  // sends funds back to the owner. Handles both native 0G and ERC20 tokens
  // via the single /withdraw endpoint — omit tokenAddress for native 0G sweep,
  // or pass a specific ERC20 address to withdraw that token.
  //
  // Uses authedPost so the JWT (Privy identity) flows to the backend, where
  // requireAuth + authorizeOwner verify the caller is the agent's owner.
  // Refuses while the agent is running to avoid racing with in-flight txs.
  async function handleWithdraw() {
    if (!address || !id) return;
    if (!confirm(`Withdraw funds from this agent's wallet back to ${address.slice(0, 8)}…? This cannot be undone.`)) return;
    setWithdrawStatus('sending');
    setWithdrawError('');
    try {
      const data = await authedPost<{ txHash: string; amountSent: string; amountFormatted?: string; recipient: string }>(
        `/api/v1/agents/${id}/withdraw`,
        {},
      );
      const amount = data.amountFormatted ?? data.amountSent;
      setWithdrawInfo({ txHash: data.txHash, amount });
      setWithdrawStatus('done');
      await refetchBalance();
      try {
        const fresh = await get<AgentDetails>(`/api/v1/agents/${id}`);
        setAgent(fresh);
      } catch { /* non-blocking */ }
    } catch (err) {
      setWithdrawError((err as Error).message || 'Withdraw failed');
      setWithdrawStatus('error');
    }
  }

  if (loading) return <LoadingState label="Loading agent…" />;
  if (!agent) {
    return (
      <div className="border border-line">
        {fetchError ? (
          <ErrorState title="Couldn't load this agent" onRetry={() => loadAgent()} />
        ) : (
          <EmptyState icon="search" title="Agent not found" description="This agent does not exist or is no longer available." />
        )}
      </div>
    );
  }

  const isOwner = address?.toLowerCase() === agent.ownerAddress?.toLowerCase();
  const tabs: Tab[] = ['logs', 'tools', 'tasks', 'reviews', 'metrics', ...(isOwner ? (['webhooks', 'edit'] as Tab[]) : [])];

  return (
    <div>
      <Breadcrumb items={['marketplace', 'agents', 'mine', agent.name]} />
      <PageHeader
        title={agent.name}
        description={`${agent.provider} · ${agent.model}`}
        right={
          <div className="flex flex-col items-end gap-3">
            <StatusTag status={action.isPending ? action.variables : agent.status} />
            {isOwner && (
              <div className="flex flex-wrap justify-end gap-2">
                {agent.status !== 'running' && (
                  <Button variant="outline" size="sm" disabled={action.isPending}
                    onClick={() => action.mutate('start')} label="Start" />
                )}
                {agent.status === 'running' && (
                  <Button variant="outline" size="sm" disabled={action.isPending}
                    onClick={() => action.mutate('pause')} label="Pause" />
                )}
                <Button variant="ghost" size="sm" disabled={action.isPending}
                  onClick={() => action.mutate('stop')} label="Stop" />
                {agent.status !== 'stopped' && (
                  <Button variant="ghost" size="sm" disabled={action.isPending}
                    onClick={() => action.mutate('restart')} label="Restart" />
                )}
              </div>
            )}
          </div>
        }
      />
      {action.isError && (
        <div className="mb-4 px-4 py-2.5 border border-err/40 bg-err/10 text-xs text-err">
          <div>
            {ACTION_LABELS[action.variables]} failed:{' '}
            <span className="font-mono">{(action.error as Error).message}</span>
          </div>
          {(action.error as { code?: string }).code === 'FORBIDDEN' && walletClient && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={linkStatus === 'signing' || linkStatus === 'linking'}
                onClick={handleLinkOwner}
                label={
                  linkStatus === 'signing' ? 'Sign in your wallet…'
                    : linkStatus === 'linking' ? 'Linking…'
                      : 'Link this wallet to the agent'
                }
              />
              <span className="text-ink-3">
                One signature with your owner wallet authorizes this sign-in. No gas.
              </span>
            </div>
          )}
          {linkError && <div className="mt-1.5 font-mono">{linkError}</div>}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-0 border border-line mb-2">
        <StatCard label="Tasks completed" value={String(agent.tasksCompleted ?? 0)} sub="All time" />
        <div className="border-t sm:border-t-0 sm:border-l border-line"><StatCard label="Earned" value={`${parseFloat(agent.totalEarned ?? '0').toLocaleString(undefined, { maximumFractionDigits: 4 })} ${balanceSymbol}`} sub={`Native ${balanceSymbol}`} subColor="ok" /></div>
        <div className="border-t sm:border-t-0 sm:border-l border-line"><StatCard label="Reputation" value={String(agent.decayedReputation?.decayedScore ?? agent.reputation?.score ?? 0)} sub={`${agent.reputation?.tasksCompleted ?? 0} tasks · ${agent.reputation?.disputes ?? 0} disputes`} subColor={agent.reputation?.disputes && agent.reputation.disputes > 0 ? 'warn' : 'default'} /></div>
        <div className="border-t sm:border-t-0 sm:border-l border-line"><StatCard label="Wallet balance" value={balanceEther > 0 ? balanceEther.toFixed(4) : '—'} sub={isLowGas ? 'Low gas — top up' : balanceSymbol} subColor={isLowGas ? 'warn' : 'default'} /></div>
      </div>

      {/* Gas management — only relevant to the agent owner. Top up sends native
          0G to the agent wallet; Withdraw sweeps balance back to the owner.
          Consolidated into one labelled panel with the low-gas warning. */}
      {isOwner && agent.walletAddress && (
        <div className="border border-line border-t-0 mb-8 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-ink-2">
              <Icon name="bolt" size={16} className={isLowGas ? 'text-warn' : 'text-ink-3'} />
              <span className="text-[13px] font-medium">Gas management</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={isLowGas ? 'primary' : 'outline'}
                size="sm"
                onClick={handleTopUp}
                disabled={topUpStatus === 'sending'}
                label={topUpStatus === 'sending' ? `Sending ${isSui ? '0.05' : TOP_UP_AMOUNT} ${balanceSymbol}…` : `Top up gas (+${isSui ? '0.05' : TOP_UP_AMOUNT} ${balanceSymbol})`}
              />
              {/* Withdraw — single button for both native 0G and ERC20 tokens.
                  The backend's /withdraw endpoint auto-detects; empty body sweeps
                  native 0G (gas reserve kept). */}
              {agent.status !== 'running' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleWithdraw}
                  disabled={withdrawStatus === 'sending' || balanceEther < 0.0015}
                  label={withdrawStatus === 'sending' ? 'Withdrawing…' : 'Withdraw to owner'}
                />
              )}
            </div>
          </div>

          {/* Status / warning line */}
          {(topUpStatus === 'error' ||
            withdrawStatus === 'done' ||
            withdrawStatus === 'error' ||
            (isLowGas && agent.status !== 'stopped')) && (
            <div className="mt-3 space-y-1.5 text-xs">
              {topUpStatus === 'error' && <div className="text-err">{topUpError}</div>}
              {withdrawStatus === 'done' && withdrawInfo && (
                <div className="text-ok">
                  Withdrew <span className="font-mono">{parseFloat(withdrawInfo.amount).toFixed(4)} {balanceSymbol}</span> ·
                  tx <span className="font-mono">{withdrawInfo.txHash.slice(0, 10)}…</span>
                </div>
              )}
              {withdrawStatus === 'error' && <div className="text-err">{withdrawError}</div>}
              {isLowGas && agent.status !== 'stopped' && (
                <div className="text-warn">
                  Agent will fail to submit evidence below <span className="font-mono">{isSui ? SUI_LOW_GAS_THRESHOLD : LOW_GAS_THRESHOLD} {balanceSymbol}</span>.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Identity */}
        <div className="border border-line p-5">
          <SectionRule num="01" title="Identity" />
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-[13px] font-medium text-ink-2 mb-1">Owner</div>
              <div className="font-mono text-ink-2">{truncateAddress(agent.ownerAddress)}</div>
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink-2 mb-1">Deployed</div>
              <div className="font-mono text-ink-2">{new Date(agent.deployedAt).toLocaleString()}</div>
            </div>
            {agent.walletAddress && (
              <div>
                <div className="text-[13px] font-medium text-ink-2 mb-1">Agent wallet</div>
                <div className="font-mono text-ink-2 break-all text-xs">{agent.walletAddress}</div>
              </div>
            )}
            {agent.inftTokenId !== undefined && (
              <div>
                <div className="text-[13px] font-medium text-ink-2 mb-1">INFT token</div>
                <div className="font-mono text-cream">#{agent.inftTokenId}</div>
              </div>
            )}
            <div>
              <div className="text-[13px] font-medium text-ink-2 mb-1">Reputation</div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-ink-2">
                  {String(agent.decayedReputation?.decayedScore ?? agent.reputation?.score ?? 0)}
                </span>
                <span className="font-mono text-[11px] text-ink-3">
                  ({agent.reputation?.tasksCompleted ?? 0} tasks · {agent.reputation?.disputes ?? 0} disputes)
                </span>
              </div>
            </div>
            {badges.length > 0 && (
              <div>
                <div className="text-[13px] font-medium text-ink-2 mb-1">Badges</div>
                <div className="flex flex-wrap gap-1.5">
                  {badges.map((b) => (
                    <Tag key={b.capability} tone="ok">{b.capability.replace(/_/g, ' ')}</Tag>
                  ))}
                </div>
              </div>
            )}
            {agent.publicKey && (
              <div>
                <div className="text-[13px] font-medium text-ink-2 mb-1">Public key</div>
                <div className="font-mono text-ink-2 break-all text-xs">
                  {agent.publicKey.slice(0, 18)}…{agent.publicKey.slice(-6)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tabbed right panel */}
        <div className="border border-line flex flex-col min-w-0">
          {/* Tabs — clean sans tab bar with a cream underline on the active tab,
              matching the marketplace dashboard. Horizontal scroll on narrow
              viewports so they never wrap into a broken two-line bar. */}
          <div role="tablist" className="flex gap-6 border-b border-line px-5 overflow-x-auto scrollbar-thin">
            {tabs.map(t => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`pt-4 pb-3 -mb-px text-sm whitespace-nowrap border-b-2 transition-colors ${
                  tab === t
                    ? 'text-ink font-medium border-cream'
                    : 'text-ink-3 border-transparent hover:text-ink-2'
                }`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>

          <div className="flex-1 p-5 overflow-y-auto max-h-[520px]" ref={logContainerRef} onScroll={handleLogScroll}>
            {tab === 'logs' && (
              <>
              {!autoScroll && logs.length > 0 && (
                <button
                  onClick={scrollToBottom}
                  className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 text-xs font-mono bg-surface-3 hover:bg-surface-4 text-ink-2 rounded-full border border-line shadow-lg transition-all"
                >
                  ↓ Scroll to bottom
                </button>
              )}
              {logs.length > 0 ? logs.map((line, i) => {
                // Strip any leftover ANSI escape sequences from older buffered
                // log lines (the worker no longer emits them when forked, but
                // Redis may still hold pre-fix entries until the ring rotates).
                const clean = line.replace(/\x1b\[[0-9;]*m/g, '');

                // Worker emits each line as `YYYY-MM-DD HH:MM:SS ...`. Pull
                // out the timestamp so we can render it dimmed and aligned,
                // making the actual message easier to scan. Lines without a
                // timestamp (startup errors, legacy entries) just render whole.
                const tsMatch = clean.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:Z|))\s+(.*)$/);
                const isErr = clean.includes('[err]');
                return (
                  <div key={i} className={`px-3 py-1.5 text-xs font-mono flex gap-3 ${isErr ? 'text-err bg-err/10' : 'text-ink-3 hover:bg-surface-2'}`}>
                    {tsMatch ? (
                      <>
                        {/* Show both date and local time so the log timeline is
                            unambiguous across restarts and multi-day runs. */}
                        <span className="text-ink-3/60 shrink-0" title={tsMatch[1]}>
                          {new Date(tsMatch[1].replace('Z', '').replace(' ', 'T') + 'Z').toLocaleString([], { hour12: false })}
                        </span>
                        <span className="break-all">{tsMatch[2]}</span>
                      </>
                    ) : (
                      <span className="break-all">{clean}</span>
                    )}
                  </div>
                );
              }) : (
                <EmptyState
                  icon="list"
                  title={agent.status === 'running' ? 'Waiting for logs' : 'No logs yet'}
                  description={agent.status === 'running'
                    ? 'Live output will stream here as the agent works.'
                    : 'Start the agent to begin streaming its logs.'}
                />
              )}
              </>
            )}

            {tab === 'tools' && (
              (agent.tools ?? []).length === 0 ? (
                <EmptyState
                  icon="settings"
                  title="No tools configured"
                  description="This agent has no external tools or endpoints attached."
                />
              ) : (
                <div className="space-y-3">
                  {(agent.tools ?? []).map((t, i) => (
                    <div key={i} className="border border-line p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-sm font-medium text-ink">{t.name}</span>
                        <Tag tone="neutral">{t.type}</Tag>
                      </div>
                      {t.description && <div className="text-sm text-ink-3 leading-relaxed">{t.description}</div>}
                      {(t.url || t.endpointUrl) && (
                        <div className="mt-2 text-xs font-mono text-ink-3 break-all">{t.url ?? t.endpointUrl}</div>
                      )}
                      {t.headers && t.headers.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {t.headers.map((h, j) => (
                            <div key={j} className="text-[11px] font-mono text-ink-3 break-all">
                              {h.name}: {h.isSensitive ? '********' : h.value}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}

            {tab === 'tasks' && (
              <AgentTasks agentWallet={agent.walletAddress} />
            )}

            {tab === 'reviews' && (
              <div className="space-y-5">
                {/* Stats summary */}
                {reviewStats && reviewStats.totalReviews > 0 && (
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-ink font-bold font-mono text-lg">{reviewStats.avgRating.toFixed(1)}</span>
                    <span className="text-ink-3">avg · {reviewStats.totalReviews} reviews</span>
                    <div className="flex gap-1">
                      {[5, 4, 3, 2, 1].map((star) => (
                        <div key={star} className="flex items-center gap-1 text-xs text-ink-3">
                          <span className="text-ink-2">{'★'.repeat(star)}{'☆'.repeat(5 - star)}</span>
                          <span className="font-mono w-4 text-right">{reviewStats.distribution[star] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Review list */}
                {reviews.length === 0 ? (
                  <EmptyState icon="list" title="No reviews yet" description="This agent hasn't been reviewed yet." />
                ) : (
                  <div className="space-y-3">
                    {reviews.map((r) => (
                      <div key={r.id} className="border border-line p-4">
                        <div className="flex items-center gap-3 mb-1.5">
                          <span className="text-ink font-mono text-sm">
                            {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                          </span>
                          <span className="text-[11px] text-ink-3 font-mono">{truncateAddress(r.reviewer_address)}</span>
                          <span className="text-[11px] text-ink-3">{new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                        {r.review && <p className="text-sm text-ink-2 leading-relaxed">{r.review}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Submit review form */}
                <div className="border border-line p-5">
                  <div className="text-sm font-medium text-ink mb-3">Leave a review</div>
                  <div className="flex items-center gap-1 mb-3">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setReviewRating(star)}
                        className={`text-lg transition-colors ${star <= reviewRating ? 'text-cream' : 'text-ink-3'}`}
                      >
                        ★
                      </button>
                    ))}
                    <span className="text-xs text-ink-3 ml-2">{reviewRating}/5</span>
                  </div>
                  <FormTextarea
                    rows={3}
                    placeholder="Share your experience with this agent…"
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                  />
                  <div className="flex items-center gap-3 mt-3">
                    <Button
                      variant="primary"
                      size="sm"
                      label={reviewSubmitting ? 'Submitting…' : 'Submit review'}
                      disabled={reviewSubmitting}
                      onClick={async () => {
                        if (!agent?.walletAddress) return;
                        setReviewSubmitting(true);
                        setReviewSubmitError('');
                        try {
                          await submitReview({
                            taskId: '',
                            agentAddress: agent.walletAddress,
                            rating: reviewRating,
                            review: reviewText.trim() || undefined,
                          });
                          setReviewText('');
                          setReviewRating(5);
                          const result = await getAgentReviews(agent.walletAddress, 20);
                          setReviews(result.reviews);
                          setReviewStats(result.stats);
                        } catch (err) {
                          setReviewSubmitError((err as Error).message);
                        } finally {
                          setReviewSubmitting(false);
                        }
                      }}
                    />
                    {reviewSubmitError && <span className="text-xs text-err">{reviewSubmitError}</span>}
                  </div>
                </div>
              </div>
            )}

            {tab === 'webhooks' && isOwner && (
              <WebhookTab agentId={id!} />
            )}

            {tab === 'edit' && isOwner && (
              <div className="space-y-5">
                <FormField label="Instructions">
                  <FormTextarea rows={6} value={editInstructions} onChange={e => setEditInstructions(e.target.value)} />
                </FormField>

                <FormField label="Model">
                  <FormInput className="font-mono" value={editModel} onChange={e => setEditModel(e.target.value)} />
                </FormField>

                <FormField
                  label="Capabilities"
                  required
                  hint="What tasks this agent can accept. Changes take effect on the next agent restart (stop then start)."
                >
                  <div className="flex flex-wrap gap-2">
                    {AGENT_CAPABILITIES.map(cap => (
                      <button key={cap} type="button"
                        onClick={() => setEditCapabilities(cs => cs.includes(cap) ? cs.filter(c => c !== cap) : [...cs, cap])}
                        className={`px-2.5 py-1 text-xs border transition-colors ${editCapabilities.includes(cap)
                          ? 'bg-cream/10 border-cream/40 text-cream'
                          : 'bg-surface-2 border-line text-ink-3 hover:text-ink-2'
                          }`}>
                        {cap.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                  {editCapabilities.length === 0 && (
                    <div className="mt-2 text-xs text-err">
                      Pick at least one — without capabilities the agent can't accept any task.
                    </div>
                  )}
                </FormField>

                <FormField label="Min reward" hint="0G per task — tasks below this threshold won't be offered to this agent (requires restart)">
                  <FormInput className="font-mono" placeholder="0" value={editMinReward} onChange={e => setEditMinReward(e.target.value)} />
                </FormField>

                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="primary"
                    onClick={() => save.mutate()}
                    disabled={save.isPending || editCapabilities.length === 0}
                    label={save.isPending ? 'Saving…' : 'Save changes'}
                  />
                  {save.isError && <span className="text-xs text-err">Save failed</span>}
                </div>
              </div>
            )}

            {tab === 'metrics' && <AgentMetricsPanel agentId={id!} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentTasks({ agentWallet }: { agentWallet?: string }) {
  type Execution = {
    meta: { taskId: string; requiredCapabilities?: string[] };
    state: { status: string; acceptedAt?: string; verificationResult?: { passed: boolean } };
  };
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [tasksError, setTasksError] = useState(false);

  const loadTasks = useCallback(() => {
    if (!agentWallet) return;
    setTasksError(false);
    get<{ executions?: Execution[] }>(`/api/v1/a2a/executions?address=${agentWallet}`)
      .then(data => setExecutions(data.executions ?? []))
      .catch(() => setTasksError(true));
  }, [agentWallet]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  if (tasksError && executions.length === 0) {
    return <ErrorState title="Couldn't load this agent's tasks" onRetry={() => loadTasks()} />;
  }

  if (executions.length === 0) {
    return (
      <EmptyState
        icon="briefcase"
        title="No tasks yet"
        description="Tasks this agent accepts and executes will appear here."
      />
    );
  }

  const sorted = [...executions].sort((a, b) => {
    const ta = a.state.acceptedAt ? Date.parse(a.state.acceptedAt) : 0;
    const tb = b.state.acceptedAt ? Date.parse(b.state.acceptedAt) : 0;
    return tb - ta;
  });

  return (
    <div className="space-y-2">
      {sorted.map(e => (
        <div key={e.meta.taskId} className="flex items-center justify-between gap-3 border border-line px-4 py-3 text-sm">
          <span className="font-mono text-ink-3 shrink-0">{e.meta.taskId.slice(0, 10)}…</span>
          <span className="text-ink-2 truncate flex-1 text-center">{(e.meta.requiredCapabilities ?? []).join(', ') || '—'}</span>
          <span className="shrink-0"><StatusTag status={e.state.status} /></span>
        </div>
      ))}
    </div>
  );
}

function WebhookTab({ agentId: _agentId }: { agentId: string }) {
  const [hooks, setHooks] = useState<AgentWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadHooks = useCallback(() => {
    setLoading(true);
    setError(false);
    getWebhooks()
      .then(setHooks)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getWebhooks()
      .then(h => { if (!cancelled) setHooks(h); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleCreate() {
    if (!url) return;
    setCreating(true);
    setCreateError('');
    try {
      await apiRegisterWebhook({
        url,
        secret: secret.trim() || undefined,
      });
      setUrl('');
      setSecret('');
      await loadHooks();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <LoadingState label="Loading webhooks…" />;
  if (error) return <ErrorState title="Couldn't load webhooks" onRetry={() => loadHooks()} />;

  return (
    <div className="space-y-5">
      {/* Existing webhooks */}
      {hooks.length === 0 ? (
        <EmptyState
          icon="settings"
          title="No webhooks configured"
          description="Receive real-time notifications when this agent gets tasks assigned."
        />
      ) : (
        <div className="space-y-2">
          {hooks.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3 border border-line px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="text-ink font-mono text-xs break-all truncate">{h.url}</div>
                <div className="text-[11px] text-ink-3 mt-0.5">{h.events.join(', ')}</div>
              </div>
              <button
                onClick={async () => {
                  await deleteWebhook(h.id);
                  await loadHooks();
                }}
                className="text-xs text-err hover:underline shrink-0"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Register new webhook */}
      <div className="border border-line p-5">
        <div className="text-sm font-medium text-ink mb-3">Register webhook</div>
        <FormField label="URL" required>
          <FormInput className="font-mono" placeholder="https://your-service.com/webhook" value={url} onChange={(e) => setUrl(e.target.value)} />
        </FormField>
        <FormField label="Secret" hint="HMAC-SHA256 signing secret (auto-generated if empty)">
          <FormInput className="font-mono" placeholder="Leave empty for auto-generate" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </FormField>
        <div className="flex items-center gap-3 mt-3">
          <Button
            variant="primary"
            size="sm"
            label={creating ? 'Registering…' : 'Register webhook'}
            disabled={!url || creating}
            onClick={handleCreate}
          />
          {createError && <span className="text-xs text-err">{createError}</span>}
        </div>
      </div>
    </div>
  );
}

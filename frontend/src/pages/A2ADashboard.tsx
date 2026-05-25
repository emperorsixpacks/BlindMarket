import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Breadcrumb,
  PageHeader,
  SectionRule,
  Panel,
  Button,
  Tag,
  FormField,
  FormInput,
  Prompt,
} from '../components/bb';
import {
  useAgentProfile,
  useBrowseAgentTasks,
  useMyExecutions,
  useRegisterAgent,
} from '../hooks/useA2A';
import { useAuth } from '../context/AuthContext';
import { useAccount } from 'wagmi';
import { getOrCreateExecutorIdentity } from '../lib/executorIdentity';
import { AGENT_CAPABILITIES as ALL_CAPABILITIES } from '../config/capabilities';

const statusTone: Record<string, 'neutral' | 'info' | 'ok' | 'err' | 'warn'> = {
  open: 'neutral',
  accepted: 'info',
  submitted: 'info',
  verified: 'ok',
  failed: 'err',
  cancelled: 'warn',
};

type Tab = 'register' | 'browse_tasks' | 'my_executions';

export default function A2ADashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('browse_tasks');
  const [displayName, setDisplayName] = useState('');
  const [selectedCaps, setSelectedCaps] = useState<string[]>([]);
  const [agentCardUrl, setAgentCardUrl] = useState('');
  const [mcpEndpoint, setMcpEndpoint] = useState('');
  const [rate, setRate] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);

  const { isAuthenticated } = useAuth();
  const { address } = useAccount();
  const { data: profile } = useAgentProfile();
  const { data: browse, isLoading: browseLoading } = useBrowseAgentTasks({
    enabled: activeTab === 'browse_tasks',
  });
  const { data: execs, isLoading: execsLoading } = useMyExecutions({
    enabled: activeTab === 'my_executions',
  });
  const registerMutation = useRegisterAgent();

  const toggleCap = (cap: string) => {
    setSelectedCaps((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap],
    );
  };

  const agentCardPreview = `{
  "name": "${displayName || '<agent_name>'}",
  "capabilities": [${selectedCaps.map((c) => `"${c}"`).join(', ')}],
  "agent_card_url": "${agentCardUrl || '<url>'}",
  "mcp_endpoint": "${mcpEndpoint || '<url>'}",
  "rate": "${rate || '0'} USDC/task"
}`;

  return (
    <div>
      <Breadcrumb items={['marketplace', 'a2a']} />
      <PageHeader
        title="Agent-to-Agent"
        description="Browse encrypted agent-targeted tasks · accept and execute · track your past runs. Auto-verify + bridge settlement, no human in the loop."
      />

      <div className="flex gap-6 border-b border-line mb-8">
        {(['browse_tasks', 'my_executions', 'register'] as const).map((tab) => {
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2.5 text-xs font-mono font-semibold tracking-widest transition-colors border-b -mb-px flex items-center gap-1.5 ${
                activeTab === tab
                  ? 'text-cream border-cream'
                  : 'text-ink-3 border-transparent hover:text-ink-2'
              }`}
            >
              {activeTab === tab ? '▸ ' : ''}{tab}
            </button>
          );
        })}
      </div>

      {activeTab === 'register' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-0 border border-line">
          <div className="p-6 space-y-5">
            <div className="border border-line bg-surface-2 px-4 py-3 text-[11px] font-mono text-ink-3 leading-relaxed">
              <span className="text-cream">heads up:</span> if you deployed an
              agent via <Link to="/agents/deploy" className="text-ink-2 underline hover:text-cream">deploy_agent</Link>,
              it auto-registers on startup — you don't need this form. This is
              for registering an externally-operated executor (a bot running on
              your own infra, not ours).
            </div>

            <SectionRule num="01" title="register executor" />

            <FormField label="display_name" required>
              <FormInput
                placeholder="my_agent_executor"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </FormField>

            <FormField label="capabilities" required hint={`${selectedCaps.length} selected`}>
              <div className="flex flex-wrap gap-1.5">
                {ALL_CAPABILITIES.map((cap) => (
                  <button
                    key={cap}
                    type="button"
                    onClick={() => toggleCap(cap)}
                    className={`px-2.5 py-1 text-[11px] font-mono border transition-colors ${
                      selectedCaps.includes(cap)
                        ? 'bg-cream/10 border-cream/40 text-cream'
                        : 'bg-surface-2 border-line text-ink-3 hover:text-ink-2'
                    }`}
                  >
                    {cap}
                  </button>
                ))}
              </div>
            </FormField>

            <FormField label="agent_card_url" hint="public agent card json endpoint">
              <FormInput
                placeholder="https://..."
                value={agentCardUrl}
                onChange={(e) => setAgentCardUrl(e.target.value)}
              />
            </FormField>

            <FormField label="mcp_endpoint" hint="model context protocol server url">
              <FormInput
                placeholder="https://..."
                value={mcpEndpoint}
                onChange={(e) => setMcpEndpoint(e.target.value)}
              />
            </FormField>

            <FormField label="rate" hint="usdc per task">
              <FormInput
                placeholder="50"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </FormField>

            <div className="flex items-center gap-3 flex-wrap">
              <Button
                variant="primary"
                label={registerMutation.isPending ? 'registering…' : profile?.agent ? 're-register_executor' : 'register_executor'}
                disabled={!displayName.trim() || selectedCaps.length === 0 || !isAuthenticated || registerMutation.isPending}
                onClick={async () => {
                  setRegisterError(null);
                  if (!address) {
                    setRegisterError('connect a wallet before registering');
                    return;
                  }
                  try {
                    // Backend requires a pubkey so posters can wrap encrypted
                    // briefs to this executor. Derive a stable local identity
                    // (persisted, reused on re-register) and send its pubkey.
                    const { publicKey } = getOrCreateExecutorIdentity(address);
                    await registerMutation.mutateAsync({
                      displayName,
                      capabilities: selectedCaps,
                      publicKey,
                      ...(agentCardUrl ? { agentCardUrl } : {}),
                      ...(mcpEndpoint ? { mcpEndpointUrl: mcpEndpoint } : {}),
                    });
                  } catch (err) {
                    setRegisterError((err as Error).message || 'registration failed');
                  }
                }}
              />
              {!isAuthenticated && (
                <span className="text-[11px] font-mono text-ink-3">connect wallet to register</span>
              )}
              {profile?.agent && (
                <span className="text-[11px] font-mono text-ok">
                  ✓ registered as {profile.agent.displayName}
                </span>
              )}
              {registerError && (
                <span className="text-[11px] font-mono text-err break-all">{registerError}</span>
              )}
            </div>
          </div>

          <div className="border-l border-line p-6 space-y-6">
            <SectionRule num="I" title="agent card preview" />
            <pre className="bg-surface-2 border border-line p-4 text-xs font-mono text-ink-3 leading-relaxed overflow-x-auto">
              {agentCardPreview}
            </pre>

            <SectionRule num="II" title="your registration" />
            {profile?.agent ? (
              <div className="text-[11px] font-mono text-ink-3 space-y-1">
                <div>name: <span className="text-ink">{profile.agent.displayName}</span></div>
                <div>caps: <span className="text-ink">{profile.agent.capabilities.length}</span></div>
                <div>rep: <span className="text-ink">{profile.agent.reputation.toFixed(1)}</span></div>
                <div>tasks: <span className="text-ink">{profile.agent.tasksCompleted}</span></div>
              </div>
            ) : (
              <p className="text-[11px] font-mono text-ink-3">
                {isAuthenticated ? 'no registration yet. fill the form to register.' : 'connect wallet to view your registration.'}
              </p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'browse_tasks' && (
        <div className="border border-line">
          {browseLoading && (
            <div className="px-5 py-8 text-center text-xs font-mono text-ink-3">loading…</div>
          )}
          {!browseLoading && (!browse?.tasks || browse.tasks.length === 0) && (
            <div className="px-5 py-8 text-center text-xs font-mono text-ink-3">
              no agent-targeted tasks available.
            </div>
          )}

          <div className="md:hidden">
            {browse?.tasks?.map((entry) => {
              const onChainId = (entry as any).onChain?.taskId;
              return (
                <Link key={entry.meta.taskId} to={`/tasks/${onChainId || entry.meta.taskId}`} className="block border-b border-line last:border-b-0 px-5 py-4 space-y-2 hover:bg-surface-2 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-mono text-ink-3 truncate">
                      {onChainId ? `#${onChainId}` : `${entry.meta.taskId.slice(0, 14)}…`}
                    </span>
                    <Tag tone={statusTone[entry.state.status] ?? 'neutral'}>{entry.state.status}</Tag>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-3 mb-1">required caps</div>
                    <div className="text-[13px] font-mono text-ink">{entry.meta.requiredCapabilities.join(', ') || '—'}</div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Tag tone="neutral">{entry.meta.verificationMode}</Tag>
                    <Tag tone="info">{entry.meta.targetExecutorType}</Tag>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="hidden md:block">
            <div className="grid grid-cols-[120px_1fr_120px_120px_90px] gap-6 px-5 py-3 border-b border-line text-[11px] font-mono font-semibold uppercase tracking-widest text-ink-3">
              <span>id</span><span>required caps</span><span>verification</span><span>target</span><span>status</span>
            </div>
            {browse?.tasks?.map((entry) => {
              const onChainId = (entry as any).onChain?.taskId;
              return (
                <Link key={entry.meta.taskId} to={`/tasks/${onChainId || entry.meta.taskId}`} className="grid grid-cols-[120px_1fr_120px_120px_90px] gap-6 px-5 py-4 border-b border-line last:border-b-0 text-[13px] font-mono hover:bg-surface-2 transition-colors group">
                  <span className="text-ink-3 group-hover:text-cream transition-colors">
                    {onChainId ? `#${onChainId}` : `${entry.meta.taskId.slice(0, 10)}…`}
                  </span>
                  <span className="text-ink truncate">{entry.meta.requiredCapabilities.join(', ') || '—'}</span>
                  <Tag tone="neutral">{entry.meta.verificationMode}</Tag>
                  <Tag tone="info">{entry.meta.targetExecutorType}</Tag>
                  <Tag tone={statusTone[entry.state.status] ?? 'neutral'}>{entry.state.status}</Tag>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'my_executions' && (
        <Panel>
          {execsLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-4">
              <Prompt command="tail -f executions.log" blink />
              <p className="text-ink-3 text-xs font-mono">loading…</p>
            </div>
          ) : !execs?.executions || execs.executions.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center gap-4">
              <Prompt command="tail -f executions.log" blink />
              <p className="text-ink-3 text-xs font-mono">
                {isAuthenticated
                  ? 'no executions yet. register as an executor and accept a task.'
                  : 'connect wallet to see your executions.'}
              </p>
              <Tag tone="neutral">waiting for events</Tag>
            </div>
          ) : (
            <div className="border border-line">
              <div className="md:hidden">
                {execs.executions.map((e) => {
                  const hasResult = !!e.state.resultData;
                  const onChainId = (e as any).onChain?.taskId;
                  return (
                    <div key={e.meta.taskId} className="border-b border-line last:border-b-0 px-5 py-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <Link to={`/tasks/${onChainId || e.meta.taskId}`} className="text-[11px] font-mono text-cream hover:underline truncate">
                          {onChainId ? `#${onChainId}` : `${e.meta.taskId.slice(0, 14)}…`}
                        </Link>
                        <Tag tone={statusTone[e.state.status] ?? 'neutral'}>{e.state.status}</Tag>
                      </div>
                      <div className="grid grid-cols-2 gap-3 pt-1 text-[11px] font-mono">
                        <div>
                          <div className="text-ink-3 uppercase tracking-widest text-[10px]">accepted</div>
                          <div className="text-ink-2 mt-0.5">{e.state.acceptedAt ? new Date(e.state.acceptedAt).toLocaleString() : '—'}</div>
                        </div>
                        <div>
                          <div className="text-ink-3 uppercase tracking-widest text-[10px]">submitted</div>
                          <div className="text-ink-2 mt-0.5">{e.state.submittedAt ? new Date(e.state.submittedAt).toLocaleString() : '—'}</div>
                        </div>
                      </div>
                      <div className="text-[11px] font-mono">
                        <span className="text-ink-3">verified: </span>
                        <span className={e.state.verificationResult?.passed ? 'text-ok' : 'text-ink-3'}>{e.state.verificationResult?.passed ? '✓' : '—'}</span>
                      </div>
                      {hasResult && (
                        <details className="pt-2 border-t border-line/50 group">
                          <summary className="flex items-center justify-between cursor-pointer text-[11px] font-mono uppercase tracking-widest text-ink-3 hover:text-cream transition-colors list-none">
                            <span>view result</span>
                            <span className="group-open:rotate-90 transition-transform">▸</span>
                          </summary>
                          <pre className="mt-2 max-h-64 overflow-auto bg-surface-2 border border-line p-3 text-[11px] font-mono text-ink leading-relaxed whitespace-pre-wrap break-words">
                            {JSON.stringify(e.state.resultData, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block">
                <div className="grid grid-cols-[80px_1fr_100px_120px_90px_70px] gap-4 px-5 py-3 border-b border-line text-[11px] font-mono font-semibold uppercase tracking-widest text-ink-3">
                  <span>task</span><span>accepted</span><span>status</span><span>submitted</span><span>verified</span><span>result</span>
                </div>
                {execs.executions.map((e) => {
                  const hasResult = !!e.state.resultData;
                  const onChainId = (e as any).onChain?.taskId;
                  return (
                    <details key={e.meta.taskId} className="border-b border-line last:border-b-0 group">
                      <summary className={`grid grid-cols-[80px_1fr_100px_120px_90px_70px] gap-4 px-5 py-3 text-[12px] font-mono list-none ${hasResult ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default'} transition-colors`}>
                        <Link to={`/tasks/${onChainId || e.meta.taskId}`} className="text-cream hover:underline truncate">
                          {onChainId ? `#${onChainId}` : `${e.meta.taskId.slice(0, 10)}…`}
                        </Link>
                        <span className="text-ink-3">{e.state.acceptedAt ? new Date(e.state.acceptedAt).toLocaleString() : '—'}</span>
                        <Tag tone={statusTone[e.state.status] ?? 'neutral'}>{e.state.status}</Tag>
                        <span className="text-ink-3">{e.state.submittedAt ? new Date(e.state.submittedAt).toLocaleString() : '—'}</span>
                        <span className="text-ink-3">{e.state.verificationResult?.passed ? '✓' : '—'}</span>
                        <span className={`uppercase tracking-widest text-[10px] ${hasResult ? 'text-cream group-open:text-ink' : 'text-ink-3/50'}`}>
                          {hasResult ? (
                            <>view <span className="group-open:rotate-90 inline-block transition-transform">▸</span></>
                          ) : '—'}
                        </span>
                      </summary>
                      {hasResult && (
                        <div className="px-5 pb-4 -mt-1">
                          <pre className="max-h-80 overflow-auto bg-surface-2 border border-line p-4 text-[11px] font-mono text-ink leading-relaxed whitespace-pre-wrap break-words">
                            {JSON.stringify(e.state.resultData, null, 2)}
                          </pre>
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
            </div>
          )}
        </Panel>
      )}

    </div>
  );
}

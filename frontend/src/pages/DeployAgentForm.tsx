import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useWalletClient, useBalance } from 'wagmi';
import { recoverPublicKey, hashMessage } from 'viem';
import { BrowserProvider, parseEther, formatEther } from 'ethers';
import {
  Breadcrumb,
  PageHeader,
  SectionRule,
  Button,
  Tag,
  Icon,
  FormField,
  FormInput,
  FormTextarea,
} from '../components/bb';
import { HeaderManager } from '../components/bb/HeaderManager';
import { QueryParamManager } from '../components/bb/QueryParamManager';
import { get, post } from '../lib/api';
import { AGENT_CAPABILITIES } from '../config/capabilities';

interface Tool {
  type: 'http' | 'mcp';
  name: string;
  description: string;
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  toolName?: string;
  headers: { name: string; value: string; isSensitive: boolean }[];
  queryParams: { name: string; value: string }[];
  body: { contentType: 'application/json' | 'application/x-www-form-urlencoded'; payload: string };
}

const DEPLOY_FUND_AMOUNT = '0.005';
const MIN_OWNER_BALANCE = '0.06';

type Provider = 'openai' | 'anthropic' | 'groq' | 'gemini';
type ProviderModels = Record<Provider, string[]>;

/** snake_case capability id → human label ("web_research" → "Web research"). */
function capLabel(cap: string): string {
  const t = cap.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const selectClass =
  'w-full px-3 py-2.5 bg-surface-2 border border-line text-ink text-sm focus:border-cream';

export default function DeployAgentForm() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const navigate = useNavigate();

  const [providers, setProviders] = useState<ProviderModels>({
    openai: ['gpt-4o', 'gpt-4o-mini'],
    anthropic: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-3-haiku-20240307'],
    groq: ['llama-3.3-70b-versatile', 'llama3-8b-8192'],
    gemini: ['gemini-2.0-flash', 'gemini-1.5-pro'],
  });

  const [form, setForm] = useState({
    name: '',
    instructions: '',
    provider: 'anthropic' as Provider,
    model: 'claude-sonnet-4-5',
    apiKey: '',
  });

  const [tools, setTools] = useState<Tool[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [newTool, setNewTool] = useState<Tool>({
    type: 'http', name: '', description: '', url: '', method: 'POST',
    headers: [], queryParams: [], body: { contentType: 'application/json', payload: '' }
  });
  const [showToolForm, setShowToolForm] = useState(false);
  const [toolError, setToolError] = useState('');

  const [status, setStatus] = useState<'idle' | 'deploying' | 'funding' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [agentId, setAgentId] = useState('');
  const [fundingSkipped, setFundingSkipped] = useState(false);

  const { data: ownerBalance } = useBalance({
    address: address as `0x${string}` | undefined,
    query: { enabled: !!address },
  });
  const ownerBalanceEther = ownerBalance ? parseFloat(formatEther(ownerBalance.value)) : 0;
  const hasEnoughForDeploy = ownerBalanceEther >= parseFloat(MIN_OWNER_BALANCE);

  useEffect(() => {
    get<ProviderModels>('/api/v1/agents/providers')
      .then(setProviders)
      .catch(() => { });
  }, []);

  function set(k: keyof typeof form, v: string) {
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === 'provider') next.model = providers[v as Provider]?.[0] ?? '';
      return next;
    });
  }

  function addTool() {
    setToolError('');
    if (!newTool.name || !newTool.url) {
      setToolError('Tool name and URL are required.');
      return;
    }
    if (newTool.body.contentType === 'application/json') {
      const payload = newTool.body.payload.trim();
      if (!payload.startsWith('{') || !payload.endsWith('}')) {
        setToolError('JSON payload must be enclosed in { }.');
        return;
      }
      try { JSON.parse(payload); } catch { setToolError('Invalid JSON payload.'); return; }
    }
    setTools(t => [...t, newTool]);
    setNewTool({ type: 'http', name: '', description: '', url: '', method: 'POST', headers: [], queryParams: [], body: { contentType: 'application/json', payload: '{}' } });
    setShowToolForm(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address || !walletClient) return;
    setStatus('deploying');
    setError('');
    setFundingSkipped(false);
    try {
      const msg = `BlindMarket agent deployment\nOwner: ${address}`;
      const sig = await walletClient.signMessage({ message: msg });
      const recovered = await recoverPublicKey({ hash: hashMessage(msg), signature: sig });
      const ownerPublicKey = recovered.replace(/^0x/, '');

      const data = await post<{ id: string; walletAddress?: string }>('/api/v1/agents/deploy', {
        ...form,
        ownerAddress: address,
        ownerPublicKey,
        capabilities,
        tools: tools.map(t => t.type === 'mcp'
          ? { type: 'mcp', name: t.name, description: t.description, endpointUrl: t.url, toolName: t.toolName ?? t.name }
          : {
              type: 'http',
              name: t.name,
              description: t.description,
              url: t.url,
              method: t.method ?? 'POST',
              headers: t.headers,
              queryParams: t.queryParams,
              body: t.body
            }
        ),
      });
      setAgentId(data.id);

      if (!data.walletAddress) {
        console.warn('[deploy] no walletAddress in deploy response, skipping funding step');
        setFundingSkipped(true);
        setStatus('done');
        return;
      }

      setStatus('funding');
      try {
        const provider = new BrowserProvider(walletClient.transport);
        const signer = await provider.getSigner();
        const tx = await signer.sendTransaction({
          to: data.walletAddress,
          value: parseEther(DEPLOY_FUND_AMOUNT),
        });
        await tx.wait();
      } catch (fundErr) {
        console.warn('[deploy] funding step failed:', (fundErr as Error).message);
        setFundingSkipped(true);
      }
      setStatus('done');
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <div>
        <Breadcrumb items={['marketplace', 'agents', 'create', 'no-code']} />
        <div className="border border-line p-10 text-center space-y-5 mt-8">
          <div className="flex items-center justify-center gap-2 text-ok">
            <Icon name="check" size={18} />
            <span className="text-sm font-semibold">Agent deployed</span>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-ink-3">
              Agent ID <span className="font-mono text-ink-2">{agentId}</span>
            </div>
            <div className="text-xs text-ink-3">On-chain wallet minted · INFT identity created</div>
          </div>

          {fundingSkipped ? (
            <div className="mx-auto max-w-md border border-warn/40 bg-warn/5 px-4 py-3 text-left text-[13px] text-ink-2 leading-relaxed space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-warn">
                <Icon name="bolt" size={15} />
                <span>Agent is unfunded</span>
              </div>
              <p>
                This agent's wallet has <span className="font-mono">0 0G</span> and can't submit
                evidence on-chain. Open the agent's page and click "Top up gas" to send{' '}
                <span className="font-mono">{DEPLOY_FUND_AMOUNT} 0G</span> from your wallet.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-[13px] text-ok">
              <Icon name="check" size={15} />
              <span>Funded with <span className="font-mono">{DEPLOY_FUND_AMOUNT} 0G</span> for gas</span>
            </div>
          )}

          <div className="flex justify-center gap-3 flex-wrap pt-1">
            <Button variant="primary" label="View agent →" onClick={() => navigate(`/agents/${agentId}`)} />
            <Button variant="outline" label="My agents" onClick={() => navigate('/agents/mine')} />
            <Button
              variant="ghost"
              label="Deploy another"
              onClick={() => { setStatus('idle'); setAgentId(''); setFundingSkipped(false); }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Breadcrumb items={['marketplace', 'agents', 'create', 'no-code']} />
      <PageHeader title="Create agent" description="Configure your agent — it will autonomously pick up and complete tasks." />

      <form onSubmit={handleSubmit} className="border border-line">
        {/* 01 — Identity */}
        <div className="p-6 border-b border-line">
          <SectionRule num="01" title="Identity" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <FormField label="Agent name" required className="min-w-0">
              <FormInput
                required
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="research-agent"
              />
            </FormField>
            <FormField label="Owner wallet" className="min-w-0">
              <div className="w-full px-3 py-2.5 bg-surface-2 border border-line text-ink-3 text-sm font-mono truncate">
                {address ?? 'Connect wallet'}
              </div>
            </FormField>
          </div>
          <FormField label="Instructions" required className="mt-5">
            <FormTextarea
              required
              rows={4}
              value={form.instructions}
              onChange={e => set('instructions', e.target.value)}
              placeholder="Describe what this agent does, how it should behave, and what tasks it should pick up."
            />
          </FormField>
        </div>

        {/* 02 — Model */}
        <div className="p-6 border-b border-line">
          <SectionRule num="02" title="Model" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <FormField label="Provider">
              <select value={form.provider} onChange={e => set('provider', e.target.value)} className={selectClass}>
                {Object.keys(providers).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </FormField>
            <FormField label="Model">
              <select value={form.model} onChange={e => set('model', e.target.value)} className={`${selectClass} font-mono`}>
                {(providers[form.provider] ?? []).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormField>
            <FormField label="API key" required>
              <FormInput
                required
                type="password"
                className="font-mono"
                value={form.apiKey}
                onChange={e => set('apiKey', e.target.value)}
                placeholder="sk-..."
              />
            </FormField>
          </div>
        </div>

        {/* 03 — Capabilities */}
        <div className="p-6 border-b border-line">
          <SectionRule num="03" title="Capabilities" side="Required" />
          <FormField label="What tasks can this agent do?" required hint={`${capabilities.length} selected`}>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_CAPABILITIES.map(cap => (
                <button
                  key={cap}
                  type="button"
                  onClick={() => setCapabilities(cs => cs.includes(cap) ? cs.filter(c => c !== cap) : [...cs, cap])}
                  className={`px-2.5 py-1 text-xs border transition-colors ${capabilities.includes(cap)
                    ? 'bg-cream/10 border-cream/40 text-cream'
                    : 'bg-surface-2 border-line text-ink-3 hover:text-ink-2'
                    }`}
                >
                  {capLabel(cap)}
                </button>
              ))}
            </div>
          </FormField>
        </div>

        {/* 04 — Tools & MCP servers */}
        <div className="p-6 border-b border-line">
          <SectionRule num="04" title="Tools & MCP servers" side="Optional" />
          <div className="space-y-2">
            {tools.map((t, i) => (
              <div key={i} className="flex items-center justify-between gap-3 border border-line px-4 py-3 text-sm">
                <span className="text-ink font-medium truncate">{t.name}</span>
                <span className="text-ink-3 font-mono text-xs truncate flex-1 text-right" title={t.url}>
                  <Tag tone="neutral" className="mr-2">{t.type === 'mcp' ? 'MCP' : 'HTTP'}</Tag>
                  {t.url}
                </span>
                <button
                  type="button"
                  onClick={() => setTools(ts => ts.filter((_, j) => j !== i))}
                  className="text-ink-3 hover:text-err transition-colors shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}

            {showToolForm ? (
              <div className="border border-line p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Type">
                    <select
                      value={newTool.type}
                      onChange={e => setNewTool(t => ({ ...t, type: e.target.value as 'http' | 'mcp' }))}
                      className={selectClass}
                    >
                      <option value="http">HTTP</option>
                      <option value="mcp">MCP</option>
                    </select>
                  </FormField>
                  <FormField label="Name">
                    <FormInput
                      value={newTool.name}
                      onChange={e => setNewTool(t => ({ ...t, name: e.target.value }))}
                      placeholder="web-search"
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4">
                  <FormField label="URL / endpoint">
                    <FormInput
                      className="font-mono"
                      value={newTool.url}
                      onChange={e => setNewTool(t => ({ ...t, url: e.target.value }))}
                      placeholder="https://..."
                    />
                  </FormField>
                  {newTool.type === 'http' && (
                    <FormField label="Method">
                      <select
                        value={newTool.method ?? 'POST'}
                        onChange={e => setNewTool(t => ({ ...t, method: e.target.value as Tool['method'] }))}
                        className={`${selectClass} font-mono`}
                      >
                        {['GET', 'POST', 'PUT', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </FormField>
                  )}
                </div>

                <FormField label="Description">
                  <FormTextarea
                    rows={3}
                    value={newTool.description}
                    onChange={e => setNewTool(t => ({ ...t, description: e.target.value }))}
                    placeholder="What this tool does"
                  />
                </FormField>

                {newTool.type === 'http' && (
                  <div className="space-y-4">
                    <FormField label="Query parameters">
                      <QueryParamManager params={newTool.queryParams} onChange={(p) => setNewTool(t => ({ ...t, queryParams: p }))} />
                    </FormField>
                    <FormField label="Headers">
                      <HeaderManager headers={newTool.headers} onChange={(h) => setNewTool(t => ({ ...t, headers: h }))} />
                    </FormField>
                    <FormField label="Body payload">
                      <select
                        value={newTool.body.contentType}
                        onChange={e => {
                          const contentType = e.target.value as 'application/json' | 'application/x-www-form-urlencoded';
                          setNewTool(t => ({
                            ...t,
                            body: {
                              contentType,
                              payload: contentType === 'application/json' ? '{}' : ''
                            }
                          }));
                        }}
                        className={selectClass}
                      >
                        <option value="application/json">JSON</option>
                        <option value="application/x-www-form-urlencoded">Form URL encoded</option>
                      </select>

                      {newTool.body.contentType === 'application/json' ? (
                        <FormTextarea
                          rows={3}
                          className="font-mono mt-2"
                          value={newTool.body.payload}
                          onChange={e => setNewTool(t => ({ ...t, body: { ...t.body, payload: e.target.value } }))}
                          placeholder='{"key": "value"}'
                        />
                      ) : (
                        <QueryParamManager
                          params={newTool.body.payload ? JSON.parse(newTool.body.payload) : []}
                          onChange={(p) => setNewTool(t => ({ ...t, body: { ...t.body, payload: JSON.stringify(p) } }))}
                        />
                      )}
                    </FormField>
                  </div>
                )}

                {toolError && <p className="text-xs text-err">{toolError}</p>}

                <div className="flex gap-3 pt-1">
                  <Button type="button" variant="primary" label="Add tool" onClick={addTool} />
                  <Button type="button" variant="ghost" label="Cancel" onClick={() => { setShowToolForm(false); setToolError(''); }} />
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                label="+ Add tool or MCP server"
                onClick={() => { setShowToolForm(true); setToolError(''); }}
              />
            )}
          </div>
        </div>

        {/* Deploy */}
        <div className="p-6">
          {!address ? (
            <p className="text-sm text-ink-3">Connect a wallet to deploy an agent.</p>
          ) : (
            <>
              <div className="mb-4 border border-line bg-surface-2 px-4 py-3.5 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Icon name="bolt" size={15} className="text-cream" />
                  <span>Deployment uses 2 signatures</span>
                </div>
                <ol className="text-[13px] text-ink-2 leading-relaxed space-y-1 list-decimal list-inside">
                  <li>Sign a message — no gas, derives your owner public key for encryption.</li>
                  <li>Send <span className="font-mono">{DEPLOY_FUND_AMOUNT} 0G</span> to the new agent wallet — pays for its gas.</li>
                </ol>
                <div className="text-[13px] text-ink-3 pt-0.5">
                  Your wallet balance:{' '}
                  <span className="font-mono text-ink-2">
                    {ownerBalance ? `${ownerBalanceEther.toFixed(4)} 0G` : '…'}
                  </span>
                </div>
              </div>

              {!hasEnoughForDeploy && ownerBalance && (
                <div className="mb-4 border border-err/40 bg-err/5 px-4 py-3.5 text-[13px] text-ink-2 leading-relaxed space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-err">
                    <Icon name="bolt" size={15} />
                    <span>Not enough 0G to fund the agent</span>
                  </div>
                  <p>
                    You need at least <span className="font-mono">{MIN_OWNER_BALANCE} 0G</span> (fund
                    amount plus gas for the transfer). Top up your wallet at{' '}
                    <a href="https://faucet.0g.ai" target="_blank" rel="noreferrer" className="text-cream underline">faucet.0g.ai</a>
                    {' '}then refresh.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={status === 'deploying' || status === 'funding' || capabilities.length === 0 || !hasEnoughForDeploy}
                  label={
                    status === 'deploying'
                      ? 'Deploying…'
                      : status === 'funding'
                        ? `Funding agent with ${DEPLOY_FUND_AMOUNT} 0G…`
                        : 'Deploy + fund agent →'
                  }
                />
                {capabilities.length === 0 && (
                  <span className="text-[13px] text-ink-3">Pick at least one capability above to continue.</span>
                )}
              </div>
            </>
          )}
          {status === 'error' && <p className="mt-3 text-sm text-err break-words">{error}</p>}
        </div>
      </form>
    </div>
  );
}

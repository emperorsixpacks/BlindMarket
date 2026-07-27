import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWalletClient, useBalance } from 'wagmi';
import { BrowserProvider, parseEther, formatEther } from 'ethers';
import {
  Breadcrumb,
  PageHeader,
  SectionRule,
  Button,
  Icon,
  FormField,
  FormInput,
  FormSelect,
} from '../components/bb';
import { ToolManager, type AnyTool } from '../components/bb/ToolManager';
import SkillPicker from '../components/bb/SkillPicker';
import { get, post, authedPost } from '../lib/api';
import { AGENT_CAPABILITIES } from '../config/capabilities';
import { useChainAddress } from '../hooks/useChainWallet';
import { getNativeCurrency } from '../config/constants';

const OG_COMPUTE_DEPOSIT = '1.5';
const DEPLOY_FUND_AMOUNT = '0.005';

function fundAmount(provider: string) {
  return provider === '0g-compute' ? OG_COMPUTE_DEPOSIT : DEPLOY_FUND_AMOUNT;
}

function minOwnerBalance(provider: string) {
  const amt = parseFloat(fundAmount(provider));
  return (amt + 0.055).toFixed(3);
}

const OG_FAUCET_URL = 'https://faucet.0g.ai';

type Provider = 'openai' | 'anthropic' | 'groq' | 'gemini' | '0g-compute';
type ProviderModels = Record<Provider, string[]>;

/** snake_case capability id → human label ("web_research" → "Web research"). */
const INSTRUCTION_TEMPLATES: Record<string, string> = {
  webResearch: `# Web Research Agent

You are a web research agent. Your job is to find, verify, and summarize information from the web.

## Capabilities
- Perform deep web searches on any topic
- Extract and verify key facts from multiple sources
- Provide citations and source links

## Behavior
- Always verify information from at least 2 independent sources
- Flag uncertainty or conflicting information clearly
- Provide structured summaries with key takeaways

## Output format
Start every response with a brief **summary**, then list findings with sources.`,
  dataProcessing: `# Data Processing Agent

You process and transform data according to specified rules.

## Capabilities
- Parse structured and unstructured data
- Transform between formats (JSON, CSV, text)
- Validate data against schemas

## Behavior
- Never modify data beyond the specified transformation
- Report errors and malformed input clearly
- Log processing steps for auditability

## Output format
Return processed data in the requested format with a brief summary of what was done.`,
  communityManager: `# Community Manager Agent

You manage community interactions, moderate content, and engage with users.

## Capabilities
- Moderate messages and content against guidelines
- Respond to common questions with approved answers
- Escalate complex issues to human moderators

## Behavior
- Be polite, helpful, and professional at all times
- Strictly enforce community guidelines without exception
- Use judgment — not everything rule-breaking is explicit

## Escalation
When you cannot handle something, clearly state why and offer to escalate.`,
  codeReview: `# Code Review Agent

You review code for bugs, security issues, and best practices.

## Capabilities
- Analyze code for common vulnerabilities
- Check for style guide compliance
- Suggest optimizations

## Behavior
- Be constructive — point out what's good too
- Prioritize security issues over style
- Provide examples for suggested changes`,
};

function capLabel(cap: string): string {
  const t = cap.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function DeployAgentForm() {
  const native = getNativeCurrency('og');
  const address = useChainAddress();
  const { data: walletClient } = useWalletClient();
  const navigate = useNavigate();

  const [providers, setProviders] = useState<ProviderModels>({
    openai: ['gpt-4o', 'gpt-4o-mini'],
    // Fallback only — the live list comes from GET /agents/providers.
    // All three previous entries were RETIRED Anthropic models (404 on use).
    anthropic: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    groq: ['llama-3.3-70b-versatile', 'llama3-8b-8192'],
    gemini: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    '0g-compute': ['deepseek-ai/DeepSeek-V3.1', 'google/gemma-3-27b-it', 'qwen/qwen-2.5-7b-instruct'],
  });

  const [form, setForm] = useState({
    name: '',
    instructions: '',
    provider: '0g-compute' as Provider,
    model: 'deepseek-ai/DeepSeek-V3.1',
    apiKey: '',
  });

  const [showTemplateMenu, setShowTemplateMenu] = useState(false);

  useEffect(() => {
    if (!showTemplateMenu) return;
    function onDown(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest('[data-tmpl-btn]');
      if (!btn) setShowTemplateMenu(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showTemplateMenu]);

  const [tools, setTools] = useState<AnyTool[]>([]);
  const [toolSecrets, setToolSecrets] = useState<Record<string, string>>({});
  const [capabilities, setCapabilities] = useState<string[]>([]);
  // Installed skills (slugs). Selecting a skill auto-checks its capability tags
  // in section 03 so the agent's declared caps reflect what it can do.
  const [skillSlugs, setSkillSlugs] = useState<string[]>([]);
  // Slugs imported as PRIVATE drafts via the SkillPicker importer. The
  // unauthenticated deploy route installs public skills only, so these are
  // attached right after deploy via the authed POST /agents/:id/skills.
  const [privateSkillSlugs, setPrivateSkillSlugs] = useState<string[]>([]);
  const [privateSkillResults, setPrivateSkillResults] = useState<Array<{ slug: string; ok: boolean; error?: string }>>([]);

  const [status, setStatus] = useState<'idle' | 'deploying' | 'funding' | 'done' | 'error'>('idle');
  const submittingRef = useRef(false);
  const [error, setError] = useState('');
  const [agentId, setAgentId] = useState('');
  const [fundingSkipped, setFundingSkipped] = useState(false);

  const { data: ownerBalance } = useBalance({
    address: address as `0x${string}` | undefined,
    query: { enabled: !!address },
  });

  const ownerBalanceEther = ownerBalance ? parseFloat(formatEther(ownerBalance.value)) : 0;

  const deployFundAmt = fundAmount(form.provider);
  const minBal = minOwnerBalance(form.provider);
  const hasEnoughForDeploy = ownerBalanceEther >= parseFloat(minBal);

  const [ogPricing, setOgPricing] = useState<Record<string, { promptUsd: string; completionUsd: string } | null>>({});

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    fetch('https://router-api.0g.ai/v1/models', { signal: ctrl.signal })
      .then(r => r.json())
      .then(res => {
        const routerModels = (res.data || []) as Array<{ id: string; pricing_usd?: { prompt: string; completion: string } }>;
        const map: Record<string, { promptUsd: string; completionUsd: string } | null> = {};
        for (const modelId of (providers['0g-compute'] ?? [])) {
          const parts = modelId.toLowerCase().split(/[/\-_.]+/).filter(Boolean);
          let best: { id: string; score: number; promptUsd: string; completionUsd: string } | null = null;
          for (const rm of routerModels) {
            const rid = rm.id.toLowerCase();
            const score = parts.reduce((s, p) => s + (rid.includes(p) ? 1 : 0), 0);
            if (score > (best?.score ?? -1) && rm.pricing_usd) {
              best = { id: rm.id, score, promptUsd: rm.pricing_usd.prompt, completionUsd: rm.pricing_usd.completion };
            }
          }
          map[modelId] = best ? { promptUsd: best.promptUsd, completionUsd: best.completionUsd } : null;
        }
        setOgPricing(map);
      })
      .catch(() => {});
    return () => { clearTimeout(t); ctrl.abort(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    get<ProviderModels>('/api/v1/agents/providers')
      .then((d: ProviderModels) => { if (!cancelled) setProviders(d); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, []);

  function set(k: keyof typeof form, v: string) {
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === 'provider') next.model = providers[v as Provider]?.[0] ?? '';
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address) return;
    if (!walletClient) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setStatus('deploying');
    setError('');
    setFundingSkipped(false);
    try {
      const msg = `BlindMarket agent deployment\nOwner: ${address}`;
      let ownerPublicKey: string;

      const provider = new BrowserProvider(walletClient.transport);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(msg);
      const { recoverPublicKey } = await import('viem');
      const { hashMessage, toBytes } = await import('viem');
      const sigBytes = toBytes(signature);
      const recoveredPubKey = await recoverPublicKey({ hash: hashMessage(msg), signature: sigBytes });
      ownerPublicKey = recoveredPubKey.slice(2);
      console.log('[deploy] EVM publicKey:', ownerPublicKey.length / 2, 'bytes');

      const data = await post<{ id: string; walletAddress?: string }>('/api/v1/agents/deploy', {
        ...form,
        ownerAddress: address,
        ownerPublicKey,
        capabilities,
        // Private drafts are excluded here (the public-only deploy route
        // would 404) and attached right after deploy, below.
        skillSlugs: skillSlugs.filter((slug) => !privateSkillSlugs.includes(slug)),
        toolSecrets,
        tools: tools.map(t => {
          // Normalized ToolDefinition — pass through as-is
          if ('input_schema' in t) return t;
          // Legacy types — map to backend shape
          if (t.type === 'mcp') {
            return { type: 'mcp', name: t.name, description: t.description, endpointUrl: t.url, toolName: t.toolName ?? t.name };
          }
          if (t.type === 'js') {
            return { type: 'js', name: t.name, description: t.description, code: t.code ?? '' };
          }
          if (t.type === 'sandbox') {
            return { type: 'sandbox', name: t.name, description: t.description, command: t.command ?? '', setup: t.setup, timeout: t.timeout };
          }
          return {
            type: 'http',
            name: t.name,
            description: t.description,
            url: t.url,
            method: t.method ?? 'POST',
            headers: t.headers,
            queryParams: t.queryParams,
            body: t.body,
          };
        }),
      });
      setAgentId(data.id);

      // Attach private-draft skills (authed route allows the author's own
      // drafts). Per-slug try/catch: a failed attach must not fail the
      // deploy — the agent already exists; results surface on the success
      // screen with a pointer to the agent page for retry.
      const privateToInstall = skillSlugs.filter((slug) => privateSkillSlugs.includes(slug));
      if (privateToInstall.length > 0) {
        const results: Array<{ slug: string; ok: boolean; error?: string }> = [];
        for (const slug of privateToInstall) {
          try {
            await authedPost(`/api/v1/agents/${data.id}/skills`, { slug });
            results.push({ slug, ok: true });
          } catch (e) {
            results.push({ slug, ok: false, error: (e as Error).message });
          }
        }
        setPrivateSkillResults(results);
      }

      if (!data.walletAddress) {
        console.warn('[deploy] no walletAddress in deploy response, skipping funding step');
        setFundingSkipped(true);
        setStatus('done');
        return;
      }

      setStatus('funding');
      try {
        const provider = new BrowserProvider(walletClient!.transport);
        const signer = await provider.getSigner();
        const tx = await signer.sendTransaction({
          to: data.walletAddress,
          value: parseEther(fundAmount(form.provider)),
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
    } finally {
      submittingRef.current = false;
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

          {privateSkillResults.length > 0 && (
            <div className="mx-auto max-w-md text-left space-y-1">
              <div className="text-xs font-medium text-ink-2">Private skills attached</div>
              {privateSkillResults.map((r) => (
                <div key={r.slug} className={`flex items-start gap-2 text-xs ${r.ok ? 'text-ok' : 'text-err'}`}>
                  <Icon name={r.ok ? 'check' : 'x'} size={12} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">
                    <span className="font-mono">{r.slug}</span>
                    {!r.ok && <> — {r.error || 'attach failed'}. Retry from the agent's Skills panel.</>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {fundingSkipped ? (
            <div className="mx-auto max-w-md border border-warn/40 bg-warn/5 px-4 py-3 text-left text-[13px] text-ink-2 leading-relaxed space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-warn">
                <Icon name="bolt" size={15} />
                <span>Agent is unfunded</span>
              </div>
              <p>
                This agent's wallet has <span className="font-mono">0 {native.symbol}</span> and can't submit
                evidence on-chain. Open the agent's page and click "Top up gas" to send{' '}
                <span className="font-mono">{(form.provider === '0g-compute' ? OG_COMPUTE_DEPOSIT : DEPLOY_FUND_AMOUNT)} {native.symbol}</span> from your wallet.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-[13px] text-ok">
              <Icon name="check" size={15} />
              <span>Funded with <span className="font-mono">{deployFundAmt} {native.symbol}</span> for gas</span>
            </div>
          )}

          <div className="flex justify-center gap-3 flex-wrap pt-1">
            <Button variant="primary" label="View agent →" onClick={() => navigate(`/agents/${agentId}`)} />
            <Button variant="outline" label="My agents" onClick={() => navigate('/agents/mine')} />
            <Button
              variant="ghost"
              label="Deploy another"
              onClick={() => { setStatus('idle'); setAgentId(''); setFundingSkipped(false); setPrivateSkillResults([]); }}
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
            <div className="border border-line divide-y divide-line">
              <div className="flex text-xs items-stretch">
                <div className="relative ml-auto">
                  <button type="button" data-tmpl-btn onClick={() => setShowTemplateMenu(!showTemplateMenu)}
                    className="px-3 py-1.5 text-ink-4 hover:text-ink transition-colors text-sm leading-none block">
                    ☰
                  </button>
                  {showTemplateMenu && (
                    <div className="absolute right-0 top-full z-10 w-48 border border-line bg-surface-2 shadow-lg">
                      <div className="px-3 py-1.5 text-[11px] text-ink-4 border-b border-line">Templates</div>
                      {Object.entries(INSTRUCTION_TEMPLATES).map(([key, val]) => (
                        <button key={key} type="button" data-tmpl-btn onClick={() => { set('instructions', val); setShowTemplateMenu(false); }}
                          className="block w-full text-left px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-1 transition-colors">
                          {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                        </button>
                      ))}
                      <div className="border-t border-line">
                        <button type="button" data-tmpl-btn onClick={() => { set('instructions', ''); setShowTemplateMenu(false); }}
                          className="block w-full text-left px-3 py-1.5 text-xs text-err hover:bg-surface-1 transition-colors">
                          Clear
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <textarea
                required
                rows={10}
                value={form.instructions}
                onChange={e => set('instructions', e.target.value)}
                placeholder="Describe what this agent does, how it should behave, and what tasks it should pick up."
                className="w-full px-3 py-2.5 bg-surface-2 text-ink text-sm focus:border-cream resize-y leading-relaxed font-mono border-0 outline-none"
              />
            </div>
          </FormField>
        </div>

        {/* 02 — Model */}
        <div className="p-6 border-b border-line">
          <SectionRule num="02" title="Model" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <FormField label="Provider">
              <FormSelect value={form.provider} onChange={e => set('provider', e.target.value)}>
                {Object.keys(providers).map(p => <option key={p} value={p}>{p}</option>)}
              </FormSelect>
            </FormField>
            <FormField label="Model">
              <FormSelect value={form.model} onChange={e => set('model', e.target.value)} className="font-mono">
                {(providers[form.provider] ?? []).map(m => <option key={m} value={m}>{m}</option>)}
              </FormSelect>
            </FormField>
            <FormField label="API key" required={form.provider !== '0g-compute'} hint={form.provider === '0g-compute' ? 'No API key needed — billed to agent wallet via 0G Compute Router' : undefined}>
              <FormInput
                required={form.provider !== '0g-compute'}
                type="password"
                className={`font-mono ${form.provider === '0g-compute' ? 'opacity-40' : ''}`}
                value={form.apiKey}
                onChange={e => set('apiKey', e.target.value)}
                placeholder={form.provider === '0g-compute' ? 'Auto — uses agent wallet' : 'sk-...'}
                disabled={form.provider === '0g-compute'}
              />
            </FormField>
          </div>

          {form.provider === '0g-compute' && (
            <div className="mt-4 border border-cream/20 bg-cream/[0.03] px-4 py-3.5 text-[13px] leading-relaxed space-y-2">
              <div className="flex items-center gap-2 font-semibold text-cream">
                <Icon name="bolt" size={14} />
                <span>0G Compute — billed to agent wallet</span>
              </div>
              <div className="text-ink-2 space-y-1">
                {ogPricing[form.model] ? (
                  <p>
                    <span className="font-mono text-ink">{form.model}</span> pricing:
                    {' '}{(+ogPricing[form.model]!.promptUsd * 1000).toFixed(3)}¢ / 1K prompt tokens,
                    {' '}{(+ogPricing[form.model]!.completionUsd * 1000).toFixed(3)}¢ / 1K completion tokens.
                  </p>
                ) : ogPricing[form.model] === undefined ? (
                  <p className="text-ink-3">Loading pricing…</p>
                ) : null}
                <p>
                  Wallet receives <span className="font-mono text-ink">{OG_COMPUTE_DEPOSIT} 0G</span> —
                  covers the one-time ledger deposit (~1.0 0G) plus gas for many requests.
                </p>
              </div>
            </div>
          )}
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

        {/* 04 — Skills */}
        <div className="p-6 border-b border-line">
          <SectionRule num="04" title="Skills" side="Optional" />
          <FormField
            label="Install skills"
            hint="Reusable bundles of instructions + tools. Import from the open SKILL.md ecosystem or the registry — they shape how this agent actually works."
          >
            <SkillPicker
              selectedSlugs={skillSlugs}
              onChange={(slugs, caps) => {
                setSkillSlugs(slugs);
                // Auto-check the skills' capability tags in section 03.
                if (caps) setCapabilities((cs) => [...new Set([...cs, ...caps])]);
              }}
              secrets={toolSecrets}
              onSecretsChange={setToolSecrets}
              onImported={(slug, isPublic) => {
                if (!isPublic) setPrivateSkillSlugs((p) => (p.includes(slug) ? p : [...p, slug]));
              }}
            />
          </FormField>
        </div>

        {/* 05 — Tools & MCP servers */}
        <div className="p-6 border-b border-line">
          <SectionRule num="05" title="Tools & MCP servers" side="Optional" />
          <ToolManager tools={tools} onChange={setTools} secrets={toolSecrets} onSecretsChange={setToolSecrets} />
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
                  <li>Send <span className="font-mono">{fundAmount(form.provider)} {native.symbol}</span> to the new agent wallet — pays for its gas.</li>
                </ol>
                <div className="text-[13px] text-ink-3 pt-0.5">
                  Your wallet balance:{' '}
                  <span className="font-mono text-ink-2">
                    {ownerBalanceEther ? `${ownerBalanceEther.toFixed(4)} ${native.symbol}` : '…'}
                  </span>
                </div>
              </div>

              {!hasEnoughForDeploy && ownerBalanceEther > 0 && (
                <div className="mb-4 border border-err/40 bg-err/5 px-4 py-3.5 text-[13px] text-ink-2 leading-relaxed space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-err">
                    <Icon name="bolt" size={15} />
                    <span>Not enough {native.symbol} to fund the agent</span>
                  </div>
                  <p>
                    You need at least <span className="font-mono">{minBal} {native.symbol}</span> (fund
                    amount plus gas for the transfer). Top up your wallet at{' '}
                    <a href={OG_FAUCET_URL} target="_blank" rel="noreferrer" className="text-cream underline">faucet.0g.ai</a>
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
                        ? `Funding agent with ${fundAmount(form.provider)} ${native.symbol}…`
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

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWalletClient, useBalance } from 'wagmi';
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
  FormSelect,
  FormTextarea,
} from '../components/bb';
import { HeaderManager } from '../components/bb/HeaderManager';
import { QueryParamManager } from '../components/bb/QueryParamManager';
import { get, post } from '../lib/api';
import { AGENT_CAPABILITIES } from '../config/capabilities';
import { useChainAddress } from '../hooks/useChainWallet';
import { getNativeCurrency } from '../config/constants';

interface ToolParam {
  key: string;
  value?: string;
  required: boolean;
}

interface ToolHeader {
  key: string;
  value?: string;
  required: boolean;
}

interface Tool {
  type: 'http' | 'mcp';
  name: string;
  description: string;
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  toolName?: string;
  headers: ToolHeader[];
  queryParams: ToolParam[];
  body: { contentType: 'application/json' | 'application/x-www-form-urlencoded'; payload: string };
}

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

const emptyTool: Tool = {
  type: 'http', name: '', description: '', url: '', method: 'POST',
  headers: [], queryParams: [], body: { contentType: 'application/json', payload: '' }
};

export default function DeployAgentForm() {
  const native = getNativeCurrency('og');
  const address = useChainAddress();
  const { data: walletClient } = useWalletClient();
  const navigate = useNavigate();

  const [providers, setProviders] = useState<ProviderModels>({
    openai: ['gpt-4o', 'gpt-4o-mini'],
    anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'],
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

  const [tools, setTools] = useState<Tool[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [newTool, setNewTool] = useState<Tool>({ ...emptyTool });
  const [showToolForm, setShowToolForm] = useState(false);
  const [toolError, setToolError] = useState('');
  const [toolMode, setToolMode] = useState<'form' | 'json'>('form');
  const [jsonText, setJsonText] = useState('');
  const [jsonParseError, setJsonParseError] = useState('');
  const [testResult, setTestResult] = useState<{ status: number; body: string } | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testExpanded, setTestExpanded] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ url?: string; name?: string; body?: string }>({});

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

  function validateTool(tool: Tool, existingNames: string[]): { url?: string; name?: string; body?: string } {
    const errors: { url?: string; name?: string; body?: string } = {};
    if (!tool.url) {
      errors.url = 'URL is required.';
    } else {
      try {
        const parsed = new URL(tool.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          errors.url = 'URL must use http or https protocol.';
        }
      } catch {
        errors.url = 'URL must be a valid absolute URL (e.g. https://example.com/api).';
      }
    }
    if (!tool.name) {
      errors.name = 'Name is required.';
    } else if (/\s/.test(tool.name)) {
      errors.name = 'Name must not contain spaces.';
    } else if (existingNames.includes(tool.name)) {
      errors.name = 'Name must be unique among existing tools.';
    }
    if (tool.body.contentType === 'application/json' && tool.body.payload.trim()) {
      try {
        JSON.parse(tool.body.payload);
      } catch {
        errors.body = 'Body payload must be valid JSON.';
      }
    }
    return errors;
  }

  const toolValidation = validateTool(newTool, tools.map(t => t.name));
  const isToolValid = !toolValidation.url && !toolValidation.name && !toolValidation.body
    && newTool.name.trim() !== '' && newTool.url.trim() !== '';

  function syncJsonFromTool(tool: Tool) {
    const json: Record<string, unknown> = {
      type: tool.type === 'mcp' ? 'MCP' : 'HTTP',
      name: tool.name,
      url: tool.url,
      method: tool.method ?? 'POST',
      description: tool.description,
      query_parameters: tool.queryParams.map(p => ({ key: p.key, required: p.required })),
      headers: tool.headers.map(h => ({ key: h.key, required: h.required })),
      body_payload: tool.body.payload.trim() ? (() => { try { return JSON.parse(tool.body.payload); } catch { return null; } })() : null,
    };
    return JSON.stringify(json, null, 2);
  }

  function parseJsonToTool(text: string): { tool: Tool | null; error: string } {
    try {
      const obj = JSON.parse(text);
      if (typeof obj !== 'object' || obj === null) return { tool: null, error: 'JSON must be an object.' };
      const method = (obj.method ?? 'POST').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return { tool: null, error: `Invalid method: ${obj.method}. Must be GET, POST, PUT, PATCH, or DELETE.` };
      }
      const toolType = (obj.type ?? 'HTTP').toUpperCase();
      const tool: Tool = {
        type: toolType === 'MCP' ? 'mcp' : 'http',
        name: obj.name ?? '',
        url: obj.url ?? '',
        method: method as Tool['method'],
        description: obj.description ?? '',
        queryParams: Array.isArray(obj.query_parameters)
          ? obj.query_parameters.map((p: Record<string, unknown>) => ({ key: String(p.key ?? ''), value: '', required: Boolean(p.required) }))
          : [],
        headers: Array.isArray(obj.headers)
          ? obj.headers.map((h: Record<string, unknown>) => ({ key: String(h.key ?? ''), value: '', required: Boolean(h.required) }))
          : [],
        body: {
          contentType: 'application/json',
          payload: obj.body_payload != null ? JSON.stringify(obj.body_payload) : '',
        },
      };
      return { tool, error: '' };
    } catch {
      return { tool: null, error: 'Invalid JSON — could not parse.' };
    }
  }

  function switchToFormMode() {
    const { tool, error: parseErr } = parseJsonToTool(jsonText);
    if (parseErr) {
      setJsonParseError(parseErr);
      return;
    }
    if (tool) setNewTool(tool);
    setJsonParseError('');
    setToolMode('form');
  }

  function switchToJsonMode() {
    setJsonText(syncJsonFromTool(newTool));
    setJsonParseError('');
    setToolMode('json');
  }

  function addTool() {
    setToolError('');
    setFieldErrors({});
    const errs = validateTool(newTool, tools.map(t => t.name));
    if (errs.url || errs.name || errs.body) {
      setFieldErrors(errs);
      setToolError('Please fix the errors above before adding the tool.');
      return;
    }
    setTools(t => [...t, newTool]);
    setNewTool({ ...emptyTool });
    setJsonText('');
    setShowToolForm(false);
    setTestResult(null);
    setFieldErrors({});
  }

  async function testCall() {
    setTestLoading(true);
    setTestResult(null);
    setTestExpanded(true);
    try {
      let url = newTool.url;
      const requiredParams = newTool.queryParams.filter(p => p.required && p.key);
      const qs = requiredParams.map(p => `${encodeURIComponent(p.key)}=placeholder`).join('&');
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;

      const init: RequestInit = { method: newTool.method ?? 'POST' };
      const headers: Record<string, string> = {};
      for (const h of newTool.headers) {
        if (h.key) headers[h.key] = h.value ?? 'placeholder';
      }
      if (['POST', 'PUT', 'PATCH'].includes(newTool.method ?? 'POST') && newTool.body.payload.trim()) {
        headers['Content-Type'] = newTool.body.contentType;
        init.body = newTool.body.payload;
      }
      if (Object.keys(headers).length) init.headers = headers;

      const res = await fetch(url, init);
      const bodyText = await res.text();
      setTestResult({ status: res.status, body: bodyText.slice(0, 5000) });
    } catch (err) {
      setTestResult({ status: 0, body: (err as Error).message });
    } finally {
      setTestLoading(false);
    }
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
              onClick={() => { setStatus('idle'); setAgentId(''); setFundingSkipped(false); }}
            />
          </div>
          </div>
        </div>
    );
  }

  const showBody = newTool.type === 'http' && newTool.method && !['GET', 'DELETE'].includes(newTool.method);

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
                {/* Mode toggle */}
                <div className="flex items-center gap-0 border border-line w-fit">
                  <button
                    type="button"
                    onClick={() => { if (toolMode !== 'form') switchToFormMode(); }}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors ${toolMode === 'form' ? 'bg-cream/10 text-cream' : 'text-ink-3 hover:text-ink-2'}`}
                  >
                    Form
                  </button>
                  <div className="w-px h-4 bg-line"></div>
                  <button
                    type="button"
                    onClick={() => { if (toolMode !== 'json') switchToJsonMode(); }}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors ${toolMode === 'json' ? 'bg-cream/10 text-cream' : 'text-ink-3 hover:text-ink-2'}`}
                  >
                    Paste JSON
                  </button>
                </div>

                {toolMode === 'form' ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField label="Type">
                        <FormSelect
                          value={newTool.type}
                          onChange={e => setNewTool(t => ({ ...t, type: e.target.value as 'http' | 'mcp' }))}
                        >
                          <option value="http">HTTP</option>
                          <option value="mcp">MCP</option>
                        </FormSelect>
                      </FormField>
                      <FormField label="Name">
                        <FormInput
                          value={newTool.name}
                          onChange={e => setNewTool(t => ({ ...t, name: e.target.value }))}
                          placeholder="web-search"
                        />
                        {fieldErrors.name && <p className="text-xs text-err mt-1">{fieldErrors.name}</p>}
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
                        {fieldErrors.url && <p className="text-xs text-err mt-1">{fieldErrors.url}</p>}
                      </FormField>
                      {newTool.type === 'http' && (
                        <FormField label="Method">
                          <FormSelect
                            value={newTool.method ?? 'POST'}
                            onChange={e => setNewTool(t => ({ ...t, method: e.target.value as Tool['method'] }))}
                            className="font-mono"
                          >
                            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
                          </FormSelect>
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
                        {showBody && (
                          <FormField label="Body payload">
                            <FormSelect
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
                            >
                              <option value="application/json">JSON</option>
                              <option value="application/x-www-form-urlencoded">Form URL encoded</option>
                            </FormSelect>

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
                                params={newTool.body.payload ? (() => { try { return JSON.parse(newTool.body.payload); } catch { return []; } })() : []}
                                onChange={(p) => setNewTool(t => ({ ...t, body: { ...t.body, payload: JSON.stringify(p) } }))}
                              />
                            )}
                            {fieldErrors.body && <p className="text-xs text-err mt-1">{fieldErrors.body}</p>}
                          </FormField>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  /* JSON mode */
                  <FormField label="Tool JSON">
                    <FormTextarea
                      rows={12}
                      className="font-mono text-xs"
                      value={jsonText}
                      onChange={e => {
                        setJsonText(e.target.value);
                        const { tool, error } = parseJsonToTool(e.target.value);
                        if (tool) setNewTool(tool);
                        setJsonParseError(error);
                      }}
                      placeholder='{"type":"HTTP","name":"...","url":"https://..."}'
                    />
                    {jsonParseError && <p className="text-xs text-err mt-1">{jsonParseError}</p>}
                  </FormField>
                )}

                {toolError && <p className="text-xs text-err">{toolError}</p>}

                {/* Test call + collapsible response */}
                <div className="space-y-2">
                  <div className="flex gap-3 pt-1 items-center flex-wrap">
                    <Button
                      type="button"
                      variant="primary"
                      label="Add tool"
                      onClick={addTool}
                      disabled={!isToolValid}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      label={testLoading ? 'Testing…' : 'Test call'}
                      onClick={testCall}
                      disabled={testLoading || !newTool.url.trim()}
                    />
                    <Button type="button" variant="ghost" label="Cancel" onClick={() => { setShowToolForm(false); setToolError(''); setTestResult(null); setFieldErrors({}); }} />
                  </div>
                  {testResult && (
                    <div className="border border-line">
                      <button
                        type="button"
                        onClick={() => setTestExpanded(!testExpanded)}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs text-ink-2 hover:bg-surface-2 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${testResult.status === 0 ? 'bg-err' : testResult.status >= 200 && testResult.status < 300 ? 'bg-ok' : testResult.status >= 400 ? 'bg-err' : 'bg-warn'}`}></span>
                          Response: {testResult.status === 0 ? 'Network error' : `${testResult.status}`}
                        </span>
                        <span className="text-ink-3">{testExpanded ? '▲' : '▼'}</span>
                      </button>
                      {testExpanded && (
                        <pre className="px-3 py-2 bg-surface-2 text-xs font-mono text-ink-2 overflow-x-auto max-h-64 overflow-y-auto border-t border-line whitespace-pre-wrap break-all">
                          {testResult.body || '(empty response)'}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                label="+ Add tool or MCP server"
                onClick={() => { setShowToolForm(true); setToolError(''); setToolMode('form'); setJsonText(''); setTestResult(null); setFieldErrors({}); }}
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

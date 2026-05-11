import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useWalletClient } from 'wagmi';
import { getIdentityToken, getAccessToken } from '@privy-io/react-auth';
import { BrowserProvider, Contract, parseUnits, formatUnits } from 'ethers';
import { Breadcrumb, PageHeader, SectionRule } from '../components/bb';
import { MintTestTokensCard } from '../components/MintTestTokensCard';
import { aesEncrypt, generateAesKey, sha256, toBase64, toBytes } from '../lib/crypto';
import { signAndSendTx } from '../lib/txSigner';
import { authedPost } from '../lib/api';
import { trackEvent } from '../hooks/useAnalytics';
import { BLIND_ESCROW_ADDRESS } from '../config/constants';

// Suggested categories surfaced via <datalist> on the category input — these
// are popular hints, not the full set. The category field is free-text
// (backend accepts any string 1..64 chars) so the poster can describe whatever
// their task actually is rather than being forced into "other".
// BlindEscrow contract's hard bounds on `duration` (seconds).
// Source: BlindEscrow.sol:64-65 — MIN_DEADLINE = 1 hours, MAX_DEADLINE = 90 days.
const MIN_DURATION_SECONDS = 60 * 60;          // 1 hour
const MAX_DURATION_SECONDS = 90 * 24 * 60 * 60; // 90 days

/** Format a Date as the value `<input type="datetime-local">` expects: YYYY-MM-DDTHH:mm in local TZ. */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Default deadline: 24h from now. Calculated once at module load — fine
 *  since the page is short-lived. */
const DEFAULT_DEADLINE_AT = toDatetimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000));
const MIN_DEADLINE_AT = toDatetimeLocal(new Date(Date.now() + MIN_DURATION_SECONDS * 1000));
const MAX_DEADLINE_AT = toDatetimeLocal(new Date(Date.now() + MAX_DURATION_SECONDS * 1000));

/** Human-readable "expires in 2 hours" / "expires in 3 days" hint. */
function durationHint(secs: number): string {
  if (secs <= 0) return 'in the past — pick a later time';
  if (secs < 60 * 60) return `${Math.round(secs / 60)} minutes from now`;
  if (secs < 24 * 60 * 60) return `${Math.round(secs / 3600)} hours from now`;
  return `${Math.round(secs / 86400)} days from now`;
}

const CATEGORY_SUGGESTIONS = [
  'photography',
  'research',
  'verification',
  'data-collection',
  'transcription',
  'writing',
  'translation',
  'code-review',
  'analysis',
];

// Mirrors the backend AGENT_CAPABILITIES enum (backend/src/types.ts:86) and
// the register-tab list in A2ADashboard.tsx. Tasks need at least one match
// for an executor to surface them in the agent_board capability filter.
const AGENT_CAPABILITIES = [
  'data_processing', 'web_research', 'code_execution', 'content_generation',
  'api_integration', 'text_analysis', 'translation', 'summarization',
  'image_analysis', 'document_processing', 'math_computation', 'data_extraction',
  'report_generation', 'code_review', 'testing', 'scheduling',
  'email_drafting', 'social_media', 'market_research', 'competitive_analysis',
] as const;
const TOKEN = import.meta.env.VITE_MOCK_ERC20_ADDRESS ?? '0x3af9232009C5da30AdA366B6E09849A040162A1a';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function allowance(address owner, address spender) public view returns (uint256)',
  'function balanceOf(address account) public view returns (uint256)',
  'function decimals() public view returns (uint8)',
];

export default function PostTask() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    instructions: '',
    category: '',
    locationZone: 'global',
    amount: '10',
    // Stored as a datetime-local string (YYYY-MM-DDTHH:mm). Converted to a
    // seconds-from-now duration at submit time — the contract takes duration,
    // not an absolute date, so this is a UX layer over the on-chain primitive.
    deadlineAt: DEFAULT_DEADLINE_AT,
  });
  // Pure A2A surface — every task posted from this UI is an agent-targeted
  // task that auto-verifies on submission. The executor toggle and
  // verification-mode picker are removed; we hardcode the values that drive
  // the autonomous flow. The H2A manual-approval path still lives in the
  // backend (/a2a/verify) for the A2H roadmap; it's just not exposed here.
  const [status, setStatus] = useState<'idle' | 'encrypting' | 'approving' | 'signing' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [requiredCaps, setRequiredCaps] = useState<string[]>([]);

  const toggleCap = (cap: string) =>
    setRequiredCaps(prev => (prev.includes(cap) ? prev.filter(c => c !== cap) : [...prev, cap]));

  useEffect(() => {
    trackEvent('post_task_view');
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address || !walletClient) return;

    try {
      setStatus('encrypting');
      setError('');

      if (requiredCaps.length === 0) {
        throw new Error('Pick at least one required capability so executor agents can match your task.');
      }

      // Prefer the identity token (has linked_accounts → backend can derive
      // the wallet address from did:privy claims); fall back to the access
      // token so unlinked sessions still work.
      const idTok = await getIdentityToken();
      const accTok = await getAccessToken();
      const token = idTok || accTok;
      if (!token) throw new Error('No authentication token available. Please try logging out and back in.');

      // 0. Handle Token Approval if needed
      console.log('[PostTask] Initializing provider for approval check...');
      const provider = new BrowserProvider(walletClient.transport);
      const signer = await provider.getSigner();
      const tokenContract = new Contract(TOKEN, ERC20_ABI, signer);
      
      const decimalsRaw = await tokenContract.decimals().catch(() => 18);
      const decimals = Number(decimalsRaw);
      const amountWei = parseUnits(form.amount, decimals);

      try {
        console.log(`[PostTask] Checking balance and allowance for ${address} on token ${TOKEN} (${decimals} decimals)...`);
        const [balance, allowance] = await Promise.all([
          tokenContract.balanceOf(address),
          tokenContract.allowance(address, BLIND_ESCROW_ADDRESS)
        ]);
        
        console.log(`[PostTask] Balance: ${balance.toString()}, Allowance: ${allowance.toString()}, Required: ${amountWei.toString()}`);
        
        if (balance < amountWei) {
          throw new Error(`Insufficient balance. You need ${form.amount} tokens, but only have ${formatUnits(balance, decimals)}.`);
        }
        
        if (allowance < amountWei) {
          setStatus('approving');
          console.log(`[PostTask] Requesting approval for ${amountWei.toString()}...`);
          const tx = await tokenContract.approve(BLIND_ESCROW_ADDRESS, amountWei);
          const explorerLink = `https://chainscan-galileo.0g.ai/tx/${tx.hash}`;
          console.log(`[PostTask] Approval TX sent: ${tx.hash}`);
          console.log(`[PostTask] Track it here: ${explorerLink}`);
          await tx.wait();
          console.log('[PostTask] Approval confirmed.');
        } else {
          console.log('[PostTask] Sufficient allowance already exists.');
        }
      } catch (err: any) {
        console.error('[PostTask] Approval error:', err);
        throw new Error(`Failed to check/approve tokens: ${err.message || 'Unknown error'}. Is the token address ${TOKEN} correct for this network?`);
      }

      // 1. Encrypt instructions browser-side
      setStatus('encrypting');
      console.log('[PostTask] Encrypting instructions...');
      const key = generateAesKey();
      const plaintext = toBytes(form.instructions);
      const ciphertext = await aesEncrypt(plaintext, key);
      const blob = toBase64(ciphertext);
      const taskHash = '0x' + await sha256(ciphertext);

      // 2. Upload encrypted blob to storage
      await authedPost<any>('/api/v1/storage/upload', { data: blob }, token);

      // 3. Compute duration (seconds from now) from the chosen deadline.
      //    Re-evaluate at submit time so the value is accurate even if the
      //    form sat open for a while between picking the deadline and clicking
      //    submit.
      const deadlineMs = new Date(form.deadlineAt).getTime();
      if (Number.isNaN(deadlineMs)) throw new Error('Invalid deadline — pick a date and time.');
      const durationSecs = Math.floor((deadlineMs - Date.now()) / 1000);
      if (durationSecs < MIN_DURATION_SECONDS) {
        throw new Error(`Deadline must be at least 1 hour from now (got ${durationSecs}s).`);
      }
      if (durationSecs > MAX_DURATION_SECONDS) {
        throw new Error('Deadline cannot be more than 90 days out.');
      }

      // 4. Get unsigned tx from backend
      const taskJson = await authedPost<any>('/api/v1/tasks', {
        taskHash,
        token: TOKEN,
        amount: amountWei.toString(),
        category: form.category,
        locationZone: form.locationZone,
        duration: String(durationSecs),
        // Hardcoded A2A: every task posted from this UI targets agents and
        // auto-verifies on submission. Settlement bridge closes the on-chain
        // loop without further input. Posters who want manual review or
        // human-targeted tasks would call /api/v1/tasks directly.
        targetExecutorType: 'agent' as const,
        verificationMode: 'auto' as const,
        verificationCriteria: { min_length: 10 },
        requiredCapabilities: requiredCaps,
      }, token);

      // 5. Sign and send via MetaMask
      setStatus('signing');
      console.log(`[PostTask] Signing registration TX...`);
      const receipt = await signAndSendTx(signer, taskJson.unsignedTx);
      const txHash = receipt?.hash ?? taskJson.unsignedTx?.hash ?? '';
      console.log(`[PostTask] Task TX submitted: ${txHash}`);
      console.log('[PostTask] Task creation confirmed.');

      setTaskId(taskJson.taskId ?? null);
      setStatus('done');
      trackEvent('task_posted', {
        taskId: taskJson.taskId ?? null,
        category: form.category,
        amount: Number(form.amount),
      });
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
      trackEvent('task_post_error', { message: (err as Error).message });
    }
  }

  const busy = status === 'encrypting' || status === 'approving' || status === 'signing';

  return (
    <div>
      <Breadcrumb items={['tasks', 'post']} />
      <PageHeader
        title="Post a task for agent execution"
        description="Encrypt your instructions, lock payment in escrow. An autonomous agent accepts, completes, and auto-verifies — settlement happens on chain without you signing again."
      />

      <MintTestTokensCard />

      {status === 'done' ? (
        <div className="border border-line p-8 text-center space-y-4">
          <div className="text-xs font-mono text-green-400 uppercase tracking-widest">✓ task posted</div>
          {taskId && <div className="text-xs font-mono text-ink-3">task #{taskId}</div>}
          <div className="text-xs font-mono text-ink-3">instructions encrypted · payment locked in escrow</div>
          <button
            onClick={() => navigate('/tasks')}
            className="mt-4 px-4 py-2 border border-line text-xs font-mono text-cream hover:bg-surface-2"
          >
            view task feed →
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="border border-line">
          <div className="p-6 border-b border-line">
            <SectionRule num="01" title="task details" />
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-mono uppercase tracking-widest text-ink-3 mb-2">
                  instructions <span className="text-cream">*</span>
                </label>
                <textarea
                  required
                  rows={5}
                  value={form.instructions}
                  onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                  placeholder="Describe exactly what needs to be done. This will be encrypted — only the assigned agent can read it."
                  className="w-full bg-surface-2 border border-line px-4 py-3 text-xs font-mono text-ink placeholder-ink-3 focus:outline-none focus:border-cream resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-mono uppercase tracking-widest text-ink-3 mb-2">category</label>
                  <input
                    type="text"
                    required
                    maxLength={64}
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="describe it — or pick a suggestion below"
                    className="w-full bg-surface-2 border border-line px-4 py-3 text-xs font-mono text-ink placeholder-ink-3 focus:outline-none focus:border-cream"
                  />
                  {/* Suggestion chips — single wrapped row, click to fill the
                      input. Compact and always visible; the native <datalist>
                      took 10+ lines of dropdown space which was too much. */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {CATEGORY_SUGGESTIONS.map(c => {
                      const active = form.category === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, category: c }))}
                          className={`px-2 py-0.5 text-[10px] font-mono border transition-colors ${
                            active
                              ? 'border-cream text-cream bg-cream/10'
                              : 'border-line text-ink-3 hover:border-ink-2 hover:text-ink-2'
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase tracking-widest text-ink-3 mb-2">location zone</label>
                  <input
                    type="text"
                    value={form.locationZone}
                    onChange={e => setForm(f => ({ ...f, locationZone: e.target.value }))}
                    placeholder="global, US-NY, EU, etc."
                    className="w-full bg-surface-2 border border-line px-4 py-3 text-xs font-mono text-ink placeholder-ink-3 focus:outline-none focus:border-cream"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase tracking-widest text-ink-3 mb-2">
                  required capabilities <span className="text-cream">*</span>
                  <span className="ml-2 normal-case tracking-normal text-ink-3/70">
                    ({requiredCaps.length} selected — at least one required)
                  </span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {AGENT_CAPABILITIES.map((cap) => {
                    const active = requiredCaps.includes(cap);
                    return (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => toggleCap(cap)}
                        className={`px-2.5 py-1 text-[11px] font-mono border transition-colors ${
                          active
                            ? 'bg-cream/10 border-cream/40 text-cream'
                            : 'bg-surface-2 border-line text-ink-3 hover:text-ink-2'
                        }`}
                      >
                        {cap}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 text-[11px] font-mono text-ink-3">
                  pick every skill your task needs. an executor agent matches if it has any one.
                </div>
              </div>

              {/* A2A-only flow — explicit info banner replaces the old
                  executor + verification pickers. Every task posted here
                  targets an agent and auto-verifies on submission. */}
              <div className="border border-line bg-surface-2 px-4 py-3 text-[11px] font-mono text-ink-3 leading-relaxed">
                <span className="text-cream">a2a · auto-verify:</span> tasks
                posted here are visible to autonomous agents at <code className="text-ink-2">/a2a</code>.
                Submissions are checked against built-in criteria (min length, required fields)
                and escrow releases automatically — no further input from you.
              </div>
            </div>
          </div>

          <div className="p-6 border-b border-line">
            <SectionRule num="02" title="payment" />
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-mono uppercase tracking-widest text-ink-3 mb-2">
                  bounty (USDC) <span className="text-cream">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full bg-surface-2 border border-line px-4 py-3 text-xs font-mono text-ink focus:outline-none focus:border-cream"
                />
                <div className="mt-1 text-[11px] font-mono text-ink-3">85% to worker · 15% protocol fee</div>
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase tracking-widest text-ink-3 mb-2">deadline</label>
                <input
                  type="datetime-local"
                  min={MIN_DEADLINE_AT}
                  max={MAX_DEADLINE_AT}
                  required
                  value={form.deadlineAt}
                  onChange={e => setForm(f => ({ ...f, deadlineAt: e.target.value }))}
                  className="w-full bg-surface-2 border border-line px-4 py-3 text-xs font-mono text-ink focus:outline-none focus:border-cream"
                />
                {/* Live human-readable hint — recomputed each render so the
                    user sees the offset shrink in real time if they're slow. */}
                <div className="mt-1 text-[11px] font-mono text-ink-3">
                  {(() => {
                    const ms = new Date(form.deadlineAt).getTime();
                    if (Number.isNaN(ms)) return 'pick a date and time · min 1 hour · max 90 days';
                    const secs = Math.floor((ms - Date.now()) / 1000);
                    return durationHint(secs);
                  })()}
                </div>
              </div>
            </div>
          </div>

          <div className="p-6">
            {!address ? (
              <div className="text-xs font-mono text-ink-3">connect wallet to post a task</div>
            ) : (
              <button
                type="submit"
                disabled={busy || requiredCaps.length === 0}
                title={requiredCaps.length === 0 ? 'select at least one required capability above' : undefined}
                className="px-6 py-3 border border-cream text-xs font-mono text-cream hover:bg-cream hover:text-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {status === 'encrypting' ? 'encrypting…' : status === 'approving' ? 'approving…' : status === 'signing' ? 'sign in wallet…' : 'encrypt + post task →'}
              </button>
            )}
            {status === 'error' && (
              <div className="mt-3 text-xs font-mono text-red-400">{error}</div>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

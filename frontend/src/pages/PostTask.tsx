import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useWalletClient } from 'wagmi';
import { getIdentityToken, getAccessToken } from '@privy-io/react-auth';
import { BrowserProvider, parseUnits, formatUnits } from 'ethers';
import {
  Breadcrumb,
  PageHeader,
  SectionRule,
  FormField,
  FormInput,
  FormTextarea,
  Button,
  Tag,
  StatusTag,
  Icon,
} from '../components/bb';
import { aesEncrypt, eciesEncrypt, generateAesKey, sha256, toBase64, toBytes } from '../lib/crypto';
import { stashAesKey } from '../lib/keyStash';
import { signAndSendTx } from '../lib/txSigner';
import { authedGet, authedPost } from '../lib/api';
import { trackEvent } from '../hooks/useAnalytics';
import { MARKETPLACE_TOKEN_ADDRESS } from '../config/constants';

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

import { AGENT_CAPABILITIES } from '../config/capabilities';

  // Pulled from the shared constants module so the address lives in exactly
  // one place. AgentDetail's /withdraw call uses the same value when
  // withdrawing ERC20 tokens.
  const TOKEN = MARKETPLACE_TOKEN_ADDRESS;

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
  // Snapshot of how many executors the AES key was wrapped to at post time.
  // Drives the post-success copy: a non-zero count means at least one agent
  // can /accept immediately; zero means the task is awaiting bids and the
  // poster has to revisit /my_tasks for useBidWatcher() to ship slices.
  const [initialWrapCount, setInitialWrapCount] = useState<number>(0);

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

      // 0. Handle Payment (Native 0G)
      console.log('[PostTask] Initializing provider for payment setup...');
      const provider = new BrowserProvider(walletClient.transport);
      const signer = await provider.getSigner();

      // Treat input as 0G units (18 decimals)
      const amountWei = parseUnits(form.amount, 18);

      // 1. Discover eligible executors
      console.log('[PostTask] Looking up matching executors...');
      const capsQS = encodeURIComponent(requiredCaps.join(','));
      // authedGet unwraps to `body.data` (see api.ts:23), so T is the inner
      // payload — not the {success, data} envelope.
      const execResp = await authedGet<{
        executors: Array<{ address: string; publicKey: string; capabilities: string[]; reputation: number }>;
      }>(`/api/v1/a2a/executors?capabilities=${capsQS}`, token);
      const executors = execResp.executors ?? [];
      console.log(`[PostTask] ${executors.length} matching executor(s) found at post time`);

      // 2. Encrypt instructions browser-side
      setStatus('encrypting');
      console.log('[PostTask] Encrypting instructions...');
      const key = generateAesKey();
      const plaintext = toBytes(form.instructions);
      const ciphertext = await aesEncrypt(plaintext, key);
      const blob = toBase64(ciphertext);
      const taskHash = '0x' + await sha256(ciphertext);

      // 3. Upload encrypted blob to storage and capture the rootHash so the
      //    backend can persist it in A2A meta. Without rootHash the executor
      //    has no pointer to fetch the encrypted blob.
      const uploadResp = await authedPost<{ rootHash: string; txHash?: string }>(
        '/api/v1/storage/upload',
        { data: blob },
        token,
      );
      const rootHash = uploadResp.rootHash;
      if (!rootHash) throw new Error('Storage upload returned no rootHash');
      console.log(`[PostTask] Encrypted blob uploaded — rootHash ${rootHash.slice(0, 12)}…`);

      // 4. ECIES-wrap the AES key to every currently-matching executor. The
      //    backend stores this bundle so /accept can return the slice the
      //    accepting executor needs — and only that slice — for decryption.
      //    The marketplace never sees the AES key in plaintext: privacy
      //    invariant from PITCH.md preserved.
      //
      //    If zero executors match (or all wraps fail), wrappedKeys is empty
      //    and the task posts as "awaiting bids" — useBidWatcher() will wrap
      //    to new bidders as they /bid. We stash the AES key locally first
      //    so the watcher has something to wrap *with* on the next tick.
      stashAesKey(taskHash, key);
      const wrappedKeys: Record<string, string> = {};
      for (const exec of executors) {
        try {
          const wrappedBytes = await eciesEncrypt(key, exec.publicKey);
          const wrappedHex = Array.from(wrappedBytes, (b) => b.toString(16).padStart(2, '0')).join('');
          wrappedKeys[exec.address.toLowerCase()] = wrappedHex;
        } catch (e) {
          // Skip an executor with a malformed pubkey rather than fail the
          // entire post — log so we can flag the bad registration later.
          console.warn(`[PostTask] Skipped ${exec.address} (wrap failed):`, (e as Error).message);
        }
      }
      console.log(
        `[PostTask] AES key wrapped to ${Object.keys(wrappedKeys).length}/${executors.length} executor(s); ` +
        `stashed locally for post-hoc bidders`,
      );

      // 4b. ALSO seal the AES key to the platform key-custody key, if enabled.
      //     This lets an agent that registers AFTER this post be served a
      //     re-wrapped slice on /accept with no poster present — fixing the
      //     "human posts a seed task, an agent shows up two days later" gap
      //     (docs/TEE-REWRAP-SPEC.md). Best-effort: a custody failure must NOT
      //     block the post; the browser/agent wrap loops remain the fallback.
      //     When custody is off the endpoint returns { enabled:false } and we
      //     skip sealing entirely.
      let keyCustodyBlob: { keyId: string; blob: string } | undefined;
      try {
        const custodyKey = await authedGet<{
          enabled: boolean;
          keyId: string | null;
          publicKey: string | null;
          attestation: string | null;
        }>('/api/v1/a2a/key-custody/pubkey', token);
        if (custodyKey.enabled && custodyKey.keyId && custodyKey.publicKey) {
          // The local (operator-trusted) backend returns attestation:null. When
          // an attested backend (TDX / 0G oracle) ships, VERIFY
          // custodyKey.attestation here before sealing — sealing to an
          // unattested key in that mode would silently trust the operator.
          const sealedBytes = await eciesEncrypt(key, custodyKey.publicKey);
          const sealedHex = Array.from(sealedBytes, (b) => b.toString(16).padStart(2, '0')).join('');
          keyCustodyBlob = { keyId: custodyKey.keyId, blob: sealedHex };
          console.log('[PostTask] AES key sealed to key-custody — late joiners can pick up unattended');
        }
      } catch (e) {
        console.warn('[PostTask] key-custody seal skipped:', (e as Error).message);
      }

      // 5. Compute duration (seconds from now) from the chosen deadline.
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

      // 6. Get unsigned tx from backend (with the rootHash + wrappedKeys bundle)
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
        rootHash,
        wrappedKeys,
      }, token);

      // 7. Sign and send via MetaMask
      setStatus('signing');
      console.log(`[PostTask] Signing registration TX with value ${amountWei}...`);
      const receipt = await signAndSendTx(signer, taskJson.unsignedTx, BigInt(amountWei));
      const txHash = receipt?.hash ?? taskJson.unsignedTx?.hash ?? '';
      console.log(`[PostTask] Task TX confirmed: hash=${txHash} block=${receipt?.blockNumber}`);

      // 8. Register A2A meta on the backend, gated on the receipt. Previously
      //    meta was written eagerly in step 6 — but if the createTask tx
      //    reverted (TokenNotAllowed, gas shortfall, etc.) Redis kept a
      //    phantom entry that agents could accept and decrypt but never
      //    submit against. The /a2a/tasks/index endpoint re-parses the
      //    TaskCreated event server-side and only persists meta once it has
      //    confirmed the on-chain task exists.
      await authedPost('/api/v1/a2a/tasks/index', {
        txHash,
        taskHash,
        verificationMode: 'auto' as const,
        verificationCriteria: { min_length: 10 },
        requiredCapabilities: requiredCaps,
        rootHash,
        wrappedKeys,
        // Only sent when key-custody is enabled (else undefined → omitted by
        // JSON.stringify). Lets the backend self-heal late joiners on /accept.
        keyCustodyBlob,
      }, token);

      setTaskId(taskJson.taskId ?? null);
      setInitialWrapCount(Object.keys(wrappedKeys).length);
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

  const submitLabel =
    status === 'encrypting' ? 'Encrypting…'
      : status === 'approving' ? 'Approving…'
        : status === 'signing' ? 'Sign in wallet…'
          : 'Encrypt and post task';

  return (
    <div>
      <Breadcrumb items={['tasks', 'post']} />
      <PageHeader
        title="Post a task"
        description="Encrypt your instructions and lock payment in escrow. An autonomous agent accepts, completes, and auto-verifies — settlement happens on chain without you signing again."
      />

      {status === 'done' ? (
        <div className="border border-line">
          <div className="p-6 sm:p-8 border-b border-line flex flex-col items-center text-center gap-3">
            <div className="w-11 h-11 border border-ok/50 bg-ok/5 flex items-center justify-center text-ok">
              <Icon name="check" size={20} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <span className="text-lg font-semibold text-ink">Task posted</span>
                <StatusTag status="posted" />
              </div>
              {taskId && (
                <div className="text-sm text-ink-3">
                  Task ID <span className="font-mono text-ink-2">#{taskId}</span>
                </div>
              )}
              <div className="text-sm text-ink-3">Instructions encrypted, payment locked in escrow.</div>
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {initialWrapCount > 0 ? (
              // Case A — at least one matching agent was wrapped at post-time, so
              // the brief can be decrypted without any further action from the
              // poster. No need to keep a tab alive.
              <div className="border border-ok/40 bg-ok/5 p-4 sm:p-5 space-y-3">
                <div className="flex items-center gap-2 text-ok">
                  <Icon name="check" size={16} />
                  <span className="text-sm font-semibold">Ready for pickup</span>
                </div>
                <p className="text-sm text-ink-2 leading-relaxed">
                  Encrypted brief wrapped to{' '}
                  <span className="font-mono text-ink font-semibold">{initialWrapCount}</span>{' '}
                  matching agent{initialWrapCount === 1 ? '' : 's'}. A worker can accept this any time.
                </p>
                <p className="text-sm text-ink-3 leading-relaxed">
                  You can close this tab — the task will be picked up whether you're here or not.
                </p>
              </div>
            ) : (
              // Case B — no matching executors at post-time. The AES key lives
              // only in this browser; wraps to future bidders are issued by
              // useBidWatcher() running on /tasks/mine. Make the obligation
              // explicit so users don't post tasks and walk away expecting them
              // to be picked up unattended.
              <div className="border border-warn/50 bg-warn/5 p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2 text-warn">
                  <Icon name="clock" size={16} />
                  <span className="text-sm font-semibold">Awaiting first bidder</span>
                </div>
                <p className="text-sm text-ink-2 leading-relaxed">
                  No agent with matching capabilities is registered yet. Your task is encrypted
                  and posted, but when an agent bids we need{' '}
                  <span className="text-ink font-semibold">your browser</span> to ship the
                  encryption key — the platform can't see it.
                </p>
                <ul className="text-sm text-ink-2 leading-relaxed space-y-2">
                  <li className="flex gap-2">
                    <Icon name="arrow" size={14} className="text-cream shrink-0 mt-1" />
                    <span>
                      <span className="text-ink font-semibold">Keep My Tasks open in a background tab.</span>{' '}
                      It auto-wraps as bids arrive (every 8s). You can do anything else in your browser.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Icon name="arrow" size={14} className="text-cream shrink-0 mt-1" />
                    <span>
                      Or just come back later. One visit to My Tasks unblocks every pending bid
                      in a few seconds.
                    </span>
                  </li>
                </ul>
                <div className="flex gap-2.5 pt-1 border-t border-warn/20 mt-1">
                  <Icon name="lock" size={16} className="text-err shrink-0 mt-3" />
                  <p className="text-sm text-err leading-relaxed pt-2.5">
                    The encryption key for this task lives only in this browser until an agent is
                    wrapped. If you clear this browser's data (or switch devices) before then, the
                    key is lost and the task becomes permanently undecryptable — by anyone. Get a
                    matching agent registered, or revisit My Tasks, before clearing anything.
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 sm:justify-center pt-1">
              <Button
                variant="primary"
                label={initialWrapCount > 0 ? 'View my tasks' : 'Open my tasks'}
                onClick={() => navigate('/tasks/mine')}
              />
              {initialWrapCount === 0 && (
                // Power-user shortcut: opens /tasks/mine in a new tab so the user
                // can leave it running as a background watcher while keeping this
                // tab around to post more tasks.
                <Button
                  variant="outline"
                  label="Open in new tab"
                  onClick={() => window.open('/tasks/mine', '_blank', 'noopener')}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="border border-line">
          <div className="p-6 border-b border-line">
            <SectionRule num="01" title="Task details" />
            <div className="space-y-5">
              <FormField
                label="Instructions"
                required
                hint="This will be encrypted — only the assigned agent can read it."
              >
                <FormTextarea
                  required
                  rows={5}
                  value={form.instructions}
                  onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                  placeholder="Describe exactly what needs to be done."
                />
              </FormField>

              {/* Stack category + location on phones — at 2-col on a 439px
                  viewport the placeholder gets clipped. Side-by-side returns at sm. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Category" required>
                  <FormInput
                    type="text"
                    required
                    maxLength={64}
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="Describe it, or pick a suggestion below"
                  />
                  {/* Auto-fill grid keeps suggestion chips on a regular column
                      rhythm instead of the ragged wrap a plain flex produces.
                      Each cell is ≥90px and stretches to fill. Category tokens
                      are data values, so they stay font-mono. */}
                  <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-1.5">
                    {CATEGORY_SUGGESTIONS.map(c => {
                      const active = form.category === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, category: c }))}
                          className={`px-2 py-1 text-[10px] font-mono border transition-colors text-center ${active
                            ? 'border-cream text-cream bg-cream/10'
                            : 'border-line text-ink-3 hover:border-ink-2 hover:text-ink-2'
                            }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </FormField>
                <FormField label="Location zone" hint="Where the work applies, if it matters.">
                  <FormInput
                    type="text"
                    value={form.locationZone}
                    onChange={e => setForm(f => ({ ...f, locationZone: e.target.value }))}
                    placeholder="global, US-NY, EU, etc."
                  />
                </FormField>
              </div>

              <FormField
                label="Required capabilities"
                required
                hint="Pick every skill your task needs. An executor agent matches if it has any one."
              >
                <div className="mb-2 text-xs text-ink-3">
                  <span className="font-mono text-ink-2">{requiredCaps.length}</span> selected — at least one required
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {AGENT_CAPABILITIES.map((cap) => {
                    const active = requiredCaps.includes(cap);
                    return (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => toggleCap(cap)}
                        className={`px-2.5 py-1 text-xs border transition-colors ${active
                          ? 'bg-cream/10 border-cream/40 text-cream'
                          : 'bg-surface-2 border-line text-ink-3 hover:text-ink-2'
                          }`}
                      >
                        {cap}
                      </button>
                    );
                  })}
                </div>
              </FormField>

              {/* A2A-only flow — explicit info banner replaces the old
                  executor + verification pickers. Every task posted here
                  targets an agent and auto-verifies on submission. */}
              <div className="border border-line bg-surface-2 px-4 py-3 flex gap-2.5">
                <Icon name="shield" size={16} className="text-cream shrink-0 mt-0.5" />
                <p className="text-xs text-ink-3 leading-relaxed">
                  <span className="text-ink-2 font-medium">Auto-verified:</span> tasks posted here are
                  visible to autonomous agents at <span className="font-mono text-ink-2">/a2a</span>.
                  Submissions are checked against built-in criteria (minimum length, required fields)
                  and escrow releases automatically — no further input from you.
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 border-b border-line">
            <SectionRule num="02" title="Payment" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                label="Bounty (0G)"
                required
                hint="85% to worker, 15% protocol fee."
              >
                <FormInput
                  className="font-mono"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  required
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
                {form.amount && !isNaN(parseFloat(form.amount)) && (() => {
                  const amountinWei = parseUnits(form.amount, 18);
                  return (
                    <div className="mt-1.5">
                      <Tag tone="neutral" className="font-mono">
                        {formatUnits(amountinWei, 18)} 0G
                      </Tag>
                    </div>
                  );
                })()}
              </FormField>
              <FormField
                label="Deadline"
                required
                hint={(() => {
                  const ms = new Date(form.deadlineAt).getTime();
                  if (Number.isNaN(ms)) return 'Pick a date and time. Minimum 1 hour, maximum 90 days.';
                  const secs = Math.floor((ms - Date.now()) / 1000);
                  // Live human-readable hint — recomputed each render so the
                  // user sees the offset shrink in real time if they're slow.
                  return durationHint(secs);
                })()}
              >
                <FormInput
                  className="font-mono"
                  type="datetime-local"
                  min={MIN_DEADLINE_AT}
                  max={MAX_DEADLINE_AT}
                  required
                  value={form.deadlineAt}
                  onChange={e => setForm(f => ({ ...f, deadlineAt: e.target.value }))}
                />
              </FormField>
            </div>
          </div>

          <div className="p-6">
            {!address ? (
              <div className="flex items-center gap-2 text-sm text-ink-3">
                <Icon name="wallet" size={16} className="text-ink-3" />
                Connect a wallet to post a task.
              </div>
            ) : (
              <Button
                variant="primary"
                type="submit"
                label={submitLabel}
                disabled={busy || requiredCaps.length === 0}
                title={requiredCaps.length === 0 ? 'Select at least one required capability above' : undefined}
              />
            )}
            {status === 'error' && (
              <div className="mt-3 flex items-start gap-2 text-sm text-err">
                <Icon name="shield" size={16} className="shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

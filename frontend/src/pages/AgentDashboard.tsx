import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Breadcrumb,
  PageHeader,
  SectionRule,
  Panel,
  Button,
  FormField,
  FormInput,
  FormTextarea,
  Prompt,
} from '../components/bb';
import { TxPendingModal } from '../components/TxPendingModal';
import { aesEncrypt, generateAesKey, sha256, toBase64, toBytes } from '../lib/crypto';
import { uploadBlob } from '../services/storage';
import { buildCreateTask } from '../services/tasks';
import { useTxSend } from '../hooks/useTxSend';
import { useWallet } from '../context/WalletContext';
import { useAuth } from '../context/AuthContext';

const categories = [
  { value: 'physical_presence', label: 'physical_presence' },
  { value: 'knowledge_access', label: 'knowledge_access' },
  { value: 'human_authority', label: 'human_authority' },
  { value: 'simple_action', label: 'simple_action' },
  { value: 'digital_physical', label: 'digital_physical' },
];

const recentPosts = [
  { id: '#1847', title: 'translate 40pp legal contract', bounty: '$420', age: '4m' },
  { id: '#1846', title: 'label 500 bird call spectrograms', bounty: '$180', age: '11m' },
  { id: '#1845', title: 'summarize sealed court docs', bounty: '$240', age: '1h' },
];

interface PostResult {
  taskHash: string;
  rootHash: string;
  aesKeyHex: string;
  txHash: string;
}

export default function AgentDashboard() {
  const [activeTab, setActiveTab] = useState<'create_task' | 'accounting'>('create_task');
  const [instructions, setInstructions] = useState('');
  const [category, setCategory] = useState('simple_action');
  const [locationZone, setLocationZone] = useState('');
  const [tokenAddress, setTokenAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [duration, setDuration] = useState('86400');

  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [lastPost, setLastPost] = useState<PostResult | null>(null);

  const txSend = useTxSend();
  const { isCorrectChain } = useWallet();
  const { isAuthenticated } = useAuth();

  const sealedPreview = useMemo(() => {
    if (!instructions.trim()) return '// enter instructions to preview sealed payload';
    if (!lastPost) {
      return `{
  "status": "preview",
  "algo": "aes-256-gcm",
  "category": "${category}",
  "zone": "${locationZone || 'global'}",
  "bounty_wei": "${amount || '0'}",
  "duration_s": "${duration || '0'}"
}`;
    }
    return `{
  "status": "posted",
  "task_hash": "${lastPost.taskHash}",
  "storage_root": "${lastPost.rootHash}",
  "tx_hash": "${lastPost.txHash}",
  "algo": "aes-256-gcm",
  "category": "${category}",
  "zone": "${locationZone || 'global'}",
  "bounty_wei": "${amount}"
}`;
  }, [instructions, lastPost, category, locationZone, amount, duration]);

  const canPost =
    instructions.trim() &&
    amount &&
    tokenAddress &&
    isAuthenticated &&
    isCorrectChain &&
    !posting &&
    !txSend.isPending;

  const handleSealAndPost = async () => {
    setPostError(null);
    setPosting(true);
    try {
      // 1. Encrypt instructions with a fresh AES key
      const aesKey = await generateAesKey();
      const ciphertext = await aesEncrypt(toBytes(instructions), aesKey);

      // 2. Upload the ciphertext blob to storage and compute the content hash
      //    (taskHash on-chain is SHA-256 of the ciphertext per backend convention)
      const [uploaded, taskHashHex] = await Promise.all([
        uploadBlob(toBase64(ciphertext)),
        sha256(ciphertext),
      ]);

      // 3. Build unsigned createTask tx via backend, then sign+send
      const unsignedTx = await buildCreateTask({
        taskHash: `0x${taskHashHex}`,
        token: tokenAddress,
        amount,
        category,
        locationZone: locationZone || 'global',
        duration,
      });
      const receipt = await txSend.mutateAsync(unsignedTx);

      setLastPost({
        taskHash: `0x${taskHashHex}`,
        rootHash: uploaded.rootHash,
        aesKeyHex: Array.from(aesKey, (b) => b.toString(16).padStart(2, '0')).join(''),
        txHash: receipt.hash,
      });
    } catch (err) {
      setPostError((err as Error).message || 'failed to post task');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      <Breadcrumb items={['marketplace', 'agent']} />
      <PageHeader
        title="Agent dashboard"
        description="Create and manage encrypted tasks."
      />

      {/* Tabs */}
      <div className="flex gap-6 border-b border-line mb-8">
        {(['create_task', 'accounting'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2.5 text-xs font-mono font-semibold tracking-widest transition-colors border-b -mb-px ${
              activeTab === tab
                ? 'text-cream border-cream'
                : 'text-ink-3 border-transparent hover:text-ink-2'
            }`}
          >
            {activeTab === tab ? '▸ ' : ''}{tab}
          </button>
        ))}
      </div>

      {activeTab === 'accounting' ? (
        <Panel>
          <Prompt command="cat accounting.log" blink />
          <p className="text-ink-3 text-sm font-mono mt-4">no accounting entries yet. create a task to begin.</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-[1fr_340px] gap-0 border border-line">
          {/* Left — form */}
          <div className="p-6 space-y-6">
            <SectionRule num="01" title="create encrypted task" />

            <div className="space-y-5">
              <FormField label="instructions" required hint="encrypted with aes-256-gcm before upload">
                <FormTextarea
                  rows={5}
                  placeholder="describe what the worker needs to do..."
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </FormField>

              <FormField label="category" required>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2.5 bg-surface-2 border border-line text-ink text-sm font-mono focus:border-cream"
                >
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </FormField>

              <FormField label="location_zone" hint="e.g., US-NY, EU-DE, global">
                <FormInput
                  placeholder="global"
                  value={locationZone}
                  onChange={(e) => setLocationZone(e.target.value)}
                />
              </FormField>

              <FormField label="token_address" required hint="erc-20 token for escrow payment">
                <FormInput
                  placeholder="0x..."
                  value={tokenAddress}
                  onChange={(e) => setTokenAddress(e.target.value)}
                />
              </FormField>

              <FormField label="amount_wei" required>
                <FormInput
                  placeholder="1000000000000000000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </FormField>

              <FormField label="duration_seconds" hint="time allowed for completion (default: 24h)">
                <FormInput
                  placeholder="86400"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </FormField>
            </div>

            {/* Sealed payload preview */}
            <div>
              <div className="text-[11px] font-mono font-semibold uppercase tracking-widest text-ink-3 mb-2">
                sealed payload preview
              </div>
              <pre className="bg-surface-2 border border-line p-4 text-xs font-mono text-ink-3 leading-relaxed overflow-x-auto">
                {sealedPreview}
              </pre>
            </div>

            <div className="flex gap-3 pt-2 items-center flex-wrap">
              <Button
                variant="primary"
                label={posting || txSend.isPending ? 'sealing…' : 'seal_and_post'}
                disabled={!canPost}
                onClick={handleSealAndPost}
              />
              {!isAuthenticated && (
                <span className="text-[11px] font-mono text-ink-3">connect wallet to post</span>
              )}
              {isAuthenticated && !isCorrectChain && (
                <span className="text-[11px] font-mono text-err">switch to 0G Galileo</span>
              )}
              {postError && (
                <span className="text-[11px] font-mono text-err break-all">{postError}</span>
              )}
              {lastPost && (
                <Link
                  to={`/tasks/${lastPost.rootHash}`}
                  className="text-[11px] font-mono text-ok underline underline-offset-2"
                >
                  ✓ posted · view task
                </Link>
              )}
            </div>

            <TxPendingModal open={txSend.isPending} />
          </div>

          {/* Right rail */}
          <div className="border-l border-line p-6 space-y-6">
            <SectionRule num="I" title="what happens on post" />

            <div className="space-y-4">
              {[
                { n: '01', cmd: 'aes_encrypt(instructions)', desc: 'instructions encrypted in-browser with aes-256-gcm' },
                { n: '02', cmd: 'upload_blob(ciphertext)', desc: 'encrypted blob pushed to 0g decentralized storage' },
                { n: '03', cmd: 'ecies_wrap(aes_key, agent_pk)', desc: 'aes key wrapped with ecies to agent public key' },
                { n: '04', cmd: 'escrow.create_task(hash, token, amount)', desc: 'on-chain tx locks funds in blindescrow contract' },
              ].map((step) => (
                <div key={step.n} className="flex gap-3">
                  <span className="text-cream font-mono text-xs font-bold mt-0.5">[{step.n}]</span>
                  <div>
                    <div className="text-xs font-mono text-ink">$ {step.cmd}</div>
                    <div className="text-[11px] font-mono text-ink-3 mt-0.5">{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <SectionRule num="II" title="recent posts · 24h" />

            <div className="space-y-0">
              {recentPosts.map((post) => (
                <div key={post.id} className="flex items-center justify-between py-3 border-b border-line last:border-b-0">
                  <div>
                    <span className="text-xs font-mono text-ink-3 mr-2">{post.id}</span>
                    <span className="text-xs font-mono text-ink">{post.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-ink">{post.bounty}</span>
                    <span className="text-[10px] font-mono text-ink-3">{post.age}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

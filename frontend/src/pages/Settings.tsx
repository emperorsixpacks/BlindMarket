import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  Breadcrumb,
  PageHeader,
  SectionRule,
  Button,
  Tag,
  FormField,
} from '../components/bb';
import { useWallet } from '../context/WalletContext';
import { useReputation } from '../hooks/useReputation';
import { isMainnet, OG_CHAIN_ID, OG_RPC_URL } from '../config/constants';

const NOTIF_KEYS = {
  payout: 'bb.notify.payout',
  assignment: 'bb.notify.assignment',
  dispute: 'bb.notify.dispute',
} as const;

function loadBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const v = window.localStorage.getItem(key);
  return v == null ? fallback : v === '1';
}

function saveBool(key: string, v: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, v ? '1' : '0');
}

export default function Settings() {
  const { chainId, isCorrectChain, switchChain } = useWallet();
  const { address, isConnected } = useAccount();
  const { data: reputation } = useReputation(address ?? null);

  const [notifyPayouts, setNotifyPayouts] = useState(() => loadBool(NOTIF_KEYS.payout, true));
  const [notifyAssignments, setNotifyAssignments] = useState(() => loadBool(NOTIF_KEYS.assignment, true));
  const [notifyDisputes, setNotifyDisputes] = useState(() => loadBool(NOTIF_KEYS.dispute, false));

  useEffect(() => saveBool(NOTIF_KEYS.payout, notifyPayouts), [notifyPayouts]);
  useEffect(() => saveBool(NOTIF_KEYS.assignment, notifyAssignments), [notifyAssignments]);
  useEffect(() => saveBool(NOTIF_KEYS.dispute, notifyDisputes), [notifyDisputes]);

  const walletDisplay = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : 'Not connected';

  const reputationDisplay = reputation
    ? `${reputation.decayedScore.toFixed(1)} · ${reputation.tasksCompleted} tasks · ${reputation.disputes} disputes`
    : 'No reputation yet';

  const notifications: { label: string; description: string; value: boolean; set: (v: boolean) => void }[] = [
    { label: 'Payout received', description: 'When escrow settles a task in your favour.', value: notifyPayouts, set: setNotifyPayouts },
    { label: 'Task assigned', description: 'When one of your agents is matched to a task.', value: notifyAssignments, set: setNotifyAssignments },
    { label: 'Dispute opened', description: 'When a task you are involved in enters dispute.', value: notifyDisputes, set: setNotifyDisputes },
  ];

  return (
    <div>
      <Breadcrumb items={['account', 'settings']} />
      <PageHeader title="Settings" description="Manage your identity, network, and notification preferences." />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-0 border border-line">
        {/* Left column */}
        <div className="p-6 space-y-10">
          {/* Identity */}
          <div className="space-y-5">
            <SectionRule num="01" title="Identity" />

            <FormField label="Wallet address">
              <div className="px-3 py-2.5 bg-surface-2 border border-line text-sm flex items-center gap-2 flex-wrap">
                <span className="font-mono text-ink-2">{walletDisplay}</span>
                {isConnected ? <Tag tone="ok">Connected</Tag> : <Tag tone="warn">Disconnected</Tag>}
              </div>
            </FormField>

            <FormField label="Reputation" hint="Decayed on-chain + off-chain score">
              <div className="px-3 py-2.5 bg-surface-2 border border-line text-sm font-mono text-ink-2">
                {address ? reputationDisplay : 'Connect wallet to view reputation'}
              </div>
            </FormField>

            <FormField label="Social verification" hint="Coming soon — link accounts for optional identity verification.">
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" label="GitHub (soon)" size="sm" disabled />
                <Button variant="outline" label="Twitter (soon)" size="sm" disabled />
                <Button variant="outline" label="Google (soon)" size="sm" disabled />
              </div>
            </FormField>
          </div>

          {/* Network */}
          <div className="space-y-5">
            <SectionRule num="02" title="Network" />

            <FormField
              label="Supported chain"
              hint={`BlindMarket runs on 0G ${isMainnet ? 'Mainnet' : 'Galileo'} (chain ID ${isMainnet ? 16661 : 16602}).`}
            >
              <div className="px-3 py-2.5 bg-surface-2 border border-line text-sm flex items-center gap-2 flex-wrap">
                <Tag tone={isCorrectChain ? 'ok' : 'warn'}>
                  0G {isMainnet ? 'Mainnet' : 'Galileo'} · <span className="font-mono">{OG_CHAIN_ID}</span>
                </Tag>
                {chainId != null && chainId !== OG_CHAIN_ID && (
                  <>
                    <span className="text-ink-3">
                      Currently on chain <span className="font-mono">{chainId}</span>
                    </span>
                    <button
                      onClick={switchChain}
                      className="ml-auto text-xs underline underline-offset-2 text-cream hover:text-ink transition-colors"
                    >
                      Switch network
                    </button>
                  </>
                )}
                {isCorrectChain && <span className="ml-auto text-xs text-ok">Active</span>}
              </div>
            </FormField>
          </div>

          {/* Notifications */}
          <div className="space-y-5">
            <SectionRule num="03" title="Notifications" side="Saved to this browser" />

            <div className="border border-line">
              {notifications.map((toggle, i) => (
                <div
                  key={toggle.label}
                  className={`flex items-center justify-between gap-4 px-4 py-3.5 ${i > 0 ? 'border-t border-line' : ''}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm text-ink">{toggle.label}</div>
                    <div className="text-xs text-ink-3 mt-0.5 leading-relaxed">{toggle.description}</div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={toggle.value}
                    aria-label={toggle.label}
                    onClick={() => toggle.set(!toggle.value)}
                    className={`shrink-0 w-10 h-5 border transition-colors flex items-center ${
                      toggle.value ? 'bg-cream/20 border-cream/40' : 'bg-surface-2 border-line'
                    }`}
                  >
                    <div
                      className={`w-3 h-3 transition-all ${toggle.value ? 'bg-cream ml-5' : 'bg-ink-3 ml-1'}`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="border-t lg:border-t-0 lg:border-l border-line p-6 space-y-8">
          {/* Session state */}
          <div className="space-y-4">
            <SectionRule num="04" title="Session" />

            <div className="space-y-2">
              {[
                {
                  label: 'Wallet',
                  value: isConnected ? 'Connected' : 'Disconnected',
                  mono: false,
                  color: isConnected ? 'text-ok' : 'text-ink-3',
                },
                {
                  label: 'Chain ID',
                  value: chainId != null ? String(chainId) : '—',
                  mono: true,
                  color: isCorrectChain ? 'text-ok' : 'text-warn',
                },
                {
                  label: 'RPC',
                  value: OG_RPC_URL.replace(/^https?:\/\//, ''),
                  mono: true,
                  color: 'text-ink-3',
                },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-xs text-ink-3">{item.label}</span>
                  <span className={`text-xs ${item.mono ? 'font-mono' : ''} ${item.color} truncate`}>
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Privacy explainer */}
          <div className="space-y-3">
            <SectionRule num="05" title="Privacy" />
            <div className="bg-surface-2 border border-line p-4 space-y-2.5">
              <p className="text-xs text-ink-3 leading-relaxed">
                ECIES keys are generated in-browser and never transmitted.
              </p>
              <p className="text-xs text-ink-3 leading-relaxed">
                AES-256-GCM keys are ephemeral — one per task.
              </p>
              <p className="text-xs text-ink-3 leading-relaxed">
                Private keys exist only in browser memory. Closing the tab destroys them.
              </p>
              <p className="text-xs text-ink-3 leading-relaxed">
                The platform never sees plaintext instructions or evidence.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

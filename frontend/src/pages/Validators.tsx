import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { Breadcrumb, PageHeader, SectionRule, StatCard, Button, FormField, FormInput } from '../components/bb';
import { authedPost, get } from '../lib/api';
import { useTxSend } from '../hooks/useTxSend';
import { TxPendingModal } from '../components/TxPendingModal';

function useValidatorInfo(address: string | undefined) {
  return useQuery({
    queryKey: ['validator', address],
    queryFn: () => get<{ stake: string; active: boolean; totalVotes: number; correctVotes: number }>(`/api/v1/validators/${address}`),
    enabled: !!address,
  });
}

function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => get<{ openTasks: number; activeAgents: number; activeValidators: number }>('/api/v1/stats'),
    refetchInterval: 15_000,
  });
}

export default function Validators() {
  const { address } = useAccount();
  const { data: info, refetch } = useValidatorInfo(address);
  const { data: stats } = useStats();
  const txSend = useTxSend();

  const [stakeAmount, setStakeAmount] = useState('100');
  const [disputeId, setDisputeId] = useState('');
  const [vote, setVote] = useState<1 | 2>(1);
  const [finalizeId, setFinalizeId] = useState('');

  const handleStake = async () => {
    const { unsignedTx } = await authedPost<{ unsignedTx: object }>('/api/v1/validators/register', {
      amount: (BigInt(stakeAmount) * 10n ** 18n).toString(),
    });
    await txSend.mutateAsync(unsignedTx as any);
    refetch();
  };

  const handleUnstake = async () => {
    const { unsignedTx } = await authedPost<{ unsignedTx: object }>('/api/v1/validators/unstake', {});
    await txSend.mutateAsync(unsignedTx as any);
    refetch();
  };

  const handleVote = async () => {
    const { unsignedTx } = await authedPost<{ unsignedTx: object }>('/api/v1/validators/vote', { disputeId, vote });
    await txSend.mutateAsync(unsignedTx as any);
  };

  const handleFinalize = async () => {
    const { unsignedTx } = await authedPost<{ unsignedTx: object }>('/api/v1/validators/finalize', { disputeId: finalizeId });
    await txSend.mutateAsync(unsignedTx as any);
  };

  return (
    <div>
      <Breadcrumb items={['marketplace', 'validators']} />
      <PageHeader title="Validators" description="Stake to join the dispute pool · vote · earn rewards." />
      <TxPendingModal open={txSend.isPending} />

      {/* Live counts */}
      <div className="grid grid-cols-4 gap-0 border border-line mb-8">
        <StatCard label="active validators" value={String(stats?.activeValidators ?? '—')} sub="staked + active" subColor="ok" />
        <div className="border-l border-line">
          <StatCard label="active agents" value={String(stats?.activeAgents ?? '—')} sub="running now" subColor="ok" />
        </div>
        <div className="border-l border-line">
          <StatCard label="open tasks" value={String(stats?.openTasks ?? '—')} sub="live from chain" />
        </div>
        <div className="border-l border-line">
          <StatCard
            label="my stake"
            value={info ? `${(BigInt(info.stake) / 10n ** 18n).toString()}` : '—'}
            sub={info?.active ? 'active' : address ? 'not staked' : 'connect wallet'}
            subColor={info?.active ? 'ok' : undefined}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-0 border border-line mb-8">
        {/* Stake / unstake */}
        <div className="p-6 space-y-5">
          <SectionRule num="01" title="stake to validate" />
          <p className="text-xs font-mono text-ink-3">Minimum 100 tokens. Stake is slashed if you vote with the minority.</p>

          {!info?.active ? (
            <>
              <FormField label="stake_amount" hint="tokens (min 100)">
                <FormInput value={stakeAmount} onChange={e => setStakeAmount(e.target.value)} placeholder="100" />
              </FormField>
              <Button variant="primary" label={txSend.isPending ? 'staking…' : 'stake_and_register'} disabled={!address || txSend.isPending} onClick={handleStake} />
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-4 text-xs font-mono">
                <span className="text-ink-3">total_votes <span className="text-ink">{info.totalVotes}</span></span>
                <span className="text-ink-3">correct_votes <span className="text-ok">{info.correctVotes}</span></span>
                <span className="text-ink-3">accuracy <span className="text-ink">{info.totalVotes > 0 ? ((info.correctVotes / info.totalVotes) * 100).toFixed(0) : '—'}%</span></span>
              </div>
              <Button variant="ghost" label="unstake" disabled={txSend.isPending} onClick={handleUnstake} />
            </div>
          )}
        </div>

        {/* Vote on dispute */}
        <div className="border-l border-line p-6 space-y-5">
          <SectionRule num="02" title="vote on dispute" />

          <FormField label="dispute_id">
            <FormInput value={disputeId} onChange={e => setDisputeId(e.target.value)} placeholder="e.g. 1" />
          </FormField>

          <div className="flex gap-2">
            <button
              onClick={() => setVote(1)}
              className={`flex-1 py-2 text-xs font-mono border transition-colors ${vote === 1 ? 'border-ok text-ok bg-ok/10' : 'border-line text-ink-3 hover:border-ink-2'}`}
            >
              worker wins
            </button>
            <button
              onClick={() => setVote(2)}
              className={`flex-1 py-2 text-xs font-mono border transition-colors ${vote === 2 ? 'border-err text-err bg-err/10' : 'border-line text-ink-3 hover:border-ink-2'}`}
            >
              agent wins (refund)
            </button>
          </div>

          <Button variant="primary" label={txSend.isPending ? 'voting…' : 'cast_vote'} disabled={!address || !disputeId || !info?.active || txSend.isPending} onClick={handleVote} />

          <div className="pt-2 border-t border-line space-y-3">
            <SectionRule num="03" title="finalize dispute" />
            <FormField label="dispute_id" hint="after 48h vote window">
              <FormInput value={finalizeId} onChange={e => setFinalizeId(e.target.value)} placeholder="e.g. 1" />
            </FormField>
            <Button variant="outline" label={txSend.isPending ? 'finalizing…' : 'finalize'} disabled={!address || !finalizeId || txSend.isPending} onClick={handleFinalize} />
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="border border-line p-6">
        <SectionRule num="I" title="how validator rewards work" />
        <div className="mt-4 grid grid-cols-3 gap-6 text-xs font-mono text-ink-3">
          <div><span className="text-cream block mb-1">01 · stake</span>Lock ≥100 tokens. This is your skin in the game.</div>
          <div><span className="text-cream block mb-1">02 · vote</span>When a dispute opens, vote within 48h. Majority wins.</div>
          <div><span className="text-cream block mb-1">03 · earn</span>Correct voters share the slash pool from wrong voters.</div>
        </div>
      </div>
    </div>
  );
}

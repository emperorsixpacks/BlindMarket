import { Tag } from '../bb';
import { truncateAddress } from '../../lib/utils';
import type { AgentBadge } from '../../services/marketplace';
import type { AgentDetails, SkillStat } from './types';

/**
 * Right rail: who this agent is and what it has actually settled. Raw key
 * material (full wallet, ECIES pubkey) sits behind a disclosure — verifiable,
 * but not competing with the storefront for attention.
 */
export function IdentityPanel({
  agent,
  badges,
  skillStats,
}: {
  agent: AgentDetails;
  badges: AgentBadge[];
  skillStats: SkillStat[];
}) {
  return (
    <aside className="border border-line p-5 h-fit">
      <div className="flex items-center gap-3 mb-5">
        <span className="text-sm font-semibold text-ink">Identity</span>
        <span className="flex-1 h-px bg-line" />
      </div>
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
            <div className="font-mono text-ink-2">{truncateAddress(agent.walletAddress)}</div>
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
            <div className="text-[13px] font-medium text-ink-2 mb-1">Proven skills</div>
            <div className="flex flex-wrap gap-1.5">
              {badges.map((b) => (
                <Tag key={b.capability ?? String(b.id)} tone="ok">
                  {(b.capability ?? '').replace(/_/g, ' ')}
                  <span className="ml-1 opacity-70">{b.badge_type === 'earned' ? 'earned' : b.badge_type === 'certified' ? 'certified' : 'verified'}</span>
                </Tag>
              ))}
            </div>
          </div>
        )}
        {skillStats.length > 0 && (
          <div>
            <div className="text-[13px] font-medium text-ink-2 mb-1">Track record</div>
            <div className="space-y-1">
              {skillStats.map((s) => (
                <div key={s.capability} className="flex items-center justify-between text-xs">
                  <span className="text-ink-2">{(s.capability ?? '').replace(/_/g, ' ')}</span>
                  <span className="font-mono text-ink-3">
                    <span className="text-ok">{s.tasks_completed}✓</span>
                    {s.tasks_failed > 0 && <span className="text-err"> {s.tasks_failed}✗</span>}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-ink-3">Settled, verified tasks per skill — on-chain proof, not self-declared.</div>
          </div>
        )}
        {(agent.walletAddress || agent.publicKey) && (
          <details className="pt-1 border-t border-line">
            <summary className="cursor-pointer pt-3 font-mono text-[11px] uppercase tracking-widest text-ink-3 hover:text-cream transition-colors">
              full address &amp; key
            </summary>
            <div className="mt-3 space-y-3">
              {agent.walletAddress && (
                <div>
                  <div className="text-[13px] font-medium text-ink-2 mb-1">Agent wallet</div>
                  <div className="font-mono text-ink-2 break-all text-xs">{agent.walletAddress}</div>
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
          </details>
        )}
      </div>
    </aside>
  );
}

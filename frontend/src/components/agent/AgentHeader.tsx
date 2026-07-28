import { useState } from 'react';
import { AgentAvatar, Button, StatusTag } from '../bb';
import type { AgentAction, AgentDetails } from './types';

/**
 * Storefront header — the agent presented as a product: identicon, name, what
 * it does, and the price it starts at. Owner run controls sit on the right.
 */
export function AgentHeader({
  agent,
  displayStatus,
  badgeCount,
  fromPrice,
  isOwner,
  actionPending,
  onAction,
}: {
  agent: AgentDetails;
  displayStatus: string;
  badgeCount: number;
  fromPrice: string | null;
  isOwner: boolean;
  actionPending: boolean;
  onAction: (act: AgentAction) => void;
}) {
  const [descExpanded, setDescExpanded] = useState(false);
  const description = (agent.instructions ?? '').trim();

  return (
    <div className="flex flex-col sm:flex-row items-start gap-5 sm:gap-6 mb-8">
      <AgentAvatar seed={agent.walletAddress || agent.id} size={96} className="mt-1" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl sm:text-[38px] font-bold text-ink leading-[1.05] tracking-tight break-words">
            {agent.name}
          </h1>
          <StatusTag status={displayStatus} />
        </div>
        <div className="mt-2 flex items-center gap-3 flex-wrap font-mono text-xs text-ink-3">
          <span>{agent.provider} · {agent.model}</span>
          {badgeCount > 0 && (
            <span className="text-ok">✓ {badgeCount} badge{badgeCount > 1 ? 's' : ''}</span>
          )}
        </div>
        {description && (
          <div className="mt-3 max-w-3xl">
            <p className={`text-sm text-ink-2 leading-relaxed whitespace-pre-line ${descExpanded ? '' : 'line-clamp-3'}`}>
              {description}
            </p>
            {description.length > 220 && (
              <button
                onClick={() => setDescExpanded((v) => !v)}
                className="mt-1 font-mono text-[11px] uppercase tracking-widest text-ink-3 hover:text-cream transition-colors"
              >
                {descExpanded ? 'show less' : 'view all'}
              </button>
            )}
          </div>
        )}
        {/* Price above the fold — the marketplace card promises a from-price,
            the detail page has to honour it without a tab dive. */}
        {!isOwner && fromPrice && (
          <a
            href="#services"
            className="mt-4 inline-flex items-baseline gap-2 font-mono text-sm text-cream hover:underline"
          >
            {fromPrice}
            <span className="text-[11px] uppercase tracking-widest text-ink-3">view services ↓</span>
          </a>
        )}
      </div>
      {isOwner && (
        <div className="flex sm:flex-col items-end gap-2 shrink-0">
          <div className="flex flex-wrap justify-end gap-2">
            {agent.status !== 'running' && (
              <Button variant="outline" size="sm" disabled={actionPending}
                onClick={() => onAction('start')} label="Start" />
            )}
            {agent.status === 'running' && (
              <Button variant="outline" size="sm" disabled={actionPending}
                onClick={() => onAction('pause')} label="Pause" />
            )}
            <Button variant="ghost" size="sm" disabled={actionPending}
              onClick={() => onAction('stop')} label="Stop" />
            {agent.status !== 'stopped' && (
              <Button variant="ghost" size="sm" disabled={actionPending}
                onClick={() => onAction('restart')} label="Restart" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

// Pure A2A — three facets of the same agent-to-agent flow. Posting (an
// agent kicks off work), Executing (another agent picks it up), Settling
// (escrow releases through the verifier-attested bridge). Replaces the
// earlier three-flow A2A/H2A/A2H mix; we're focused on Track 3 (Agentic
// Economy), which means agents transacting with agents end to end.
const FLOWS = [
  {
    from: 'Agent',
    to: 'Agent',
    title: 'Specialists hire specialists.',
    body: 'A research agent posts a sealed brief. Another agent accepts on /a2a, executes the work autonomously, and submits a result hashed on chain.',
    badge: 'post',
    status: 'live',
  },
  {
    from: 'Agent',
    to: 'Agent',
    title: 'Encrypted briefs, autonomous workers.',
    body: 'Instructions are AES-256 encrypted in the poster\'s browser; the AES key is ECIES-wrapped to the assigned agent\'s pubkey. Only the worker can decrypt — the platform cannot.',
    badge: 'exec',
    status: 'live',
  },
  {
    from: 'Agent',
    to: 'Agent',
    title: 'Auto-verified settlement.',
    body: 'Submissions check against the criteria you set at task creation. If they pass, the marketplace verifier signs completeVerification — 85% to the worker, 15% to treasury. No human in the loop.',
    badge: 'settle',
    status: 'live',
  },
];

function ActorChip({ kind, children }: { kind: 'agent' | 'human'; children: ReactNode }) {
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 border border-line rounded-full text-[11px] font-mono ${
      kind === 'agent' ? 'text-cream' : 'text-ink'
    }`}>
      {kind === 'agent' ? (
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="4" y="6" width="16" height="13" rx="2" />
          <circle cx="9" cy="12" r="1.2" fill="currentColor" />
          <circle cx="15" cy="12" r="1.2" fill="currentColor" />
          <path d="M12 3v3" strokeLinecap="round" />
          <circle cx="12" cy="3" r="1" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c1-4 4-6 7-6s6 2 7 6" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </div>
  );
}

export function EconomyFlows() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {FLOWS.map((flow, i) => {
        const fromKind = flow.from.toLowerCase() as 'agent' | 'human';
        const toKind = flow.to.toLowerCase() as 'agent' | 'human';
        const isRoadmap = flow.status === 'roadmap';

        return (
          <motion.div
            key={`${flow.from}-${flow.to}-${i}`}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, delay: reduceMotion ? 0 : i * 0.12, ease: [0.16, 1, 0.3, 1] }}
            whileHover={reduceMotion ? {} : { y: -4 }}
            className={`group relative rounded-2xl border bg-surface p-6 overflow-hidden transition-shadow ${
              isRoadmap
                ? 'border-line opacity-70 border-dashed'
                : 'border-line hover:shadow-[0_0_0_1px_var(--bb-cream)]'
            }`}
          >
            {flow.status === 'live' && (
              <span className="absolute top-3 left-3 text-[9px] font-mono uppercase tracking-widest text-ok">
                live
              </span>
            )}
            {flow.status === 'roadmap' && (
              <span className="absolute top-3 left-3 text-[9px] font-mono uppercase tracking-widest text-ink-3 border border-line px-1.5 py-0.5">
                roadmap
              </span>
            )}
            {/* Animated transaction line */}
            <div className="relative mb-5">
              <div className="flex items-center justify-between gap-3">
                <ActorChip kind={fromKind}>{flow.from}</ActorChip>
                <ActorChip kind={toKind}>{flow.to}</ActorChip>
              </div>

              {/* Connector + traveling packet */}
              <div className="relative mt-3 h-px bg-line">
                {!reduceMotion && (
                  <motion.span
                    aria-hidden
                    className="absolute -top-[3px] w-1.5 h-1.5 rounded-full bg-cream"
                    initial={{ left: '0%' }}
                    whileInView={{ left: ['0%', '100%'] }}
                    viewport={{ once: false, margin: '-100px' }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
                    style={{ boxShadow: '0 0 8px var(--bb-cream)' }}
                  />
                )}
              </div>

              {/* Floating badge */}
              <motion.div
                animate={reduceMotion ? {} : { y: [0, -3, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: i * 0.5 }}
                className="absolute right-0 -top-7 text-[10px] font-mono text-cream/80 px-2 py-0.5 border border-cream/30 rounded"
              >
                {flow.badge}
              </motion.div>
            </div>

            <h3 className="text-base font-semibold text-ink mb-2 leading-snug">{flow.title}</h3>
            <p className="text-sm text-ink-2 leading-relaxed">{flow.body}</p>

            {/* Corner ornament */}
            <div className="absolute top-3 right-3 text-[9px] font-mono text-ink-3 opacity-40 group-hover:opacity-80 transition-opacity">
              0{i + 1}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

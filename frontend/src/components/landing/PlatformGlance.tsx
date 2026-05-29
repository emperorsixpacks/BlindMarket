import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { isMainnet, OG_CHAIN_ID } from '../../config/constants';

// ── Card primitives ────────────────────────────────────────────
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`h-full rounded-2xl border border-line bg-surface p-6 flex flex-col overflow-hidden relative ${className}`}
    >
      {children}
    </div>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-widest text-ink-3 mb-3">{children}</div>
  );
}

// ── Individual cards ───────────────────────────────────────────
function EncryptionCard() {
  return (
    <Card>
      <Kicker>browser → 0g storage</Kicker>
      <div className="flex-1 flex items-center justify-center">
        <div className="font-mono text-[11px] leading-relaxed text-ink-2">
          <div>plaintext: <span className="text-ink">"photograph 42 oak…"</span></div>
          <div className="my-1 text-cream">↓ aes-256-gcm</div>
          <div className="text-ink-3 break-all">e7f2a8c1d9b3…<span className="opacity-50">9f0e</span></div>
        </div>
      </div>
      <div className="text-sm font-semibold text-ink mt-3">Encrypted before it leaves you.</div>
    </Card>
  );
}

function TEECard() {
  return (
    <Card>
      <Kicker>verification</Kicker>
      <div className="flex-1 flex items-center justify-center">
        <svg viewBox="0 0 120 80" className="w-full max-w-[200px]">
          <rect x="20" y="20" width="80" height="40" rx="3" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-line" />
          <rect x="30" y="30" width="60" height="20" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-cream" />
          {[24, 36, 48, 60, 72, 84, 96].map((x) => (
            <line key={`t-${x}`} x1={x} y1="14" x2={x} y2="20" stroke="currentColor" strokeWidth="1" className="text-line" />
          ))}
          {[24, 36, 48, 60, 72, 84, 96].map((x) => (
            <line key={`b-${x}`} x1={x} y1="60" x2={x} y2="66" stroke="currentColor" strokeWidth="1" className="text-line" />
          ))}
          <path d="M48 40 L56 47 L72 33" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="text-ok" />
        </svg>
      </div>
      <div className="text-sm font-semibold text-ink mt-3">AI verifies inside silicon.</div>
      <div className="text-xs text-ink-3 mt-1">Intel TDX · NVIDIA H100 TEE</div>
    </Card>
  );
}

function PaymentCard() {
  return (
    <Card>
      <Kicker>settlement</Kicker>
      <div className="flex-1 flex items-end">
        <div className="w-full">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-ink-3">Worker</div>
            <div className="text-base font-semibold text-ink">85%</div>
          </div>
          <div className="h-1 bg-bg rounded-full overflow-hidden mb-3">
            <motion.div
              className="h-full bg-cream"
              initial={{ width: 0 }}
              whileInView={{ width: '85%' }}
              viewport={{ once: true }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-ink-3">Platform</div>
            <div className="text-base font-semibold text-ink">15%</div>
          </div>
          <div className="h-1 bg-bg rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-ok"
              initial={{ width: 0 }}
              whileInView={{ width: '15%' }}
              viewport={{ once: true }}
              transition={{ duration: 1, delay: 0.2, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>
      <div className="text-sm font-semibold text-ink mt-4">Escrow releases automatically.</div>
    </Card>
  );
}

function AnonymousCard() {
  return (
    <Card>
      <Kicker>workers</Kicker>
      <div className="flex-1 flex flex-col gap-2 justify-center">
        {[
          { id: '0x9f…3e21', rep: 4.9, jobs: 142 },
          { id: '0xc4…ab07', rep: 4.7, jobs: 89 },
          { id: '0x3a…7e1f', rep: 4.8, jobs: 218 },
        ].map((w) => (
          <div key={w.id} className="flex items-center justify-between text-xs font-mono">
            <span className="text-ink-2">{w.id}</span>
            <span className="flex items-center gap-3 text-ink-3">
              <span className="text-cream">★ {w.rep}</span>
              <span>{w.jobs} jobs</span>
            </span>
          </div>
        ))}
      </div>
      <div className="text-sm font-semibold text-ink mt-3">No name. Just a track record.</div>
    </Card>
  );
}

function LiveCard() {
  return (
    <Card>
      <Kicker>status</Kicker>
      <div className="flex-1 flex flex-col justify-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <motion.span
            className="w-2 h-2 rounded-full bg-ok"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
          <span className="text-ink">Live on {isMainnet ? '0G Mainnet' : '0G testnet'}</span>
        </div>
        <div className="text-xs text-ink-3">0G {isMainnet ? 'Mainnet' : 'Galileo'} · chain id {OG_CHAIN_ID}</div>
        <div className="mt-2 text-xs font-mono text-ink-3">
          <div>tee_online <span className="text-ok">●</span></div>
          <div>storage_indexer <span className="text-ok">●</span></div>
          <div>escrow_contract <span className="text-ok">●</span></div>
        </div>
      </div>
      <div className="text-sm font-semibold text-ink mt-3">Running on 0G Mainnet.</div>
    </Card>
  );
}

function FlowsCard() {
  return (
    <Card>
      <Kicker>three economies</Kicker>
      <div className="flex-1 flex flex-col gap-3 justify-center">
        {[
          { from: 'Agent', to: 'Human', label: 'eyes on the ground' },
          { from: 'Human', to: 'Agent', label: 'data you can\'t upload' },
          { from: 'Agent', to: 'Agent', label: 'specialists hire specialists' },
        ].map((row) => (
          <div key={row.label} className="flex items-center gap-3 text-xs">
            <div className="font-mono text-ink-2 w-14">{row.from}</div>
            <span className="text-cream">→</span>
            <div className="font-mono text-ink w-14">{row.to}</div>
            <div className="text-ink-3 flex-1">{row.label}</div>
          </div>
        ))}
      </div>
      <div className="text-sm font-semibold text-ink mt-3">Agents hire humans. Humans hire agents.</div>
    </Card>
  );
}

function StackCard() {
  return (
    <Card>
      <Kicker>built on 0g</Kicker>
      <div className="flex-1 flex flex-col gap-2 justify-center text-xs font-mono">
        {[
          { k: '0G Chain', v: 'EVM · escrow + reputation' },
          { k: '0G Storage', v: 'encrypted task blobs' },
          { k: '0G Compute', v: 'sealed inference / TEE' },
          { k: '0G DA', v: 'availability proofs' },
        ].map((row) => (
          <div key={row.k} className="flex items-center justify-between border-l-2 border-cream pl-3 py-1">
            <span className="text-ink">{row.k}</span>
            <span className="text-ink-3">{row.v}</span>
          </div>
        ))}
      </div>
      <div className="text-sm font-semibold text-ink mt-3">All four products. End to end.</div>
    </Card>
  );
}

function PrivacyMathCard() {
  return (
    <Card>
      <Kicker>not a promise</Kicker>
      <div className="flex-1 flex flex-col gap-2 justify-center font-mono text-xs">
        <div className="text-err">✕ "we won't read your tasks"</div>
        <div className="text-err">✕ "we keep logs encrypted"</div>
        <div className="text-err">✕ "we promise we're trustworthy"</div>
        <div className="h-px bg-line my-2" />
        <div className="text-ok">● math, not policy</div>
        <div className="text-ok">● keys, not permissions</div>
        <div className="text-ok">● silicon, not server logs</div>
      </div>
      <div className="text-sm font-semibold text-ink mt-3">Privacy by architecture.</div>
    </Card>
  );
}

// ── Auto-rotating column ───────────────────────────────────────
function CardColumn({
  cards,
  interval,
  delay = 0,
}: {
  cards: ReactNode[];
  interval: number;
  delay?: number;
}) {
  const [index, setIndex] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const start = setTimeout(() => {
      const id = setInterval(() => setIndex((p) => (p + 1) % cards.length), interval);
      return () => clearInterval(id);
    }, delay);
    return () => clearTimeout(start);
  }, [cards.length, interval, delay, reduceMotion]);

  return (
    <div className="relative h-[340px]">
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduceMotion ? 0 : -12 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0"
        >
          {cards[index]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────
export function PlatformGlance() {
  const col1 = [<EncryptionCard key="enc" />, <AnonymousCard key="anon" />, <PrivacyMathCard key="math" />];
  const col2 = [<TEECard key="tee" />, <FlowsCard key="flows" />, <StackCard key="stack" />];
  const col3 = [<PaymentCard key="pay" />, <LiveCard key="live" />, <PrivacyMathCard key="math2" />];

  return (
    <div className="grid md:grid-cols-3 gap-5">
      <CardColumn cards={col1} interval={4500} delay={0} />
      <CardColumn cards={col2} interval={4500} delay={1500} />
      <CardColumn cards={col3} interval={4500} delay={3000} />
    </div>
  );
}

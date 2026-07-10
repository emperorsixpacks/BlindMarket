import { useChain } from '../../context/ChainContext';
import { LogoMark } from './LogoMark';

const chains = [
  {
    id: 'og' as const,
    name: '0G Chain',
    description: 'EVM-compatible — use with MetaMask, Privy, or any EVM wallet. Tasks settle in 0G tokens.',
    icon: (
      <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none">
        <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2" className="text-ink-2" />
        <path d="M12 20h16M20 12v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-cream" />
      </svg>
    ),
  },
];

export function ChainSelectorModal() {
  const { showSelector, setActiveChain, dismissSelector } = useChain();

  if (!showSelector) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4">
        <div className="bg-surface border border-line p-6">
          <div className="flex items-center justify-center gap-2.5 mb-6">
            <LogoMark size={28} blade="var(--bb-ink)" slit="var(--bb-surface)" />
            <span className="text-lg font-semibold text-ink tracking-tight">BlindMarket</span>
          </div>

          <h2 className="text-center text-sm font-medium text-ink-2 mb-1">
            Select your chain
          </h2>
          <p className="text-center text-[11px] text-ink-3 mb-6">
            Choose which network your tasks and agents will use. You can switch anytime.
          </p>

          <div className="space-y-3">
            {chains.map((chain) => (
              <button
                key={chain.id}
                onClick={() => { setActiveChain(chain.id); dismissSelector(); }}
                className="w-full flex items-start gap-4 p-4 border border-line text-left hover:border-cream hover:bg-surface-2 transition-colors group"
              >
                <span className="shrink-0 mt-0.5 text-ink-3 group-hover:text-cream transition-colors">
                  {chain.icon}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink group-hover:text-cream transition-colors">
                    {chain.name}
                  </div>
                  <div className="text-[11px] text-ink-3 mt-1 leading-relaxed">
                    {chain.description}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <p className="text-center text-[10px] text-ink-4 mt-6">
            You can switch chains anytime from the dashboard header.
          </p>
        </div>
      </div>
    </div>
  );
}
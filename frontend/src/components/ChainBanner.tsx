import { useWallet } from '../context/WalletContext';
import { useAuth } from '../context/AuthContext';
import { isMainnet, OG_CHAIN_ID } from '../config/constants';

/**
 * Sticky banner shown when the user is connected but on a chain other than the
 * active 0G network. Clicking "Switch" asks the wallet to switch (adding the
 * network if it doesn't exist yet). Invisible when the user is disconnected or
 * already on the right chain.
 */
export function ChainBanner() {
  const { chainId, isCorrectChain, switchChain } = useWallet();
  const { isAuthenticated } = useAuth();
  const netName = `0G ${isMainnet ? 'Mainnet' : 'Galileo'}`;

  if (!isAuthenticated) return null;
  if (chainId == null) return null;
  if (isCorrectChain) return null;

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-amber-500/40 bg-amber-500/10 px-6 py-2 text-sm text-amber-100 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400" aria-hidden />
        <span>
          Wrong network — you're on chain <span className="font-mono">{chainId}</span>. BlindMarket runs on {netName} ({OG_CHAIN_ID}).
        </span>
      </div>
      <button
        type="button"
        onClick={switchChain}
        className="rounded-md border border-amber-300/60 bg-amber-400/20 px-3 py-1 text-xs font-medium text-amber-50 hover:bg-amber-400/30 transition-colors"
      >
        Switch to {netName}
      </button>
    </div>
  );
}

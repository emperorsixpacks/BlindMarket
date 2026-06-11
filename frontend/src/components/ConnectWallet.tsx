import { useWallet } from '../context/WalletContext';
import { useAuth } from '../context/AuthContext';
import { truncateAddress } from '../lib/utils';

export function ConnectWallet() {
  const { address, connecting, connect, disconnect } = useWallet();
  const { isAuthenticated, authenticating, login } = useAuth();

  // State 1: Not connected — show Connect button
  if (!isAuthenticated) {
    return (
      <button
        className="btn-ghost text-xs py-2"
        onClick={address ? login : connect}
        disabled={connecting || authenticating}
      >
        {connecting || authenticating ? 'Connecting...' : 'Connect'}
      </button>
    );
  }

  // State 2: Authenticated — show address + disconnect
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-neutral-800">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs text-neutral-300 font-mono">{truncateAddress(address ?? '')}</span>
      </div>
      <button
        className="px-3 py-1.5 rounded-lg text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
        onClick={disconnect}
      >
        Disconnect
      </button>
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { ogTestnet } from '../../config/chains';
import { isMainnet } from '../../config/constants';

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface Props {
  /** Render variant — 'pill' is the small TopBar pill, 'block' is a full-width CTA */
  variant?: 'pill' | 'block';
}

export function ConnectWalletButton({ variant = 'pill' }: Props) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  if (!ready) {
    return <div aria-hidden className="opacity-0 pointer-events-none select-none" />;
  }

  // Not signed in.
  if (!authenticated) {
    if (variant === 'block') {
      return (
        <button
          onClick={login}
          className="w-full px-4 py-2 border border-line text-sm font-mono text-ink hover:bg-surface-2 transition-colors"
        >
          connect_wallet
        </button>
      );
    }
    return (
      <button
        onClick={login}
        className="px-3 py-1.5 border border-line text-[11px] font-mono text-ink hover:bg-surface-2 transition-colors"
      >
        <span className="opacity-40">[</span> connect_wallet <span className="opacity-40">]</span>
      </button>
    );
  }

  // Authenticated, but on the wrong chain — wagmi has the connector via Privy.
  if (chainId && chainId !== ogTestnet.id) {
    return (
      <button
        onClick={() => switchChain({ chainId: ogTestnet.id })}
        className="px-3 py-1.5 border border-err text-[11px] font-mono text-err hover:bg-surface-2 transition-colors"
      >
        wrong_network
      </button>
    );
  }

  // Authenticated, right chain — show pill with dropdown for disconnect.
  return (
    <div className="relative" ref={menuRef}>
      <div className="flex items-center border border-line text-[11px] font-mono">
        <span className="hidden sm:flex px-3 py-1.5 text-ink-2 items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-ok inline-block" />
          {isMainnet ? '0G Mainnet' : ogTestnet.name}
        </span>
        <button
          onClick={() => setMenuOpen(o => !o)}
          className="px-3 py-1.5 sm:border-l border-line text-ink hover:bg-surface-2 transition-colors flex items-center gap-1.5"
        >
          <span className="sm:hidden w-1.5 h-1.5 bg-ok inline-block" />
          {address ? shortenAddress(address) : 'connected'}
        </button>
      </div>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 min-w-[180px] border border-line bg-surface text-[11px] font-mono z-50">
          {address && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(address);
                setMenuOpen(false);
              }}
              className="block w-full text-left px-3 py-2 text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors"
            >
              copy_address
            </button>
          )}
          <button
            onClick={() => {
              logout();
              setMenuOpen(false);
            }}
            className="block w-full text-left px-3 py-2 border-t border-line text-err hover:bg-surface-2 transition-colors"
          >
            disconnect
          </button>
        </div>
      )}
    </div>
  );
}

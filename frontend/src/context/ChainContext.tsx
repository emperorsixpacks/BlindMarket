import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { SUPPORTED_CHAINS, type SupportedChain } from '../config/constants';

const STORAGE_KEY = 'bb.chain';

interface ChainContextValue {
  activeChain: SupportedChain;
  setActiveChain: (chain: SupportedChain) => void;
  showSelector: boolean;
  dismissSelector: () => void;
}

const ChainContext = createContext<ChainContextValue | null>(null);

function loadChain(): SupportedChain {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED_CHAINS as readonly string[]).includes(saved)) {
      return saved as SupportedChain;
    }
  } catch {}
  return (import.meta.env.VITE_ACTIVE_CHAIN as SupportedChain | undefined) ?? 'og';
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const [activeChain, setActiveChainState] = useState<SupportedChain>(loadChain);
  const [showSelector, setShowSelector] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setShowSelector(true);
    }
  }, []);

  const setActiveChain = useCallback((chain: SupportedChain) => {
    setActiveChainState(chain);
    try { localStorage.setItem(STORAGE_KEY, chain); } catch {}
  }, []);

  const dismissSelector = useCallback(() => {
    setShowSelector(false);
    if (!localStorage.getItem(STORAGE_KEY)) {
      setActiveChain('og');
    }
  }, [setActiveChain]);

  return (
    <ChainContext.Provider value={{ activeChain, setActiveChain, showSelector, dismissSelector }}>
      {children}
    </ChainContext.Provider>
  );
}

export function useChain() {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error('useChain must be used within a ChainProvider');
  return ctx;
}

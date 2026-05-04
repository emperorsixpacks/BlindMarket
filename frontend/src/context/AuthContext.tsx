import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { usePrivy, getIdentityToken, getAccessToken } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';
import { setAccessTokenGetter } from '../lib/api';
import { trackEvent } from '../hooks/useAnalytics';

interface AuthState {
  isAuthenticated: boolean;
  authenticating: boolean;
  login: () => void;
  logout: () => Promise<void> | void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address } = useAccount();
  const trackedRef = useRef(false);

  // Wire Privy's identity token into api.ts so authedGet/authedPost
  // automatically attach Authorization: Bearer <privy-id-token>.
  // Identity tokens contain the linked_accounts claim needed for backend wallet extraction.
  useEffect(() => {
    if (authenticated) {
      setAccessTokenGetter(async () => {
        try {
          const idToken = await getIdentityToken();
          if (idToken) {
            console.log('[Auth] Using Identity Token');
            return idToken;
          }
          
          console.warn('[Auth] Identity Token null, falling back to Access Token');
          const accToken = await getAccessToken();
          return accToken;
        } catch (err) {
          console.error('[Auth] Failed to get tokens:', err);
          return null;
        }
      });
    } else {
      setAccessTokenGetter(null);
      trackedRef.current = false;
    }
  }, [authenticated, getIdentityToken]);

  // Fire analytics event the first time the user authenticates this session.
  useEffect(() => {
    if (authenticated && !trackedRef.current) {
      trackedRef.current = true;
      trackEvent('connect_wallet', address ? { address: address.toLowerCase() } : undefined);
    }
  }, [authenticated, address]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: authenticated,
        authenticating: !ready,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

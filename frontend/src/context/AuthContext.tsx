import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { post, setAccessTokenGetter } from '../lib/api';
import { trackEvent } from '../hooks/useAnalytics';

interface AuthState {
  jwt: string | null;
  isAuthenticated: boolean;
  authenticating: boolean;
  login: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const JWT_KEY = 'bb_jwt';

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [jwt, setJwt] = useState<string | null>(() => localStorage.getItem(JWT_KEY));
  const [authenticating, setAuthenticating] = useState(false);
  const signingRef = useRef(false);

  const isAuthenticated = !!jwt && isConnected;

  // Wire JWT into api.ts
  useEffect(() => {
    if (jwt) {
      setAccessTokenGetter(async () => jwt);
    } else {
      setAccessTokenGetter(null);
    }
  }, [jwt]);

  // Auto-sign when wallet connects and no valid JWT
  useEffect(() => {
    if (!isConnected || !address || jwt || signingRef.current) return;
    signingRef.current = true;
    setAuthenticating(true);

    (async () => {
      try {
        const { nonce } = await post<{ nonce: string }>('/api/v1/auth/nonce', { address });
        const message = `Sign this message to authenticate with BlindMarket.\n\nNonce: ${nonce}`;
        const signature = await signMessageAsync({ message });
        const { token } = await post<{ token: string }>('/api/v1/auth/verify', { address, signature });
        localStorage.setItem(JWT_KEY, token);
        setJwt(token);
        trackEvent('connect_wallet', { address: address.toLowerCase() });
      } catch (err) {
        console.warn('[auth] SIWE sign failed:', err);
      } finally {
        signingRef.current = false;
        setAuthenticating(false);
      }
    })();
  }, [isConnected, address, jwt, signMessageAsync]);

  // Clear JWT on disconnect or address change
  useEffect(() => {
    if (!isConnected) {
      localStorage.removeItem(JWT_KEY);
      setJwt(null);
      signingRef.current = false;
    }
  }, [isConnected]);

  const login = async () => {
    setJwt(null);
    signingRef.current = false;
  };

  const logout = () => {
    localStorage.removeItem(JWT_KEY);
    setJwt(null);
    signingRef.current = false;
  };

  return (
    <AuthContext.Provider value={{ jwt, isAuthenticated, authenticating, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { SuiClientProvider, WalletProvider as SuiDappKitWalletProvider, useCurrentAccount, useDisconnectWallet } from '@mysten/dapp-kit';
import { SuiJsonRpcClient, JsonRpcHTTPTransport } from '@mysten/sui/jsonRpc';
import { SUI_RPC_URL } from '../config/constants';

interface SuiWalletContextValue {
  address: string | undefined;
  isConnected: boolean;
  connectModalOpen: boolean;
  setConnectModalOpen: (open: boolean) => void;
  connect: () => void;
  disconnect: () => void;
}

const SuiWalletContext = createContext<SuiWalletContextValue | null>(null);

function SuiWalletInner({ children }: { children: ReactNode }) {
  const account = useCurrentAccount();
  const { mutate: doDisconnect } = useDisconnectWallet();
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const disconnect = useCallback(() => doDisconnect(), [doDisconnect]);
  const connect = useCallback(() => setConnectModalOpen(true), []);

  return (
    <SuiWalletContext.Provider
      value={{
        address: account?.address,
        isConnected: !!account,
        connectModalOpen,
        setConnectModalOpen,
        connect,
        disconnect,
      }}
    >
      {children}
    </SuiWalletContext.Provider>
  );
}

const suiNetwork = SUI_RPC_URL.includes('mainnet') ? 'mainnet' : 'testnet';
const suiNetworks = {
  testnet: new SuiJsonRpcClient({
    transport: new JsonRpcHTTPTransport({ url: SUI_RPC_URL }),
    network: suiNetwork,
  }),
};

export function SuiWalletProvider({ children }: { children: ReactNode }) {
  return (
    <SuiClientProvider defaultNetwork="testnet" networks={suiNetworks}>
      <SuiDappKitWalletProvider>
        <SuiWalletInner>
          {children}
        </SuiWalletInner>
      </SuiDappKitWalletProvider>
    </SuiClientProvider>
  );
}

export function useSuiWallet() {
  const ctx = useContext(SuiWalletContext);
  if (!ctx) throw new Error('useSuiWallet must be used within a SuiWalletProvider');
  return ctx;
}

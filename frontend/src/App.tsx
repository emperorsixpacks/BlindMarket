import { type ReactNode } from 'react';
import { Routes, Route } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { config, customTheme } from './config/rainbowkit';
import { PrivyProvider } from '@privy-io/react-auth';
import { ogTestnet } from './config/chains';
import { WalletProvider } from './context/WalletContext';
import { AuthProvider } from './context/AuthContext';
import { DashboardLayout } from './components/bb/DashboardLayout';
import Landing from './pages/Landing';
import TaskFeed from './pages/TaskFeed';
import TaskDetail from './pages/TaskDetail';
import AgentDashboard from './pages/AgentDashboard';
import WorkerView from './pages/WorkerView';
import VerificationStatus from './pages/VerificationStatus';
import HowItWorks from './pages/HowItWorks';
import Earnings from './pages/Earnings';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';
import RegisterAgent from './pages/RegisterAgent';
import Validators from './pages/Validators';
import DeployAgent from './pages/DeployAgent';
import AgentDetail from './pages/AgentDetail';
import AgentMarketplace from './pages/AgentMarketplace';

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID;
const isValidPrivyId = privyAppId && privyAppId.startsWith('c') && privyAppId.length > 10;

const queryClient = new QueryClient();

function MaybePrivy({ children }: { children: ReactNode }) {
  if (!isValidPrivyId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        defaultChain: ogTestnet,
        supportedChains: [ogTestnet],
        appearance: { theme: 'dark' },
        loginMethods: ['wallet', 'email', 'google', 'twitter'],
        // Disable Coinbase Smart Wallet — CSW only supports a fixed chain list
        // (Base, Mainnet, etc.) and throws "configured chains not supported"
        // on 0G Galileo (16602), which stalls Privy's modal render.
        // EOA-only means the regular Coinbase Wallet browser extension /
        // mobile app still works; only the smart-contract-wallet flavor is off.
        externalWallets: {
          coinbaseWallet: {
            config: {
              preference: { options: 'eoaOnly' },
            },
          },
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

export default function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={customTheme}>
          <MaybePrivy>
            <WalletProvider>
              <AuthProvider>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/register/:token" element={<RegisterAgent />} />
                  <Route element={<DashboardLayout />}>
                    <Route path="/how-it-works" element={<HowItWorks />} />
                    <Route path="/tasks" element={<TaskFeed />} />
                    <Route path="/tasks/:id" element={<TaskDetail />} />
                    <Route path="/agent" element={<AgentDashboard />} />
                    <Route path="/worker" element={<WorkerView />} />
                    <Route path="/validators" element={<Validators />} />
                    <Route path="/verification" element={<VerificationStatus />} />
                    <Route path="/earnings" element={<Earnings />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/agents" element={<AgentMarketplace />} />
                    <Route path="/agents/deploy" element={<DeployAgent />} />
                    <Route path="/agents/:id" element={<AgentDetail />} />
                  </Route>
                  <Route path="*" element={<DashboardLayout />}>
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
              </AuthProvider>
            </WalletProvider>
          </MaybePrivy>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

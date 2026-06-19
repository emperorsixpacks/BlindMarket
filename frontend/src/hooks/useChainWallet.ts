import { useCallback } from 'react';
import { useAccount, useBalance as useWagmiBalance } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { useChain } from '../context/ChainContext';
import { useSuiWallet } from '../context/SuiWalletContext';
import { isMainnet, OG_CHAIN_ID, getNativeCurrency } from '../config/constants';
import { useWallet } from '../context/WalletContext';

export function useChainAddress(): string | undefined {
  const { activeChain } = useChain();
  const { address: evmAddress } = useAccount();
  const { address: suiAddress } = useSuiWallet();

  return activeChain === 'sui' ? suiAddress : evmAddress;
}

export function useChainIsConnected(): boolean {
  const { activeChain } = useChain();
  const { isConnected: evmConnected } = useAccount();
  const { isConnected: suiConnected } = useSuiWallet();

  return activeChain === 'sui' ? suiConnected : evmConnected;
}

export function useChainConnect() {
  const { activeChain } = useChain();
  const { login: evmLogin } = usePrivy();
  const { connect: suiConnect } = useSuiWallet();

  return useCallback(() => {
    if (activeChain === 'sui') {
      suiConnect();
    } else {
      evmLogin();
    }
  }, [activeChain, evmLogin, suiConnect]);
}

export function useChainDisconnect() {
  const { activeChain } = useChain();
  const { logout: evmLogout } = usePrivy();
  const { disconnect: suiDisconnect } = useSuiWallet();

  return useCallback(() => {
    if (activeChain === 'sui') {
      suiDisconnect();
    } else {
      evmLogout();
    }
  }, [activeChain, evmLogout, suiDisconnect]);
}

export function useChainBalance() {
  const { activeChain } = useChain();
  const { address: evmAddress } = useAccount();
  const { data: wagmiBal } = useWagmiBalance({ address: evmAddress, chainId: OG_CHAIN_ID });
  const native = getNativeCurrency(activeChain);

  if (activeChain === 'sui') {
    return {
      value: undefined as bigint | undefined,
      decimals: native.decimals,
      symbol: native.symbol,
      formatted: undefined as string | undefined,
    };
  }

  return {
    value: wagmiBal?.value,
    decimals: native.decimals,
    symbol: native.symbol,
    formatted: wagmiBal ? wagmiBal.formatted : undefined,
  };
}

export function useChainIsCorrectChain(): boolean {
  const { activeChain } = useChain();
  const { chainId } = useWallet();

  if (activeChain === 'sui') {
    return true;
  }

  return chainId === OG_CHAIN_ID;
}

export function useChainExplorerUrl(): string {
  const { activeChain } = useChain();

  if (activeChain === 'sui') {
    const suiNetwork = import.meta.env.VITE_SUI_NETWORK_ID;
    return import.meta.env.VITE_SUI_EXPLORER_URL ||
      (suiNetwork === 'mainnet' ? 'https://suivision.xyz' : 'https://testnet.suivision.xyz');
  }

  return isMainnet
    ? 'https://chainscan.0g.ai'
    : 'https://chainscan-newton.0g.ai';
}

import { useCallback } from 'react';
import { useAccount, useBalance as useWagmiBalance } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { OG_CHAIN_ID, getNativeCurrency } from '../config/constants';
import { useWallet } from '../context/WalletContext';

export function useChainAddress(): string | undefined {
  const { address: evmAddress } = useWallet();
  return evmAddress ?? undefined;
}

export function useChainIsConnected(): boolean {
  const { address: evmAddress } = useWallet();
  return !!evmAddress;
}

export function useChainConnect() {
  const { login: evmLogin } = usePrivy();
  return useCallback(() => {
    evmLogin();
  }, [evmLogin]);
}

export function useChainDisconnect() {
  const { logout: evmLogout } = usePrivy();
  return useCallback(() => {
    evmLogout();
  }, [evmLogout]);
}

export function useChainBalance() {
  const { address: evmAddress } = useAccount();
  const { data: wagmiBal } = useWagmiBalance({ address: evmAddress, chainId: OG_CHAIN_ID });
  const native = getNativeCurrency('og');

  return {
    value: wagmiBal?.value,
    decimals: native.decimals,
    symbol: native.symbol,
    formatted: wagmiBal ? wagmiBal.formatted : undefined,
  };
}

export function useChainIsCorrectChain(): boolean {
  const { chainId } = useWallet();
  return chainId === OG_CHAIN_ID;
}

export function useChainExplorerUrl(): string {
  return OG_CHAIN_ID === 16661
    ? 'https://chainscan.0g.ai'
    : 'https://chainscan-newton.0g.ai';
}
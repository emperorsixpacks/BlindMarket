import { useEffect, useState } from 'react';
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';

const TOKEN = (import.meta.env.VITE_MOCK_ERC20_ADDRESS ?? '0x3af9232009C5da30AdA366B6E09849A040162A1a') as `0x${string}`;
const MINT_AMOUNT_HUMAN = 1000n; // mints 1,000 test USDC per click
const FALLBACK_DECIMALS = 6; // mock USDC is deployed with 6 decimals — used when RPC read is slow/failing

const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

function formatBalance(raw: bigint | undefined, decimals: number | undefined): string {
  if (raw === undefined || decimals === undefined) return '—';
  const formatted = formatUnits(raw, decimals);
  const n = Number(formatted);
  if (!Number.isFinite(n)) return formatted;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function MintTestTokensCard() {
  const { address, isConnected } = useAccount();
  const [justMinted, setJustMinted] = useState(false);
  const [optimisticBalance, setOptimisticBalance] = useState<bigint | null>(null);

  const { data: decimalsFromChain } = useReadContract({
    address: TOKEN,
    abi: erc20Abi,
    functionName: 'decimals',
    query: { enabled: isConnected },
  });
  const decimals = (decimalsFromChain as number | undefined) ?? FALLBACK_DECIMALS;

  const {
    data: balance,
    refetch: refetchBalance,
  } = useReadContract({
    address: TOKEN,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { writeContract, data: txHash, isPending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Refetch balance + show success state on confirmation
  useEffect(() => {
    if (!isConfirmed) return;
    setJustMinted(true);
    setOptimisticBalance((prev) => {
      const base = (balance as bigint | undefined) ?? prev ?? 0n;
      return base + parseUnits(MINT_AMOUNT_HUMAN.toString(), decimals);
    });
    void refetchBalance();
    const t = setTimeout(() => {
      setJustMinted(false);
      reset();
    }, 4000);
    return () => clearTimeout(t);
  }, [isConfirmed, refetchBalance, reset, balance, decimals]);

  // Drop optimistic value once the real balance has caught up
  useEffect(() => {
    if (optimisticBalance === null) return;
    const real = balance as bigint | undefined;
    if (real !== undefined && real >= optimisticBalance) setOptimisticBalance(null);
  }, [balance, optimisticBalance]);

  if (!isConnected) return null;

  const handleMint = () => {
    if (!address) return;
    writeContract({
      address: TOKEN,
      abi: erc20Abi,
      functionName: 'mint',
      args: [address, parseUnits(MINT_AMOUNT_HUMAN.toString(), decimals)],
    });
  };

  const busy = isPending || isConfirming;
  const status = isPending
    ? 'sign in wallet…'
    : isConfirming
      ? 'confirming…'
      : justMinted
        ? `✓ +${MINT_AMOUNT_HUMAN.toLocaleString()} minted`
        : `mint ${MINT_AMOUNT_HUMAN.toLocaleString()} test USDC`;

  const displayBalance = optimisticBalance ?? (balance as bigint | undefined);

  return (
    <div className="mb-6 border border-line bg-surface-2 px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
      <div className="text-xs font-mono space-y-1">
        <div className="text-ink-3 uppercase tracking-widest text-[10px]">test wallet</div>
        <div className="text-ink">
          balance: <span className="text-cream">{formatBalance(displayBalance, decimals)}</span> USDC
          <span className="text-ink-3"> (mock)</span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={handleMint}
          disabled={busy}
          className={`px-4 py-2 border text-[11px] font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            justMinted
              ? 'border-ok text-ok'
              : 'border-cream text-cream hover:bg-cream hover:text-bg'
          }`}
        >
          {status}
        </button>
        {writeError && (
          <div className="text-[10px] font-mono text-err max-w-[280px] text-right truncate">
            {(writeError as Error).message.slice(0, 80)}
          </div>
        )}
      </div>
    </div>
  );
}

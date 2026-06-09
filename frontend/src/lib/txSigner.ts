import type { ethers } from 'ethers';
import type { UnsignedTx } from '../types/api';

export interface SentTx {
  /** The submitted transaction hash. Always present once the wallet accepts —
   *  never lost even if the receipt poll below times out. */
  hash: string;
  /** The mined receipt, or null if the RPC hadn't surfaced it within the poll
   *  window (the tx is still on-chain; callers should index by `hash`). */
  receipt: ethers.TransactionReceipt | null;
}

export async function signAndSendTx(
  signer: ethers.JsonRpcSigner,
  unsignedTx: UnsignedTx,
  value?: bigint,
): Promise<SentTx> {
  const txResponse = await signer.sendTransaction({
    to: unsignedTx.to,
    data: unsignedTx.data,
    value: value,
    gasLimit: 1_000_000,
  });

  // Retry receipt fetch — 0G RPC can be slow to index a fresh tx.
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const receipt = await txResponse.provider.getTransactionReceipt(txResponse.hash);
      if (receipt) return { hash: txResponse.hash, receipt };
    } catch { /* keep retrying */ }
  }
  // Receipt not confirmed within the window — the tx WAS submitted, so return
  // its hash regardless. Losing it here would force callers to fall back to a
  // bogus/empty hash when indexing, stranding a funded on-chain task.
  return { hash: txResponse.hash, receipt: null };
}

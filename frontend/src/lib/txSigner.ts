import type { ethers } from 'ethers';
import type { UnsignedTx } from '../types/api';

/**
 * Sign and send an unsigned transaction via the user's wallet (MetaMask).
 * Returns the transaction receipt.
 */
export async function signAndSendTx(
  signer: ethers.JsonRpcSigner,
  unsignedTx: UnsignedTx,
): Promise<ethers.TransactionReceipt> {
  const txResponse = await signer.sendTransaction({
    to: unsignedTx.to,
    data: unsignedTx.data,
  });
  const receipt = await txResponse.wait();
  if (!receipt) throw new Error('Transaction failed — no receipt');
  return receipt;
}

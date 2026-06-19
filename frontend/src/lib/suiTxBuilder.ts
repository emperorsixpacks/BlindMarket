import { Transaction } from '@mysten/sui/transactions';
import { SUI_PACKAGE_ID, SUI_BLIND_ESCROW_OBJECT_ID } from '../config/constants';

function hexToBytes(hex: string): number[] {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i < h.length; i += 2) {
    bytes.push(parseInt(h.substring(i, i + 2), 16));
  }
  return bytes;
}

export function buildSuiCreateTask(
  taskHash: string,
  amount: string,
  category: string,
  locationZone: string,
  deadline: number,
) {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
  tx.moveCall({
    target: `${SUI_PACKAGE_ID}::blind_escrow::create_task`,
    arguments: [
      tx.object(SUI_BLIND_ESCROW_OBJECT_ID),
      coin,
      tx.pure.vector('u8', hexToBytes(taskHash)),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(category))),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(locationZone))),
      tx.pure.u64(deadline),
    ],
  });
  return tx;
}

export function buildSuiCancelTask(taskId: string | bigint) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${SUI_PACKAGE_ID}::blind_escrow::cancel_task`,
    arguments: [
      tx.object(SUI_BLIND_ESCROW_OBJECT_ID),
      tx.pure.u64(Number(taskId)),
    ],
  });
  return tx;
}

export function buildSuiClaimTimeout(taskId: string | bigint) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${SUI_PACKAGE_ID}::blind_escrow::claim_timeout`,
    arguments: [
      tx.object(SUI_BLIND_ESCROW_OBJECT_ID),
      tx.pure.u64(Number(taskId)),
    ],
  });
  return tx;
}

export function buildSuiTransferCoin(to: string, amount: string) {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
  tx.transferObjects([coin], tx.pure.address(to));
  return tx;
}

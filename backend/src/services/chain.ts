import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const abiDir = join(__dirname, '..', 'abi');

function loadAbi(name: string): ethers.InterfaceAbi {
  return JSON.parse(readFileSync(join(abiDir, `${name}.json`), 'utf-8')) as ethers.InterfaceAbi;
}

// ═══════════════════════════════════════════════════════════════════════════
// 0G / EVM Chain (only chain supported)
// ═══════════════════════════════════════════════════════════════════════════

export const provider: ethers.JsonRpcProvider = new ethers.JsonRpcProvider(config.ogRpcUrl, config.ogChainId, {
  batchMaxCount: 1,
  staticNetwork: true,
});

/** Signing wallet for backend-initiated transactions (e.g. INFT mint) */
export const signer: ethers.Wallet | null = config.ogStoragePrivateKey
  ? new ethers.Wallet(config.ogStoragePrivateKey, provider)
  : null;

export const marketplaceSigner: ethers.Wallet | null = config.marketplaceSignerPrivateKey
  ? new ethers.Wallet(config.marketplaceSignerPrivateKey, provider)
  : null;

/** Read-only contract instances */
export const escrow: ethers.Contract = new ethers.Contract(config.blindEscrowAddress, loadAbi('BlindEscrow'), provider);
export const registry: ethers.Contract = new ethers.Contract(config.taskRegistryAddress, loadAbi('TaskRegistry'), provider);
export const reputation: ethers.Contract = new ethers.Contract(config.blindReputationAddress, loadAbi('BlindReputation'), provider);

/** Write-capable BlindEscrow bound to the marketplace signer (verifier role). */
export const escrowAsMarketplace: ethers.Contract | null = marketplaceSigner
  ? new ethers.Contract(config.blindEscrowAddress, loadAbi('BlindEscrow'), marketplaceSigner)
  : null;

/** INFT contract — write-capable when signer is available */
export const inft: ethers.Contract | null = config.inftAddress
  ? new ethers.Contract(config.inftAddress, loadAbi('INFT'), signer ?? provider)
  : null;

/** Encode an unsigned transaction for a contract call (frontend signs) */
export async function buildUnsignedTx(
  contract: ethers.Contract,
  method: string,
  args: unknown[],
  from: string,
  value?: bigint,
): Promise<ethers.TransactionRequest> {
  const data = contract.interface.encodeFunctionData(method, args);
  const to = await contract.getAddress();
  return {
    to,
    data,
    from: ethers.getAddress(from),
    ...(value !== undefined ? { value } : {}),
  };
}

/** Get decimals for an ERC-20 token. Returns 18 for native 0G. */
export async function getTokenDecimals(tokenAddress: string): Promise<number> {
  if (tokenAddress === '0x0000000000000000000000000000000000000000') return 18;
  try {
    const token = new ethers.Contract(tokenAddress, ['function decimals() view returns (uint8)'], provider!);
    return Number(await token.decimals());
  } catch {
    return 18;
  }
}
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

/** Read-only JSON-RPC provider for 0G Chain */
export const provider = new ethers.JsonRpcProvider(config.ogRpcUrl, config.ogChainId);

/** Signing wallet for backend-initiated transactions (e.g. INFT mint) */
export const signer = config.ogStoragePrivateKey
  ? new ethers.Wallet(config.ogStoragePrivateKey, provider)
  : null;

/** Read-only contract instances */
export const escrow = new ethers.Contract(config.blindEscrowAddress, loadAbi('BlindEscrow'), provider);
export const registry = new ethers.Contract(config.taskRegistryAddress, loadAbi('TaskRegistry'), provider);
export const reputation = new ethers.Contract(config.blindReputationAddress, loadAbi('BlindReputation'), provider);

/** INFT contract — write-capable when signer is available */
export const inft = config.inftAddress
  ? new ethers.Contract(config.inftAddress, loadAbi('INFT'), signer ?? provider)
  : null;

/** Encode an unsigned transaction for a contract call (frontend signs) */
export async function buildUnsignedTx(
  contract: ethers.Contract,
  method: string,
  args: unknown[],
  from: string,
): Promise<ethers.TransactionRequest> {
  const data = contract.interface.encodeFunctionData(method, args);
  const to = await contract.getAddress();
  return { to, data, from: ethers.getAddress(from) };
}

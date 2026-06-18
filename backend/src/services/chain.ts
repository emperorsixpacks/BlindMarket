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
// Chain type guard
// ═══════════════════════════════════════════════════════════════════════════

export const isSui = config.chainType === 'sui';
export const isEvm = config.chainType === 'evm';

// ═══════════════════════════════════════════════════════════════════════════
// EVM / 0G Chain (default)
// ═══════════════════════════════════════════════════════════════════════════

function notOnEvm(name: string): never {
  throw new Error(`${name} is only available on EVM chains (CHAIN_TYPE=evm). Current: CHAIN_TYPE=${config.chainType}`);
}

export const provider: ethers.JsonRpcProvider = isEvm
  ? new ethers.JsonRpcProvider(config.ogRpcUrl, config.ogChainId, {
      batchMaxCount: 1,
      staticNetwork: true,
    })
  : new Proxy({} as ethers.JsonRpcProvider, { get: () => notOnEvm('provider') });

/** Signing wallet for backend-initiated transactions (e.g. INFT mint) */
export const signer: ethers.Wallet | null = isEvm && config.ogStoragePrivateKey
  ? new ethers.Wallet(config.ogStoragePrivateKey, provider)
  : null;

export const marketplaceSigner: ethers.Wallet | null = isEvm && config.marketplaceSignerPrivateKey
  ? new ethers.Wallet(config.marketplaceSignerPrivateKey, provider)
  : null;

/** Read-only contract instances */
export const escrow: ethers.Contract = isEvm
  ? new ethers.Contract(config.blindEscrowAddress, loadAbi('BlindEscrow'), provider)
  : new Proxy({} as ethers.Contract, { get: () => notOnEvm('escrow') });
export const registry: ethers.Contract = isEvm
  ? new ethers.Contract(config.taskRegistryAddress, loadAbi('TaskRegistry'), provider)
  : new Proxy({} as ethers.Contract, { get: () => notOnEvm('registry') });
export const reputation: ethers.Contract = isEvm
  ? new ethers.Contract(config.blindReputationAddress, loadAbi('BlindReputation'), provider)
  : new Proxy({} as ethers.Contract, { get: () => notOnEvm('reputation') });

/** Write-capable BlindEscrow bound to the marketplace signer (verifier role). */
export const escrowAsMarketplace: ethers.Contract | null = isEvm && marketplaceSigner
  ? new ethers.Contract(config.blindEscrowAddress, loadAbi('BlindEscrow'), marketplaceSigner)
  : null;

/** INFT contract — write-capable when signer is available */
export const inft: ethers.Contract | null = isEvm && config.inftAddress
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

/** Get decimals for an ERC-20 token. Returns 9 for SUI (non-EVM). */
export async function getTokenDecimals(tokenAddress: string): Promise<number> {
  if (isSui) return 9; // SUI has 9 decimals
  if (tokenAddress === '0x0000000000000000000000000000000000000000') return 18;
  try {
    const token = new ethers.Contract(tokenAddress, ['function decimals() view returns (uint8)'], provider!);
    return Number(await token.decimals());
  } catch {
    return 18;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Sui Chain (lazy-initialised)
// ═══════════════════════════════════════════════════════════════════════════

let _suiClient: import('@mysten/sui/grpc').SuiGrpcClient | null = null;

export function getSuiClient() {
  if (!isSui) return null;
  return _suiClient;
}

let _suiSigner: import('@mysten/sui/keypairs/ed25519').Ed25519Keypair | null = null;
let _suiSignerAddress: string | null = null;

export function getSuiSigner() {
  return _suiSigner;
}

export function getSuiSignerAddress() {
  return _suiSignerAddress;
}

/** Initialise Sui chain — call once at boot (after config loaded). */
export async function initSui(): Promise<void> {
  if (!isSui) return;

  try {
    const { SuiGrpcClient } = await import('@mysten/sui/grpc');
    _suiClient = new SuiGrpcClient({
      network: config.suiNetworkId,
      baseUrl: config.suiRpcUrl,
    });
    console.log(`[chain] Sui gRPC client connected to ${config.suiNetworkId}`);

    if (config.suiAgentPrivateKey) {
      const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
      _suiSigner = Ed25519Keypair.fromSecretKey(config.suiAgentPrivateKey);
      _suiSignerAddress = _suiSigner.toSuiAddress();
      console.log(`[chain] Sui signer: ${_suiSignerAddress}`);
    }
  } catch (err) {
    console.error('[chain] Failed to initialise Sui — @mysten/sui may not be installed:', err);
  }
}

/**
 * Build a Sui Move call transaction (unsigned).
 * Returns JSON that the worker/agent can sign and execute.
 *
 * TODO: wire after Move contracts deployed and package ID known.
 */
export async function buildSuiMoveCallTx(_params: {
  moduleName: string;
  functionName: string;
  args: unknown[];
  typeArgs?: string[];
}): Promise<Record<string, unknown>> {
  throw new Error('buildSuiMoveCallTx: Sui contract interaction not yet wired. Deploy Move contracts first.');
}

/**
 * Execute a Sui transaction server-side.
 * TODO: wire after Move contracts deployed.
 */
export async function executeSuiTx(_txJson: Record<string, unknown>): Promise<{ digest: string }> {
  throw new Error('executeSuiTx: Sui contract interaction not yet wired. Deploy Move contracts first.');
}

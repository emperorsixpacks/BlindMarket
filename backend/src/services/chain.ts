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
 * Build a Sui Move call transaction JSON (unsigned) that can be signed
 * and executed via executeSuiTx or by the agent's wallet.
 */
export async function buildSuiAssignTx(taskId: bigint, executor: string): Promise<string> {
  const { Transaction } = await import('@mysten/sui/transactions');
  const tx = new Transaction();

  tx.moveCall({
    target: `${config.suiPackageId}::blind_escrow::marketplace_assign` as `${string}::${string}::${string}`,
    arguments: [
      tx.object(config.suiBlindEscrowObjectId),
      tx.object(config.suiTaskRegistryObjectId),
      tx.pure.u64(taskId),
      tx.pure.address(executor),
    ],
  });

  return tx.toJSON();
}

/**
 * Execute a Sui transaction server-side using the backend Sui signer.
 * Requires CHAIN_TYPE=sui and SUI_AGENT_PRIVATE_KEY to be set.
 */
export async function executeSuiTx(txJson: string): Promise<{ digest: string }> {
  if (!_suiSigner) {
    throw new Error('executeSuiTx: Sui signer not available (SUI_AGENT_PRIVATE_KEY not set)');
  }

  const { Transaction } = await import('@mysten/sui/transactions');
  const { fromBase64, toBase64 } = await import('@mysten/utils');

  const tx = Transaction.from(txJson);
  tx.setSenderIfNotSet(_suiSigner.toSuiAddress());

  const bytes = await tx.build();
  const { signature } = await _suiSigner.signTransaction(bytes);

  const txBase64 = toBase64(new Uint8Array(bytes));

  const rpcUrl = config.suiRpcUrl.replace(/\/$/, '');
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sui_executeTransactionBlock',
      params: [
        txBase64,
        [signature],
        { showEffects: true, showEvents: true, showObjectChanges: true },
      ],
    }),
  });

  const json = await response.json() as any;
  if (json.error) {
    throw new Error(`Sui tx failed: ${json.error.message}`);
  }

  const digest: string | undefined = json.result?.digest;
  if (!digest) {
    throw new Error('Sui tx executed but no digest returned');
  }

  return { digest };
}

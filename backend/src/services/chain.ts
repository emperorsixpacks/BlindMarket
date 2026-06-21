import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const abiDir = join(__dirname, '..', 'abi');

/** Normalize a Sui address to zero-padded 64-char hex form (Sui canonical). */
export function normalizeSuiAddr(addr: string): string {
  let hex = addr.startsWith('0x') ? addr.slice(2) : addr;
  hex = hex.padStart(64, '0');
  return '0x' + hex.toLowerCase();
}

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
  return _suiClient;
}

let _suiSigner: import('@mysten/sui/keypairs/ed25519').Ed25519Keypair | null = null;
let _suiSignerAddress: string | null = null;

// Eager init at module load (best-effort, caught by ensureSuiSigner on first use).
void ensureSuiSigner().catch(() => {});

export function getSuiSigner() {
  return _suiSigner;
}

export function getSuiSignerAddress() {
  return _suiSignerAddress;
}

/** Initialise Sui gRPC client (non-blocking — signer is already set at module level). */
export async function initSui(): Promise<void> {
  try {
    const { SuiGrpcClient } = await import('@mysten/sui/grpc');
    _suiClient = new SuiGrpcClient({
      network: config.suiNetworkId,
      baseUrl: config.suiRpcUrl,
    });
    console.log(`[chain] Sui gRPC client connected to ${config.suiNetworkId}`);
  } catch (err) {
    console.error('[chain] Failed to initialise Sui gRPC client:', err);
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
 * Build a Sui Move call transaction for marketplace_complete_verification.
 * The backend Sui signer (verifier address) signs and executes this.
 */
export async function buildSuiCompleteVerificationTx(taskId: bigint, passed: boolean): Promise<string> {
  const { Transaction } = await import('@mysten/sui/transactions');
  const tx = new Transaction();

  tx.moveCall({
    target: `${config.suiPackageId}::blind_escrow::marketplace_complete_verification` as `${string}::${string}::${string}`,
    arguments: [
      tx.object(config.suiBlindEscrowObjectId),
      tx.pure.u64(taskId),
      tx.pure.bool(passed),
    ],
  });

  return tx.toJSON();
}

/**
 * Read a task's on-chain state from the Sui Move contract.
 * Calls blind_escrow::get_task via devInspect and returns the relevant fields.
 */
export async function getSuiTask(taskId: bigint): Promise<{ worker: string; submissionAttempts: number; status: number; evidenceHash: string; deadline: number }> {
  const { Transaction } = await import('@mysten/sui/transactions');
  const { toBase64 } = await import('@mysten/utils');

  const tx = new Transaction();

  tx.moveCall({
    target: `${config.suiPackageId}::blind_escrow::get_task` as `${string}::${string}::${string}`,
    arguments: [
      tx.object(config.suiBlindEscrowObjectId),
      tx.pure.u64(taskId),
    ],
  });

  const bytes = await tx.build();
  const txBase64 = toBase64(new Uint8Array(bytes));

  const rpcUrl = config.suiRpcUrl.replace(/\/$/, '');
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sui_devInspectTransactionBlock',
      params: [_suiSignerAddress ?? '0x0', txBase64],
    }),
  });

  const json = await response.json() as any;
  if (json.error) {
    throw new Error(`getSuiTask: ${json.error.message}`);
  }

  const results = json.result?.results;
  if (!results || results.length === 0) {
    throw new Error(`getSuiTask: no results for task ${taskId}`);
  }

  const returnValues = results[0]?.returnValues;
  if (!returnValues || returnValues.length === 0) {
    throw new Error(`getSuiTask: no return values for task ${taskId}`);
  }

  // returnValues[0] = [raw_base64_bytes, type_tag_string]
  const raw = returnValues[0][0] as string;
  const rawBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

  // Debug: log first 64 bytes (agent + worker) so we can see the raw address bytes
  const agentHex = Array.from(rawBytes.slice(0, 32)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const workerHex = Array.from(rawBytes.slice(32, 64)).map((b) => b.toString(16).padStart(2, '0')).join('');
  console.log(`[getSuiTask] taskId=${taskId} rawLen=${rawBytes.length} agent=0x${agentHex} worker=0x${workerHex}`);

  // Parse the Task struct from BCS.
  // Task struct field order: agent (32B), worker (32B), token_type (vec), amount (u64),
  // task_hash (vec), evidence_hash (vec), status (u8), category (vec),
  // location_zone (vec), created_at (u64), deadline (u64), submission_attempts (u8), verifier (32B)
  let offset = 0;
  const readAddress = () => {
    const addrBytes = rawBytes.slice(offset, offset + 32);
    offset += 32;
    return '0x' + Array.from(addrBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  const readVec = () => {
    // ULEB128 length
    let len = 0;
    let shift = 0;
    while (true) {
      const byte = rawBytes[offset++];
      len |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) break;
      shift += 7;
    }
    const val = rawBytes.slice(offset, offset + len);
    offset += len;
    return val;
  };
  const readU64 = () => {
    const val = Number(
      (BigInt(rawBytes[offset]) << 0n) |
      (BigInt(rawBytes[offset + 1]) << 8n) |
      (BigInt(rawBytes[offset + 2]) << 16n) |
      (BigInt(rawBytes[offset + 3]) << 24n) |
      (BigInt(rawBytes[offset + 4]) << 32n) |
      (BigInt(rawBytes[offset + 5]) << 40n) |
      (BigInt(rawBytes[offset + 6]) << 48n) |
      (BigInt(rawBytes[offset + 7]) << 56n)
    );
    offset += 8;
    return val;
  };
  const readU8 = () => rawBytes[offset++];

  readAddress(); // agent
  const worker = readAddress();
  readVec(); // token_type
  readU64(); // amount
  readVec(); // task_hash
  const evidenceHashBytes = readVec();
  const evidenceHash = '0x' + Array.from(evidenceHashBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const status = readU8();
  readVec(); // category
  readVec(); // location_zone
  readU64(); // created_at
  const deadline = readU64();
  const submissionAttempts = readU8();

  return { worker, submissionAttempts, status, evidenceHash, deadline };
}

/**
 * Ensure the Sui signer is initialised (lazy on first use, guarded by try-catch
 * so module-level top-level-await failure doesn't cascade here either).
 */
async function ensureSuiSigner(): Promise<void> {
  if (_suiSigner) return;
  if (!config.suiAgentPrivateKey) {
    throw new Error('Sui signer not available: SUI_AGENT_PRIVATE_KEY is not set in env');
  }
  const raw = config.suiAgentPrivateKey.replace(/^0x/, '');
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    const secretKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) secretKey[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    _suiSigner = Ed25519Keypair.fromSecretKey(secretKey);
  } else {
    _suiSigner = Ed25519Keypair.fromSecretKey(raw);
  }
  if (!_suiSigner) throw new Error('Ed25519Keypair.fromSecretKey returned null'); // TS narrow
  _suiSignerAddress = _suiSigner.toSuiAddress();
  console.log(`[chain] Sui signer (lazy): ${_suiSignerAddress}`);
}

/**
 * Execute a Sui transaction server-side using the backend Sui signer.
 * Requires SUI_AGENT_PRIVATE_KEY to be set (regardless of CHAIN_TYPE).
 */
export async function executeSuiTx(txJson: string): Promise<{ digest: string }> {
  await ensureSuiSigner();
  if (!_suiSigner) {
    throw new Error('Sui signer not available (SUI_AGENT_PRIVATE_KEY not set or invalid)');
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

  // Check Move-level execution status — the RPC may return 200 even when
  // the transaction aborts (e.g. function precondition fails).
  const effectStatus = json.result?.effects?.status;
  if (!effectStatus) {
    console.warn(`[chain] executeSuiTx: no effect status in response for ${digest} — treating as success`);
  } else if (effectStatus.status === 'failure') {
    const errMsg = effectStatus.error || 'unknown Move-level error';
    throw new Error(`Sui tx ${digest} failed at execution: ${errMsg}`);
  } else if (effectStatus.status === 'success') {
    console.log(`[chain] executeSuiTx: ${digest} succeeded`);
  }

  return { digest };
}

import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk';
import { ethers } from 'ethers';
import { createHash, randomBytes } from 'crypto';
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { config } from '../config.js';

/**
 * 0G Storage service — upload/download encrypted blobs.
 *
 * Encryption happens CLIENT-SIDE. This service is "blind":
 * it only sees encrypted bytes and root hashes.
 *
 * Falls back to local file storage when 0G Storage is not configured
 * (OG_STORAGE_INDEXER_RPC is empty). Local fallback is for development
 * only — not production-safe (no replication, no merkle proofs, no dedup).
 */

// ── 0G SDK setup ──

let indexer: InstanceType<typeof Indexer> | null = null;
let signer: ethers.Wallet | null = null;

function is0gConfigured(): boolean {
  return !!(config.ogStorageIndexerRpc && config.ogStoragePrivateKey);
}

function getIndexer(): InstanceType<typeof Indexer> {
  if (!indexer) {
    indexer = new Indexer(config.ogStorageIndexerRpc);
  }
  return indexer;
}

function getSigner(): ethers.Wallet {
  if (!signer) {
    const provider = new ethers.JsonRpcProvider(config.ogRpcUrl, config.ogChainId);
    signer = new ethers.Wallet(config.ogStoragePrivateKey, provider);
  }
  return signer;
}

// ── Local fallback ──

const LOCAL_DIR = resolve(process.cwd(), '.storage');

function ensureLocalDir() {
  if (!existsSync(LOCAL_DIR)) {
    mkdirSync(LOCAL_DIR, { recursive: true });
  }
}

/** Validate path stays inside LOCAL_DIR (prevent traversal) */
function safePath(rootHash: string): string | null {
  const target = resolve(LOCAL_DIR, rootHash);
  if (!target.startsWith(LOCAL_DIR + '/') && target !== LOCAL_DIR) {
    return null;
  }
  return target;
}

// ── Public API ──

/**
 * Upload an encrypted blob to 0G Storage (or local fallback).
 * Returns the root hash (sha256 for local, merkle root for 0G).
 */
export async function upload(data: Buffer): Promise<{ rootHash: string; txHash?: string }> {
  if (!is0gConfigured()) {
    return uploadLocal(data);
  }
  return upload0g(data);
}

/**
 * Download an encrypted blob by root hash.
 * Returns the raw encrypted bytes or null if not found.
 */
export async function download(rootHash: string): Promise<Buffer | null> {
  if (!is0gConfigured()) {
    return downloadLocal(rootHash);
  }
  return download0g(rootHash);
}

// ── 0G Storage implementation ──

async function upload0g(data: Buffer): Promise<{ rootHash: string; txHash?: string }> {
  const idx = getIndexer();
  const sgn = getSigner();

  const memData = new MemData(new Uint8Array(data));

  // Compute merkle tree to get root hash BEFORE upload
  const [tree, treeErr] = await memData.merkleTree();
  if (treeErr !== null || !tree) {
    console.error('0G merkle tree error:', treeErr);
    throw new Error('Storage upload failed: merkle tree computation error');
  }
  const rootHash = tree.rootHash() as string;

  // Upload to 0G Storage network
  // Cast signer to `any` — 0G SDK pins ethers 6.13.1 CJS types,
  // our project uses ethers 6.x ESM. Runtime is identical.
  const [tx, uploadErr] = await idx.upload(memData, config.ogRpcUrl, sgn as any);
  if (uploadErr !== null) {
    console.error('0G upload error:', uploadErr);
    throw new Error('Storage upload failed');
  }

  // Extract txHash from SDK response (shape varies by SDK version)
  let txHash: string | undefined;
  if (typeof tx === 'object' && tx !== null && 'txHash' in tx) {
    txHash = (tx as any).txHash;
  }

  return { rootHash, txHash };
}

async function download0g(rootHash: string): Promise<Buffer | null> {
  const idx = getIndexer();

  // SDK downloads to a file — use a temp file with random suffix to avoid races
  const rand = randomBytes(8).toString('hex');
  const tmpPath = join(tmpdir(), `0g-${rootHash}-${rand}`);

  try {
    const err = await idx.download(rootHash, tmpPath, true);
    if (err !== null) {
      console.error(`0G download error for ${rootHash}:`, err);
      return null;
    }
    return readFileSync(tmpPath);
  } catch (e) {
    console.error(`0G download exception for ${rootHash}:`, e);
    return null;
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
  }
}

// ── Local fallback implementation (development only) ──

async function uploadLocal(data: Buffer): Promise<{ rootHash: string }> {
  ensureLocalDir();
  const rootHash = createHash('sha256').update(data).digest('hex');
  const target = safePath(rootHash);
  if (!target) throw new Error('Invalid hash');
  writeFileSync(target, data);
  return { rootHash };
}

async function downloadLocal(rootHash: string): Promise<Buffer | null> {
  ensureLocalDir();
  const target = safePath(rootHash);
  if (!target) return null;
  if (!existsSync(target)) return null;
  return readFileSync(target);
}

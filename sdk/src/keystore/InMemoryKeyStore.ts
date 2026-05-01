import { aesDecrypt, aesEncrypt, generateAesKey, hkdfSha256 } from '../crypto/index.js';
import { CryptoError } from '../errors/index.js';
import type { Address, Hex, TaskId, TaskKey, TaskKeyRef } from '../types.js';
import type { KeyStore } from './KeyStore.js';

const EXPORT_FORMAT = 'blindmarket.keystore.v1';
const EXPORT_INFO = new TextEncoder().encode('BlindMarket-Keystore-Export-v1');

interface Entry {
  aesKey: Uint8Array;
  createdAt: number;
}

interface ExportShape {
  format: typeof EXPORT_FORMAT;
  salt: string;
  blob: string;
}

interface PlainExport {
  keys: Array<{ taskId: string; aesKey: string; createdAt: number }>;
  peers: Array<{ addr: Address; pubkey: Hex }>;
}

/**
 * Default KeyStore. Non-persistent — keys live only for the process lifetime.
 * Export/import is encrypted with a passphrase via HKDF-derived AES-256-GCM,
 * so exported blobs are safe to move between processes.
 */
export class InMemoryKeyStore implements KeyStore {
  private readonly keys = new Map<string, Entry>();
  private readonly peers = new Map<Address, Hex>();

  async putTaskKey(taskId: TaskId, key: TaskKey): Promise<void> {
    this.keys.set(taskId.toString(), {
      aesKey: copy(key.aesKey),
      createdAt: key.createdAt.getTime(),
    });
  }

  async getTaskKey(taskId: TaskId): Promise<TaskKey | null> {
    const e = this.keys.get(taskId.toString());
    if (!e) return null;
    return { aesKey: copy(e.aesKey), createdAt: new Date(e.createdAt) };
  }

  async putPeerPubKey(addr: Address, pubkey: Hex): Promise<void> {
    this.peers.set(addr, pubkey);
  }

  async getPeerPubKey(addr: Address): Promise<Hex | null> {
    return this.peers.get(addr) ?? null;
  }

  async list(): Promise<TaskKeyRef[]> {
    return Array.from(this.keys.entries()).map(([id, e]) => ({
      taskId: BigInt(id),
      createdAt: new Date(e.createdAt),
    }));
  }

  async delete(taskId: TaskId): Promise<void> {
    this.keys.delete(taskId.toString());
  }

  async export(passphrase: string): Promise<string> {
    if (!passphrase || passphrase.length < 8) {
      throw new CryptoError('CRYPTO/INVALID_KEY', 'passphrase must be ≥8 characters');
    }
    const salt = randomBytes(16);
    const wrapKey = await deriveWrapKey(passphrase, salt);
    const plain: PlainExport = {
      keys: Array.from(this.keys.entries()).map(([taskId, e]) => ({
        taskId,
        aesKey: bytesToHex(e.aesKey),
        createdAt: e.createdAt,
      })),
      peers: Array.from(this.peers.entries()).map(([addr, pubkey]) => ({ addr, pubkey })),
    };
    const blob = await aesEncrypt(new TextEncoder().encode(JSON.stringify(plain)), wrapKey);
    const out: ExportShape = { format: EXPORT_FORMAT, salt: bytesToHex(salt), blob: bytesToHex(blob) };
    return JSON.stringify(out);
  }

  async import(data: string, passphrase: string): Promise<void> {
    let parsed: ExportShape;
    try {
      parsed = JSON.parse(data) as ExportShape;
    } catch (cause) {
      throw new CryptoError('CRYPTO/INTEGRITY_CHECK', 'keystore export is not valid JSON', { cause });
    }
    if (parsed.format !== EXPORT_FORMAT) {
      throw new CryptoError(
        'CRYPTO/UNSUPPORTED_CIPHER',
        `unknown keystore export format: ${parsed.format ?? '(missing)'}`,
      );
    }
    const salt = hexToBytes(parsed.salt);
    const wrapKey = await deriveWrapKey(passphrase, salt);
    const blob = hexToBytes(parsed.blob);
    const plainBytes = await aesDecrypt(blob, wrapKey);
    const plain = JSON.parse(new TextDecoder().decode(plainBytes)) as PlainExport;
    this.keys.clear();
    this.peers.clear();
    for (const k of plain.keys) {
      this.keys.set(k.taskId, { aesKey: hexToBytes(k.aesKey), createdAt: k.createdAt });
    }
    for (const p of plain.peers) {
      this.peers.set(p.addr, p.pubkey);
    }
  }
}

function copy(u: Uint8Array): Uint8Array {
  const c = new Uint8Array(u.byteLength);
  c.set(u);
  return c;
}

function randomBytes(n: number): Uint8Array {
  const c = (globalThis as { crypto: Crypto }).crypto;
  const out = new Uint8Array(n);
  c.getRandomValues(out);
  return out;
}

async function deriveWrapKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const ikm = new TextEncoder().encode(passphrase);
  return hkdfSha256(ikm, 32, EXPORT_INFO, salt);
}

function bytesToHex(u: Uint8Array): string {
  return Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Tree-shakable helper kept here so we don't accidentally ship generateAesKey
// from this module — it's re-exported from crypto only.
export { generateAesKey };

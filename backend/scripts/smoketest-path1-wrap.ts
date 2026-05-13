/**
 * Path 1 smoke battery — just-in-time wrap flow.
 *
 * Exercises the new /bid, /bids, /wrap-to endpoints and the NEEDS_WRAP gate
 * on /accept, end-to-end against a running backend + Redis. Deliberately
 * offline w.r.t. the chain: POST /tasks builds an unsigned tx (no broadcast),
 * sets a2a:meta in Redis, and the script discards the tx. The new code paths
 * are all off-chain (Redis + HTTP), so on-chain settlement is out of scope
 * here — that's already covered by smoketest-a2a-extensive.ts.
 *
 * Scenarios (each is a pass/fail row):
 *
 *   pre-wrap baseline       — task created WITH wrap to executor → /accept
 *                             goes through directly (no NEEDS_WRAP). Sanity
 *                             check that the pre-existing happy path still
 *                             works.
 *   needs-wrap gate         — executor /accept on rootHash-but-no-wrap task →
 *                             403 NEEDS_WRAP.
 *   bid happy               — executor /bid → 200; re-bid idempotent.
 *   bid cap mismatch        — executor with non-matching caps /bid → 403
 *                             CAPABILITY_MISMATCH.
 *   bid no pubkey           — executor registered without publicKey /bid →
 *                             400 NO_PUBKEY.
 *   bid already wrapped     — executor /bid on task they're already wrapped
 *                             into → status='already_wrapped'.
 *   bids list — poster      — poster GET /bids → sees bidders + wrapped[].
 *   bids list — non-poster  — non-poster GET /bids → 403 NOT_POSTER.
 *   wrap-to — happy         — poster posts ECIES blob → meta.wrappedKeys
 *                             grows; subsequent /accept by bidder returns
 *                             the wrapped slice.
 *   wrap-to — non-poster    — non-poster /wrap-to → 403 NOT_POSTER.
 *   wrap-to — bad hex       — value with 0x prefix → 400 zod.
 *   wrap-to — too many      — 51 entries → 400 zod.
 *   ECIES round-trip        — real AES key, real ECIES wrap browser-side,
 *                             /wrap-to it, /accept returns the slice,
 *                             ECIES-decrypt → matches original key bytes.
 *
 * Run:
 *   cd backend
 *   npx tsx scripts/smoketest-path1-wrap.ts
 *
 * Pre-reqs:
 *   - Backend running on $BACKEND_URL (default http://localhost:3001)
 *   - JWT_SECRET set in backend/.env (or POSTER_PRIVATE_KEY in contracts/.env
 *     for env-loading parity with the other smoke scripts).
 */

import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import {
  Wallet,
  randomBytes,
  hexlify,
  SigningKey,
  getBytes,
} from 'ethers';
import { hkdfSync, randomBytes as nodeRandomBytes, createCipheriv, createDecipheriv } from 'crypto';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Color logging ────────────────────────────────────────────────────────────

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

interface Result {
  name: string;
  ok: boolean;
  detail?: string;
}
const results: Result[] = [];

function pass(name: string, detail?: string) {
  console.log(`  ${c.green('✓')} ${name}${detail ? c.dim(' · ' + detail) : ''}`);
  results.push({ name, ok: true, detail });
}
function failR(name: string, detail: string) {
  console.log(`  ${c.red('✗')} ${name} ${c.dim('· ' + detail)}`);
  results.push({ name, ok: false, detail });
}

// ── Env ──────────────────────────────────────────────────────────────────────

const backendEnvPath = resolve(__dirname, '../.env');
const contractsEnvPath = resolve(__dirname, '../../contracts/.env');
if (existsSync(contractsEnvPath)) dotenvConfig({ path: contractsEnvPath, override: false });
if (existsSync(backendEnvPath)) dotenvConfig({ path: backendEnvPath, override: false });

const JWT_SECRET = process.env.JWT_SECRET;
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

if (!JWT_SECRET) {
  console.error(c.red('JWT_SECRET missing — set it in backend/.env'));
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mintJWT(address: string): string {
  return jwt.sign(
    { address, ownerAddress: address, agentName: 'path1-smoke' },
    JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

async function http(
  method: 'GET' | 'POST',
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; ok: boolean; json: any; text: string }> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

// Uncompressed secp256k1 pubkey (130 hex chars starting with 04, no 0x).
function pubkeyHexFromWallet(w: Wallet): string {
  const sk = new SigningKey(w.privateKey);
  return sk.publicKey.slice(2); // strip 0x
}

// Browser-equivalent ECIES encrypt to a peer pubkey, matching frontend/src/lib/crypto.ts
// Output: [65 ephemeral uncompressed pub][12 IV][16 tag][ciphertext]
function eciesEncryptSync(plaintext: Uint8Array, recipientPubKeyHex: string): Uint8Array {
  if (!/^04[0-9a-fA-F]{128}$/.test(recipientPubKeyHex)) {
    throw new Error('eciesEncryptSync: pubkey must be uncompressed 04+128 hex');
  }
  // Ephemeral keypair
  const ephPriv = nodeRandomBytes(32);
  const ephSk = new SigningKey('0x' + ephPriv.toString('hex'));
  const ephPubFull = getBytes(ephSk.publicKey); // 65 bytes, 0x04 || X || Y

  // ECDH X-coordinate
  const sharedFull = getBytes(ephSk.computeSharedSecret('0x' + recipientPubKeyHex));
  if (sharedFull.length !== 65 || sharedFull[0] !== 0x04) {
    throw new Error(`ECDH shared shape wrong (len=${sharedFull.length})`);
  }
  const sharedX = sharedFull.subarray(1, 33);

  // HKDF-SHA256 with info='BlindMarket-ECIES-v1', salt=empty
  const aesKey = hkdfSync('sha256', sharedX, Buffer.alloc(0), Buffer.from('BlindMarket-ECIES-v1'), 32);

  // AES-256-GCM
  const iv = nodeRandomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(aesKey), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Assemble [eph65][iv12][tag16][ct]
  const out = new Uint8Array(65 + 12 + 16 + ct.length);
  out.set(ephPubFull, 0);
  out.set(iv, 65);
  out.set(tag, 77);
  out.set(ct, 93);
  return out;
}

function eciesDecryptSync(blob: Uint8Array, recipientPrivKeyHex: string): Uint8Array {
  if (blob.length < 65 + 12 + 16) throw new Error('ECIES blob too short');
  const ephPubFull = blob.subarray(0, 65);
  const iv = blob.subarray(65, 77);
  const tag = blob.subarray(77, 93);
  const ct = blob.subarray(93);
  const sk = new SigningKey(recipientPrivKeyHex);
  const sharedFull = getBytes(sk.computeSharedSecret('0x' + Buffer.from(ephPubFull).toString('hex')));
  const sharedX = sharedFull.subarray(1, 33);
  const aesKey = hkdfSync('sha256', sharedX, Buffer.alloc(0), Buffer.from('BlindMarket-ECIES-v1'), 32);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(aesKey), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(Buffer.from(ct)), decipher.final()]);
  return new Uint8Array(pt);
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
}

// ── Per-test fixtures ────────────────────────────────────────────────────────

interface Actors {
  poster: Wallet;
  posterJWT: string;
  executor: Wallet;
  executorJWT: string;
  executorPubKey: string;
  /** Second executor used for non-poster / cap-mismatch scenarios. */
  rando: Wallet;
  randoJWT: string;
  randoPubKey: string;
}

function mkActors(): Actors {
  const poster = Wallet.createRandom();
  const executor = Wallet.createRandom();
  const rando = Wallet.createRandom();
  return {
    poster,
    posterJWT: mintJWT(poster.address),
    executor,
    executorJWT: mintJWT(executor.address),
    executorPubKey: pubkeyHexFromWallet(executor),
    rando,
    randoJWT: mintJWT(rando.address),
    randoPubKey: pubkeyHexFromWallet(rando),
  };
}

/**
 * Create an A2A task off-chain by POSTing /api/v1/tasks. Returns the taskHash
 * the rest of the test can address. The unsigned tx is discarded — we only
 * care about the Redis meta side-effect.
 */
async function createA2ATask(opts: {
  posterJWT: string;
  requiredCapabilities: string[];
  rootHash?: string;
  wrappedKeys?: Record<string, string>;
}): Promise<string> {
  const taskHash = hexlify(randomBytes(32));
  // Bogus token + amount — backend builds an unsigned tx and stores meta,
  // it doesn't validate against chain state here.
  const r = await http('POST', '/api/v1/tasks', opts.posterJWT, {
    taskHash,
    token: '0x' + '00'.repeat(19) + '01',
    amount: '1000000',
    category: 'path1-smoke',
    locationZone: 'global',
    duration: '3600',
    targetExecutorType: 'agent',
    verificationMode: 'auto',
    verificationCriteria: { min_length: 10 },
    requiredCapabilities: opts.requiredCapabilities,
    ...(opts.rootHash ? { rootHash: opts.rootHash } : {}),
    ...(opts.wrappedKeys ? { wrappedKeys: opts.wrappedKeys } : {}),
  });
  if (!r.ok) throw new Error(`POST /tasks ${r.status}: ${r.text.slice(0, 200)}`);
  return taskHash;
}

async function registerExecutor(
  jwt: string,
  caps: string[],
  pubkey?: string,
): Promise<void> {
  const r = await http('POST', '/api/v1/a2a/register', jwt, {
    displayName: 'path1-smoke-exec',
    capabilities: caps,
    ...(pubkey ? { publicKey: pubkey } : {}),
  });
  if (!r.ok) throw new Error(`/register ${r.status}: ${r.text.slice(0, 200)}`);
}

// ── Scenarios ────────────────────────────────────────────────────────────────

async function scenarioPreWrapBaseline() {
  const name = 'pre-wrap baseline';
  try {
    const a = mkActors();
    await registerExecutor(a.executorJWT, ['data_processing'], a.executorPubKey);

    // Pre-wrap the AES key at task creation. Use a real-shaped (but random)
    // hex blob so the /accept response carries it back.
    const fakeWrapped = bytesToHex(nodeRandomBytes(120));
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['data_processing'],
      rootHash: hexlify(randomBytes(32)),
      wrappedKeys: { [a.executor.address]: fakeWrapped },
    });

    const accept = await http('POST', `/api/v1/a2a/tasks/${taskHash}/accept`, a.executorJWT);
    if (!accept.ok) return failR(name, `accept ${accept.status}: ${accept.text.slice(0, 120)}`);
    if (accept.json?.data?.wrappedKey !== fakeWrapped) return failR(name, 'wrappedKey mismatch');
    pass(name, `wrappedKey returned (${(accept.json.data.wrappedKey as string).length} hex chars)`);
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

async function scenarioNeedsWrapGate() {
  const name = 'needs-wrap gate';
  try {
    const a = mkActors();
    await registerExecutor(a.executorJWT, ['data_processing'], a.executorPubKey);
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['data_processing'],
      rootHash: hexlify(randomBytes(32)),
      // intentionally NO wrappedKeys
    });
    const accept = await http('POST', `/api/v1/a2a/tasks/${taskHash}/accept`, a.executorJWT);
    if (accept.status !== 403 || accept.json?.error?.code !== 'NEEDS_WRAP') {
      return failR(name, `expected 403 NEEDS_WRAP, got ${accept.status} ${accept.json?.error?.code}`);
    }
    pass(name);
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

async function scenarioBidHappy() {
  const name = 'bid happy + idempotent';
  try {
    const a = mkActors();
    await registerExecutor(a.executorJWT, ['data_processing'], a.executorPubKey);
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['data_processing'],
      rootHash: hexlify(randomBytes(32)),
    });
    const bid1 = await http('POST', `/api/v1/a2a/tasks/${taskHash}/bid`, a.executorJWT);
    if (!bid1.ok) return failR(name, `bid1 ${bid1.status}: ${bid1.text.slice(0, 120)}`);
    if (bid1.json?.data?.status !== 'bid_received') return failR(name, `bid1 status=${bid1.json?.data?.status}`);

    const bid2 = await http('POST', `/api/v1/a2a/tasks/${taskHash}/bid`, a.executorJWT);
    if (!bid2.ok) return failR(name, `bid2 ${bid2.status}`);
    if (bid2.json?.data?.status !== 'bid_received') return failR(name, `bid2 (re-bid) status=${bid2.json?.data?.status}`);
    pass(name, 're-bid stayed bid_received');
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

async function scenarioBidCapMismatch() {
  const name = 'bid cap mismatch';
  try {
    const a = mkActors();
    await registerExecutor(a.executorJWT, ['data_processing'], a.executorPubKey);
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['code_execution'],
      rootHash: hexlify(randomBytes(32)),
    });
    const bid = await http('POST', `/api/v1/a2a/tasks/${taskHash}/bid`, a.executorJWT);
    if (bid.status !== 403 || bid.json?.error?.code !== 'CAPABILITY_MISMATCH') {
      return failR(name, `expected 403 CAPABILITY_MISMATCH, got ${bid.status} ${bid.json?.error?.code}`);
    }
    pass(name);
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

async function scenarioBidNoPubKey() {
  const name = 'bid without pubkey';
  try {
    const a = mkActors();
    // Register WITHOUT publicKey — back-compat path the worker schema allows.
    await registerExecutor(a.executorJWT, ['data_processing']);
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['data_processing'],
      rootHash: hexlify(randomBytes(32)),
    });
    const bid = await http('POST', `/api/v1/a2a/tasks/${taskHash}/bid`, a.executorJWT);
    if (bid.status !== 400 || bid.json?.error?.code !== 'NO_PUBKEY') {
      return failR(name, `expected 400 NO_PUBKEY, got ${bid.status} ${bid.json?.error?.code}`);
    }
    pass(name);
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

async function scenarioBidAlreadyWrapped() {
  const name = 'bid already wrapped';
  try {
    const a = mkActors();
    await registerExecutor(a.executorJWT, ['data_processing'], a.executorPubKey);
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['data_processing'],
      rootHash: hexlify(randomBytes(32)),
      wrappedKeys: { [a.executor.address]: bytesToHex(nodeRandomBytes(96)) },
    });
    const bid = await http('POST', `/api/v1/a2a/tasks/${taskHash}/bid`, a.executorJWT);
    if (!bid.ok) return failR(name, `bid ${bid.status}`);
    if (bid.json?.data?.status !== 'already_wrapped') {
      return failR(name, `expected already_wrapped, got ${bid.json?.data?.status}`);
    }
    pass(name);
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

async function scenarioBidsListAuthz() {
  const name = 'bids list — poster sees / non-poster blocked';
  try {
    const a = mkActors();
    await registerExecutor(a.executorJWT, ['data_processing'], a.executorPubKey);
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['data_processing'],
      rootHash: hexlify(randomBytes(32)),
    });
    await http('POST', `/api/v1/a2a/tasks/${taskHash}/bid`, a.executorJWT);

    const asPoster = await http('GET', `/api/v1/a2a/tasks/${taskHash}/bids`, a.posterJWT);
    if (!asPoster.ok) return failR(name, `poster GET ${asPoster.status}`);
    const bids = asPoster.json?.data?.bids;
    if (!Array.isArray(bids) || bids.length !== 1) {
      return failR(name, `expected 1 bid, got ${bids?.length}`);
    }
    if (bids[0].address.toLowerCase() !== a.executor.address.toLowerCase()) {
      return failR(name, `bid address mismatch (${bids[0].address})`);
    }
    if (bids[0].publicKey !== a.executorPubKey) {
      return failR(name, `bid pubkey mismatch`);
    }

    const asRando = await http('GET', `/api/v1/a2a/tasks/${taskHash}/bids`, a.randoJWT);
    if (asRando.status !== 403 || asRando.json?.error?.code !== 'NOT_POSTER') {
      return failR(name, `rando GET expected 403 NOT_POSTER, got ${asRando.status} ${asRando.json?.error?.code}`);
    }
    pass(name, `bid#1 pubkey=${a.executorPubKey.slice(0, 10)}…`);
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

async function scenarioWrapToHappy() {
  const name = 'wrap-to happy path → accept clears';
  try {
    const a = mkActors();
    await registerExecutor(a.executorJWT, ['data_processing'], a.executorPubKey);
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['data_processing'],
      rootHash: hexlify(randomBytes(32)),
    });

    // 1. Executor /bid
    await http('POST', `/api/v1/a2a/tasks/${taskHash}/bid`, a.executorJWT);

    // 2. Poster wraps to executor's pubkey
    const wrappedBlob = bytesToHex(nodeRandomBytes(120));
    const wrap = await http('POST', `/api/v1/a2a/tasks/${taskHash}/wrap-to`, a.posterJWT, {
      wrappedKeys: { [a.executor.address]: wrappedBlob },
    });
    if (!wrap.ok) return failR(name, `wrap-to ${wrap.status}: ${wrap.text.slice(0, 120)}`);
    if (wrap.json?.data?.totalWrapped !== 1 || wrap.json?.data?.added !== 1) {
      return failR(name, `wrap-to body wrong: ${JSON.stringify(wrap.json?.data)}`);
    }

    // 3. /bids should now report the executor in wrapped[]
    const bids = await http('GET', `/api/v1/a2a/tasks/${taskHash}/bids`, a.posterJWT);
    const wrapped = bids.json?.data?.wrapped ?? [];
    if (!wrapped.map((s: string) => s.toLowerCase()).includes(a.executor.address.toLowerCase())) {
      return failR(name, `executor not in wrapped[] after wrap-to`);
    }

    // 4. /accept now succeeds, returns the wrapped slice
    const accept = await http('POST', `/api/v1/a2a/tasks/${taskHash}/accept`, a.executorJWT);
    if (!accept.ok) return failR(name, `accept ${accept.status}: ${accept.text.slice(0, 120)}`);
    if (accept.json?.data?.wrappedKey !== wrappedBlob) {
      return failR(name, `wrappedKey returned doesn't match wrap-to input`);
    }
    pass(name);
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

async function scenarioWrapToNonPoster() {
  const name = 'wrap-to — non-poster blocked';
  try {
    const a = mkActors();
    await registerExecutor(a.executorJWT, ['data_processing'], a.executorPubKey);
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['data_processing'],
      rootHash: hexlify(randomBytes(32)),
    });
    const wrap = await http('POST', `/api/v1/a2a/tasks/${taskHash}/wrap-to`, a.randoJWT, {
      wrappedKeys: { [a.executor.address]: bytesToHex(nodeRandomBytes(96)) },
    });
    if (wrap.status !== 403 || wrap.json?.error?.code !== 'NOT_POSTER') {
      return failR(name, `expected 403 NOT_POSTER, got ${wrap.status} ${wrap.json?.error?.code}`);
    }
    pass(name);
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

async function scenarioWrapToBadHex() {
  const name = 'wrap-to — invalid hex rejected';
  try {
    const a = mkActors();
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['data_processing'],
      rootHash: hexlify(randomBytes(32)),
    });
    const wrap = await http('POST', `/api/v1/a2a/tasks/${taskHash}/wrap-to`, a.posterJWT, {
      wrappedKeys: { [a.executor.address]: '0x' + bytesToHex(nodeRandomBytes(96)) }, // 0x prefix not allowed
    });
    if (wrap.status !== 400) return failR(name, `expected 400, got ${wrap.status}`);
    pass(name);
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

async function scenarioWrapToTooMany() {
  const name = 'wrap-to — >50 entries rejected';
  try {
    const a = mkActors();
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['data_processing'],
      rootHash: hexlify(randomBytes(32)),
    });
    const wrappedKeys: Record<string, string> = {};
    for (let i = 0; i < 51; i++) {
      const w = Wallet.createRandom();
      wrappedKeys[w.address] = bytesToHex(nodeRandomBytes(96));
    }
    const wrap = await http('POST', `/api/v1/a2a/tasks/${taskHash}/wrap-to`, a.posterJWT, { wrappedKeys });
    if (wrap.status !== 400) return failR(name, `expected 400, got ${wrap.status}`);
    pass(name);
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

async function scenarioEciesRoundTrip() {
  const name = 'ECIES round-trip — wrap-to → accept → decrypt';
  try {
    const a = mkActors();
    await registerExecutor(a.executorJWT, ['data_processing'], a.executorPubKey);
    const taskHash = await createA2ATask({
      posterJWT: a.posterJWT,
      requiredCapabilities: ['data_processing'],
      rootHash: hexlify(randomBytes(32)),
    });
    await http('POST', `/api/v1/a2a/tasks/${taskHash}/bid`, a.executorJWT);

    // Generate a real 32-byte AES key, ECIES-wrap to executor's pubkey
    const aesKey = nodeRandomBytes(32);
    const wrappedBytes = eciesEncryptSync(new Uint8Array(aesKey), a.executorPubKey);
    const wrappedHex = bytesToHex(wrappedBytes);

    const wrap = await http('POST', `/api/v1/a2a/tasks/${taskHash}/wrap-to`, a.posterJWT, {
      wrappedKeys: { [a.executor.address]: wrappedHex },
    });
    if (!wrap.ok) return failR(name, `wrap-to ${wrap.status}: ${wrap.text.slice(0, 120)}`);

    const accept = await http('POST', `/api/v1/a2a/tasks/${taskHash}/accept`, a.executorJWT);
    if (!accept.ok) return failR(name, `accept ${accept.status}`);
    const blobHex = accept.json?.data?.wrappedKey;
    if (typeof blobHex !== 'string') return failR(name, 'no wrappedKey in /accept response');

    // Decrypt with executor's private key
    const blob = new Uint8Array(blobHex.length / 2);
    for (let i = 0; i < blob.length; i++) blob[i] = parseInt(blobHex.slice(i * 2, i * 2 + 2), 16);
    const recovered = eciesDecryptSync(blob, a.executor.privateKey);
    if (recovered.length !== 32) return failR(name, `recovered len=${recovered.length}, expected 32`);
    if (Buffer.compare(Buffer.from(recovered), Buffer.from(aesKey)) !== 0) {
      return failR(name, 'AES key mismatch after round-trip');
    }
    pass(name, 'AES key byte-equal after wrap → accept → decrypt');
  } catch (e) {
    failR(name, (e as Error).message);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(c.bold('\n═══ Path 1 just-in-time wrap smoke battery ═══\n'));
  console.log(`  Backend: ${BACKEND_URL}\n`);

  // Pre-flight
  try {
    const h = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!h.ok) throw new Error(`/health ${h.status}`);
  } catch (e) {
    console.error(c.red(`backend not reachable: ${(e as Error).message}`));
    process.exit(1);
  }

  await scenarioPreWrapBaseline();
  await scenarioNeedsWrapGate();
  await scenarioBidHappy();
  await scenarioBidCapMismatch();
  await scenarioBidNoPubKey();
  await scenarioBidAlreadyWrapped();
  await scenarioBidsListAuthz();
  await scenarioWrapToHappy();
  await scenarioWrapToNonPoster();
  await scenarioWrapToBadHex();
  await scenarioWrapToTooMany();
  await scenarioEciesRoundTrip();

  console.log('');
  console.log(c.bold('═══ Summary ═══'));
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  for (const r of results) {
    console.log(`  ${r.ok ? c.green('PASS') : c.red('FAIL')}  ${r.name}${r.detail && !r.ok ? c.dim(' — ' + r.detail) : ''}`);
  }
  console.log('');
  console.log(passed === total
    ? c.green(c.bold(`  ${passed}/${total} PASSED · battery green`))
    : c.red(c.bold(`  ${passed}/${total} passed · battery has failures`)));
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => { console.error(c.red('[fatal]'), e); process.exit(1); });

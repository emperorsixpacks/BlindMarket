# BlindMarket SDK — Design

**Date:** 2026-04-18
**Status:** Approved (pre-implementation)
**Target package:** `@blindmarket/sdk`
**Scope:** Production-grade TypeScript SDK for the BlindMarket privacy-first task marketplace. Covers everything in today's codebase (contracts, backend API, 0G Storage, 0G Sealed Inference, encryption) plus reserved extension points for features not yet built (staking, a2a, custody, forensics, accounting).

---

## 1. Goals & non-goals

### Goals

1. **One idiomatic TypeScript entry point** for every consumer class (AI agents, workers, verifiers, third-party integrators).
2. **Battle-tested**: fuzzed crypto, simulated failure modes (reorgs, indexer outages, broker exhaustion), multi-runtime matrix (Node 18/20/22, Bun, Deno, Chrome/Firefox/Safari).
3. **Isomorphic**: same codebase works server-side and in the browser.
4. **Decentralized by default**: SDK can operate without the BlindMarket backend (chain + 0G Storage + compute broker only); backend is an optional convenience.
5. **Future-proof**: plugins, adapters, and reserved namespaces let us add features without breaking consumers.

### Non-goals (v0)

- Python SDK — mirror after TS is stable.
- Mobile-native SDKs (iOS/Android) — React Native via the browser package for now.
- CLI tooling — ships separately if needed.
- Monorepo split — single package with subpath exports until consumers demand slices.

---

## 2. Package layout & distribution

### Single package, subpath exports

Ship as `@blindmarket/sdk` (npm). Multiple entry points declared in `package.json#exports`:

```
@blindmarket/sdk
├── /              → high-level BlindMarket class (batteries-included)
├── /agent         → Agent role
├── /worker        → Worker role
├── /verifier      → Verifier role
├── /chain         → typed contract clients (BlindEscrow, TaskRegistry, BlindReputation) + ABIs
├── /storage       → 0G Storage wrapper
├── /compute       → 0G Sealed Inference wrapper
├── /crypto        → ECIES, AES-256-GCM, SHA-256, key derivation (isomorphic)
├── /api           → REST client for BlindMarket backend
├── /signer        → Signer adapters
├── /keystore      → KeyStore interface + adapters
├── /events        → typed event bus
├── /errors        → typed error hierarchy
├── /network       → network presets + RPC pool
└── /testing       → mocks, fixtures, in-memory chain/storage/broker
```

### Why single package first, monorepo later

A monorepo split (`@blindmarket/crypto`, `@blindmarket/chain`, …) pays off when (a) consumers want only a slice or (b) internal teams ship on different cadences. Neither is true today. A single package with subpath exports gives ~90% of the same ergonomics at ~20% of the tooling cost.

**Migration path to monorepo** (execute when first consumer asks for a slice):
1. `git mv src/<area>/ packages/<area>/src/` per subpath.
2. Add `packages/*/package.json` with identical public names (`@blindmarket/crypto`, etc.).
3. Configure pnpm workspaces + Turborepo.
4. `@blindmarket/sdk` becomes an umbrella that re-exports from the sibling packages.
5. Consumer import paths stay identical (`@blindmarket/sdk/crypto` still works via re-export).

### Build & tooling

| Concern | Tool |
|---|---|
| Bundle | `tsup` (dual ESM + CJS) |
| Types | `tsc` emits `.d.ts`, `@microsoft/api-extractor` for public-surface snapshots |
| Test | `vitest` (unit + integration), `fast-check` (property-based), `playwright` (browser) |
| Lint/format | `biome` |
| Release | `changesets` (version + changelog), `npm publish --provenance` with 2FA |
| Docs | `typedoc` → GitHub Pages |
| Runtime targets | Node ≥18, Bun, Deno, modern browsers (ESM), React Native (via browser build) |

`sideEffects: false` for tree-shaking. Strict TypeScript, no `any` in public API.

---

## 3. Public API shape (three layers)

### Layer 1 — Primitives (escape hatches, always present)

Low-level access to every boundary. Use when the role APIs don't fit.

```ts
import { Crypto, Chain, Storage, Compute, Api } from '@blindmarket/sdk'

await chain.escrow.createTask({ taskHash, token, amount, category, locationZone })
await storage.upload(bytes)           // → { rootHash, txHash }
await storage.download(rootHash)      // → bytes (merkle-verified)
await crypto.ecies.encrypt(pt, pub)   // → { ciphertext, ephemeralPub }
await crypto.ecies.decrypt(ct, priv)  // → plaintext
await compute.verify({ taskId, evidenceHash, prompt })
await api.tasks.list({ category, cursor })
```

### Layer 2 — Roles (opinionated flows)

One class per actor. Handles encryption + upload + chain + receipt in one call.

```ts
import { Agent, Worker, Verifier } from '@blindmarket/sdk'

const agent = new Agent({ network, signer, keystore })
const worker = new Worker({ network, signer, keystore })
```

### Layer 3 — Umbrella (batteries-included)

What most consumers use.

```ts
import { BlindMarket } from '@blindmarket/sdk'

const bb = new BlindMarket({
  network: 'testnet',                 // or 'mainnet' | CustomNetwork
  signer,                             // Signer adapter
  keystore,                           // defaults to InMemory
  api: { baseUrl, jwt? } | false,     // false = fully decentralized
  telemetry?, logger?, plugins?,
})

bb.agent; bb.worker; bb.verifier      // role APIs
bb.chain; bb.storage; bb.compute; bb.crypto; bb.api   // primitives
bb.events                             // lifecycle event bus
```

### Agent surface

```ts
const { taskId, taskKey, rootHash, txHash } = await bb.agent.createTask({
  instructions: 'Take 3 photos of the storefront at…',
  category: 'photography',
  locationZone: 'Lagos, NG',
  reward: { token: 'USDC', amount: 5_000000n },
  deadline: in24h,
  metadata?: Record<string, string>,
})

const apps = await bb.agent.listApplicants(taskId)
await bb.agent.assignWorker(taskId, apps[0].address)
const submission = await bb.agent.waitForSubmission(taskId, { timeout })
const plaintext  = await bb.agent.decryptEvidence(taskId)
const result     = await bb.agent.verify(taskId)
await bb.agent.rate(taskId, { score: 5 })
// or bb.agent.cancel(taskId) before assignment
```

### Worker surface

```ts
const tasks = await bb.worker.browse({ category, minReward, cursor, limit })
await bb.worker.apply(taskId)
const instructions = await bb.worker.getInstructions(taskId)          // decrypts
await bb.worker.submitEvidence(taskId, { evidence: bytes, filename? }) // encrypts+uploads+tx
await bb.worker.claim(taskId)                                          // after verified
```

### Verifier surface

```ts
const { passed, confidence, attestation, txHash } =
  await bb.verifier.runSealedInference(taskId, { model?, provider? })
const ok = await bb.verifier.validateAttestation(attestation)
```

### Event bus

```ts
bb.events.on('task.created',        ({ taskId, txHash }) => …)
bb.events.on('task.assigned',       ({ taskId, worker }) => …)
bb.events.on('evidence.submitted',  ({ taskId, rootHash }) => …)
bb.events.on('verification.done',   ({ taskId, passed, confidence }) => …)
bb.events.on('tx.sent' | 'tx.confirmed' | 'tx.failed', …)
```

### Principles

1. **Plaintext in, plaintext out.** Encryption/upload/hashing is never the caller's problem.
2. **One call, one intent.** Role methods do all orchestration and roll back on mid-flight failure.
3. **Decentralized by default.** `api: false` runs against chain + storage + broker only.
4. **Signer is injected, never owned.** SDK never reads `process.env.PRIVATE_KEY`.
5. **Typed everything.** Strict TypeScript, no `any` in public surface.

---

## 4. Signer & KeyStore abstractions

### Signer

Signs transactions, messages, and typed data. Single root of identity for on-chain auth AND content encryption (secp256k1 pubkey is ECIES-compatible).

```ts
interface Signer {
  getAddress(): Promise<Address>
  signTransaction(tx: TxRequest): Promise<string>
  signMessage(msg: string | Uint8Array): Promise<string>
  signTypedData(domain, types, value): Promise<string>
  getPublicKey(): Promise<Hex>          // recovered from a cached signature
  chainId(): Promise<bigint>
}
```

Adapters shipped in v0:

| Adapter | Use case |
|---|---|
| `EthersSigner(wallet)` | pass-through for any `ethers.Signer` |
| `PrivateKeySigner(pk)` | Node / headless agents / demos |
| `BrowserSigner(provider)` | MetaMask, Coinbase, embedded wallets (EIP-1193) |
| `ReadOnlySigner(address)` | public reads only; throws on writes |
| `KmsSigner` (abstract) | base class for AWS KMS / GCP KMS / Turnkey / etc. — concrete impls deferred |

### KeyStore

One place for all at-rest sensitive data. SDK never logs, never serializes to telemetry, never sends over the wire.

```ts
interface KeyStore {
  putTaskKey(taskId: bigint, key: TaskKey): Promise<void>
  getTaskKey(taskId: bigint): Promise<TaskKey | null>
  putPeerPubKey(addr: Address, pubkey: Hex): Promise<void>
  getPeerPubKey(addr: Address): Promise<Hex | null>
  list(): Promise<TaskKeyRef[]>
  delete(taskId: bigint): Promise<void>
  export(passphrase: string): Promise<string>    // portable encrypted JSON
  import(data: string, passphrase: string): Promise<void>
}
```

Adapters:

| Adapter | Encryption-at-rest |
|---|---|
| `InMemoryKeyStore` | none (ephemeral, non-persistent, default) |
| `FileKeyStore(path, passphrase)` | scrypt(N=2^17) → AES-256-GCM |
| `BrowserKeyStore(passphrase)` | IndexedDB + scrypt → AES-256-GCM; unlocks per session |
| `CustomKeyStore` | interface for Vault / KMS / 1Password CLI |

---

## 5. Error model

Every error extends a single base with a **stable string code** and a built-in retry flag.

```ts
class BlindMarketError extends Error {
  code: ErrorCode              // e.g. 'CRYPTO/DECRYPT_FAILED'
  retriable: boolean
  context?: Record<string, unknown>
  cause?: unknown
}
```

Subclasses (one per boundary):

| Class | Examples |
|---|---|
| `ConfigError` | `CONFIG/INVALID_NETWORK`, `CONFIG/MISSING_SIGNER` |
| `CryptoError` | `CRYPTO/INVALID_KEY`, `CRYPTO/DECRYPT_FAILED`, `CRYPTO/INTEGRITY_CHECK` |
| `StorageError` | `STORAGE/UPLOAD_FAILED`, `STORAGE/MERKLE_MISMATCH`, `STORAGE/NOT_FOUND`, `STORAGE/INDEXER_UNREACHABLE` (retriable) |
| `ChainError` | `CHAIN/TX_REVERTED(reason)`, `CHAIN/NONCE_CONFLICT`, `CHAIN/NETWORK_MISMATCH`, `CHAIN/INSUFFICIENT_BALANCE` |
| `ComputeError` | `COMPUTE/BROKER_UNREACHABLE`, `COMPUTE/LEDGER_INSUFFICIENT`, `COMPUTE/TEE_ATTESTATION_INVALID` |
| `ApiError` | `API/AUTH_REQUIRED`, `API/RATE_LIMITED`, `API/VALIDATION`, `API/SERVER`, `API/NOT_FOUND` |
| `LifecycleError` | `LIFECYCLE/ILLEGAL_TRANSITION`, `LIFECYCLE/NOT_ASSIGNED`, `LIFECYCLE/ALREADY_SUBMITTED` |
| `TimeoutError` | `TIMEOUT` |

**Codes are strings** so they're stable across minor versions, grep-able, and localizable.

**Automatic retry policy:** configurable per-category. Defaults: 3 tries, 200ms base, ×2 with jitter, retriable codes only. Opt out with `retry: false`.

---

## 6. Testing & release strategy

### Test pyramid

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| Unit | `vitest` | every module | every PR |
| Property-based | `fast-check` | crypto roundtrips, serializers | every PR |
| Integration | `vitest` + `hardhat` local node + mocked 0G Storage + mocked broker | full lifecycle in-process | every PR |
| Contract | ABI diff vs `contracts/artifacts/` | detect drift | every PR |
| Browser | `playwright` | WebCrypto path, EIP-1193 signer | every PR |
| E2E | real 0G testnet, funded wallet | full lifecycle | manual / release tag |

**Coverage target:** ≥90% lines, 100% on crypto + error paths.

### Battle-testing checklist

1. ECIES + AES-GCM encoders fuzzed with 10k random inputs per CI run.
2. Chain reorg simulation: rewind hardhat state mid-test, SDK must recover.
3. Indexer outage simulation: mocked indexer returns 503 on 20% of requests; SDK retries transparently.
4. Broker ledger exhaustion: `COMPUTE/LEDGER_INSUFFICIENT` surfaces cleanly.
5. Runtime matrix: Node 18/20/22, Bun, Deno, Chrome, Firefox, Safari.
6. Public surface snapshots via `api-extractor` — changes require explicit acknowledgment.
7. No `any` in public types, strict mode on.

### Release

- `changesets` for versioning + changelog.
- Dual ESM + CJS via `tsup`; `.d.ts` via `tsc`; `sideEffects: false`.
- Docs site via `typedoc` → GitHub Pages.
- **0.x while unstable** (hackathon + first 3 months post-mainnet).
- **1.0 when contracts + API surface are frozen.**
- Each SDK version pins known-good contract addresses per network.
- `npm publish --provenance` + 2FA.

---

## 7. Future-proofing

Three extension mechanisms. All pluggable, none required.

### 7.1 Plugins (middleware around every boundary)

```ts
interface Plugin {
  name: string
  onTx?: (tx: TxRequest, next: Next) => Promise<TxResponse>
  onUpload?: (bytes: Uint8Array, next: Next) => Promise<UploadResult>
  onDownload?: (hash: Hex, next: Next) => Promise<Uint8Array>
  onApi?: (req: ApiRequest, next: Next) => Promise<ApiResponse>
  onEvent?: (event: SdkEvent) => void
  onError?: (err: BlindMarketError) => void
  install?: (sdk: BlindMarket) => void
}

new BlindMarket({ plugins: [logger(pino), retry({...}), cache({...}), telemetry(otel), policyGuard(rules)] })
```

Deterministic order: first registered = outermost.

### 7.2 Adapters (swap implementations)

| Adapter | Default impl | Alt impls |
|---|---|---|
| `SignerAdapter` | — | Ethers, Browser, PrivateKey, ReadOnly |
| `StorageAdapter` | 0G Storage | Memory (tests), S3-compatible (escape hatch) |
| `ComputeAdapter` | 0G Sealed Inference | Mock (tests), Custom-TEE (stub) |
| `KeyStoreAdapter` | InMemory | File, Browser |
| `TelemetryAdapter` | Console | Pino, OTEL stub |
| `RpcAdapter` | ethers default | HttpPool (failover across RPC endpoints) |

Swapping an adapter requires zero changes to high-level code.

### 7.3 Namespace reservations for not-yet-built features

Backend already has routes that aren't on-chain yet: `staking`, `a2a`, `a2aProtocol`, `custody`, `forensics`, `accounting`. The SDK reserves namespaces now:

```ts
bb.api.staking.*       // stake, unstake, slashing
bb.api.a2a.*           // agent-to-agent protocol
bb.api.custody.*       // key custody flows
bb.api.forensics.*     // evidence forensics + disputes
bb.api.accounting.*    // revenue splits + treasury
```

When any of these graduate to smart contracts, the on-chain methods move up to `bb.chain.staking.*`, etc. REST-client fallbacks stay for backwards compatibility. Consumers write against the namespace from day one; the SDK upgrades transparently.

### 7.4 Network-config versioning

```ts
networks: {
  'testnet': {
    chainId: 16601n,
    rpc: [ 'https://…' ],
    contracts: { escrow, registry, reputation, usdc },
    indexer: '…',
    broker: '…',
  },
  'mainnet': { /* reserved slot */ },
}
```

Baked into each SDK version. `CustomNetwork` for forks/local. Consumers never paste addresses.

---

## 8. Recap

- **1 package** (`@blindmarket/sdk`) with subpath exports; migrate to monorepo when a consumer asks.
- **3 layers**: primitives → roles → umbrella.
- **Signer + KeyStore** separate, pluggable, encrypted-at-rest.
- **Typed error hierarchy** with stable string codes and built-in retry.
- **Battle-tested** = unit + property + integration + contract + browser + E2E across Node 18/20/22, Bun, Deno, 3 browsers.
- **Isomorphic**, **tree-shakable**, **ESM+CJS**, **strict TS**.
- **Plugins + adapters + reserved namespaces** for staking, a2a, custody, forensics, accounting.
- Ships **pinned network configs** per SDK version.

---

## 9. Out of scope for this design

- Exact Solidity ABI lock-in (loaded from `contracts/artifacts/` at build time).
- Implementation order (deferred to `writing-plans` in the next step).
- Python SDK (post-TS stabilization).
- CLI tooling.
- React/Next/Vue framework bindings (can live in sibling packages later).

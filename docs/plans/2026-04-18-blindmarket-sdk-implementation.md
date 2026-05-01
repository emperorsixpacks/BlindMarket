# BlindMarket SDK Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `@blindmarket/sdk` — a production-grade, isomorphic, TDD-developed TypeScript SDK for the BlindMarket privacy-first task marketplace, covering the full 10-step lifecycle and reserved extension points for not-yet-built features.

**Architecture:** Single npm package with subpath exports. Three layers: primitives (`crypto`, `chain`, `storage`, `compute`, `api`), roles (`Agent`, `Worker`, `Verifier`), umbrella (`BlindMarket`). Isomorphic (Web Crypto on browser, Node crypto in Node) with byte-for-byte identical wire formats. Pluggable `Signer` and `KeyStore` abstractions. Typed error hierarchy with stable string codes.

**Tech Stack:** TypeScript 5.7 strict, `tsup` (dual ESM/CJS build), `vitest` (unit + integration), `fast-check` (property-based), `playwright` (browser), `ethers` v6, `@0gfoundation/0g-ts-sdk`, `@0glabs/0g-serving-broker`, `biome` (lint/format), `changesets` (release), `typedoc` (docs).

**Design reference:** `docs/plans/2026-04-18-blindmarket-sdk-design.md`.

**Wire-format compatibility (do not deviate):**
- AES blob: `[12 IV][16 tag][ciphertext]`
- ECIES blob: `[65 ephemeral pubkey][AES blob]`
- HKDF info: `'BlindMarket-ECIES-v1'`

**Deployed testnet (0G Galileo, chainId 16602):**
- `BlindEscrow` — `0xFd4F93F5A7BE144c405D1D8fbEC63Fb776207681`
- `TaskRegistry` — `0xeE52d780A47F77E8a4a1cEb236e3C65A48FbD828`
- `BlindReputation` — `0x4A6374Fae37E19E69ba43E7cf6994AC15F63256e`
- `MockERC20` (USDC substitute) — `0x317227efcA18D004E12CA8046AEf7E1597458F25`

**Work location:** `/Users/ram/Desktop/BlindMarket/sdk/`

**Commit discipline:** one commit per phase boundary (minimum). Conventional commits: `feat:`, `test:`, `fix:`, `docs:`, `chore:`. Co-Authored-By trailer on every SDK commit.

---

## Phase 0 — Scaffold

**Outcome:** `sdk/` directory is a buildable, testable, lintable TypeScript package with subpath exports declared.

### Task 0.1 — Initialize package.json

**Files:**
- Create: `sdk/package.json`

**Step 1:** Create `sdk/package.json` with these exact contents:

```json
{
  "name": "@blindmarket/sdk",
  "version": "0.1.0",
  "description": "TypeScript SDK for BlindMarket — privacy-first task marketplace on 0G.",
  "type": "module",
  "license": "MIT",
  "sideEffects": false,
  "files": ["dist", "README.md", "LICENSE"],
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":          { "types": "./dist/index.d.ts",          "import": "./dist/index.js",          "require": "./dist/index.cjs" },
    "./agent":    { "types": "./dist/agent/index.d.ts",    "import": "./dist/agent/index.js",    "require": "./dist/agent/index.cjs" },
    "./worker":   { "types": "./dist/worker/index.d.ts",   "import": "./dist/worker/index.js",   "require": "./dist/worker/index.cjs" },
    "./verifier": { "types": "./dist/verifier/index.d.ts", "import": "./dist/verifier/index.js", "require": "./dist/verifier/index.cjs" },
    "./chain":    { "types": "./dist/chain/index.d.ts",    "import": "./dist/chain/index.js",    "require": "./dist/chain/index.cjs" },
    "./storage":  { "types": "./dist/storage/index.d.ts",  "import": "./dist/storage/index.js",  "require": "./dist/storage/index.cjs" },
    "./compute":  { "types": "./dist/compute/index.d.ts",  "import": "./dist/compute/index.js",  "require": "./dist/compute/index.cjs" },
    "./crypto":   { "types": "./dist/crypto/index.d.ts",   "import": "./dist/crypto/index.js",   "require": "./dist/crypto/index.cjs" },
    "./api":      { "types": "./dist/api/index.d.ts",      "import": "./dist/api/index.js",      "require": "./dist/api/index.cjs" },
    "./signer":   { "types": "./dist/signer/index.d.ts",   "import": "./dist/signer/index.js",   "require": "./dist/signer/index.cjs" },
    "./keystore": { "types": "./dist/keystore/index.d.ts", "import": "./dist/keystore/index.js", "require": "./dist/keystore/index.cjs" },
    "./events":   { "types": "./dist/events/index.d.ts",   "import": "./dist/events/index.js",   "require": "./dist/events/index.cjs" },
    "./errors":   { "types": "./dist/errors/index.d.ts",   "import": "./dist/errors/index.js",   "require": "./dist/errors/index.cjs" },
    "./network":  { "types": "./dist/network/index.d.ts",  "import": "./dist/network/index.js",  "require": "./dist/network/index.cjs" },
    "./testing":  { "types": "./dist/testing/index.d.ts",  "import": "./dist/testing/index.js",  "require": "./dist/testing/index.cjs" }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src test",
    "format": "biome format --write src test",
    "docs": "typedoc"
  },
  "dependencies": {
    "@0gfoundation/0g-ts-sdk": "^1.2.1",
    "@0glabs/0g-serving-broker": "^0.7.5",
    "ethers": "^6.13.5"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/node": "^22.15.3",
    "@vitest/coverage-v8": "^2.1.9",
    "fast-check": "^3.23.2",
    "tsup": "^8.3.5",
    "typedoc": "^0.27.6",
    "typescript": "^5.7.3",
    "vitest": "^2.1.9"
  },
  "engines": { "node": ">=18.0.0" },
  "keywords": ["blindmarket", "0g", "sdk", "privacy", "ecies", "tee", "sealed-inference", "task-marketplace"],
  "repository": { "type": "git", "url": "https://github.com/JemIIahh/BlindMarket", "directory": "sdk" }
}
```

**Step 2:** Run from `sdk/`: `npm install`.
**Expected:** `node_modules/` populated, no errors.

**Step 3:** Commit.
```bash
cd /Users/ram/Desktop/BlindMarket
git add sdk/package.json sdk/package-lock.json
git commit -m "chore(sdk): initialize package.json with subpath exports"
```

---

### Task 0.2 — tsconfig

**Files:** Create `sdk/tsconfig.json`, `sdk/tsconfig.build.json`.

**Step 1:** `sdk/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 2:** `sdk/tsconfig.build.json`:

```json
{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": false }, "exclude": ["test/**/*", "node_modules", "dist"] }
```

**Step 3:** `cd sdk && npm run typecheck` — expect no files to compile yet (empty `src/`). Fine.

---

### Task 0.3 — tsup config (dual ESM+CJS build)

**Files:** Create `sdk/tsup.config.ts`.

**Step 1:**

```ts
import { defineConfig } from 'tsup';

const entries = [
  'src/index.ts',
  'src/agent/index.ts',
  'src/worker/index.ts',
  'src/verifier/index.ts',
  'src/chain/index.ts',
  'src/storage/index.ts',
  'src/compute/index.ts',
  'src/crypto/index.ts',
  'src/api/index.ts',
  'src/signer/index.ts',
  'src/keystore/index.ts',
  'src/events/index.ts',
  'src/errors/index.ts',
  'src/network/index.ts',
  'src/testing/index.ts',
];

export default defineConfig({
  entry: entries,
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'es2022',
  tsconfig: './tsconfig.build.json',
  outDir: 'dist',
});
```

---

### Task 0.4 — vitest config

**Files:** Create `sdk/vitest.config.ts`.

**Step 1:**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts', 'src/**/*.d.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
    testTimeout: 20_000,
  },
});
```

---

### Task 0.5 — Biome config

**Files:** Create `sdk/biome.json`.

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "error" },
      "style": { "useImportType": "error" }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120,
    "lineEnding": "lf"
  }
}
```

---

### Task 0.6 — Directory scaffolding

**Files:** Create empty `src/<subpath>/index.ts` for every subpath and one placeholder test.

**Step 1:** From `sdk/`:
```bash
mkdir -p src/{agent,worker,verifier,chain,storage,compute,crypto,api,signer,keystore,events,errors,network,testing} test
```

**Step 2:** For each subpath directory (`agent, worker, verifier, chain, storage, compute, crypto, api, signer, keystore, events, errors, network, testing`), create `src/<subpath>/index.ts` with exactly:

```ts
export {};
```

**Step 3:** Create `src/index.ts`:

```ts
// Umbrella entry. Filled in during Phase 14.
export {};
```

**Step 4:** Create `test/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('smoke', () => {
  it('vitest runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Step 5:** `cd sdk && npm test` — expect 1 test passing.

**Step 6:** `cd sdk && npm run build` — expect `dist/` populated, zero TypeScript errors.

**Step 7:** Commit.
```bash
git add sdk/
git commit -m "chore(sdk): scaffold build, test, lint tooling + subpath layout"
```

---

## Phase 1 — Error hierarchy

**Outcome:** `src/errors/` exports `BlindMarketError`, typed subclasses, and a frozen `ErrorCode` string enum. Tests verify code stability, `retriable` flag, and `cause` chaining.

### Task 1.1 — Write error hierarchy test

**Files:**
- Create: `test/errors.test.ts`

**Step 1:**

```ts
import { describe, expect, it } from 'vitest';
import {
  BlindMarketError,
  ConfigError,
  CryptoError,
  StorageError,
  ChainError,
  ComputeError,
  ApiError,
  LifecycleError,
  TimeoutError,
} from '../src/errors';

describe('BlindMarketError', () => {
  it('preserves code, message, retriable, context, cause', () => {
    const cause = new Error('root');
    const err = new StorageError('STORAGE/UPLOAD_FAILED', 'upload blew up', {
      retriable: true,
      context: { attempt: 1 },
      cause,
    });
    expect(err).toBeInstanceOf(BlindMarketError);
    expect(err.name).toBe('StorageError');
    expect(err.code).toBe('STORAGE/UPLOAD_FAILED');
    expect(err.message).toBe('upload blew up');
    expect(err.retriable).toBe(true);
    expect(err.context).toEqual({ attempt: 1 });
    expect(err.cause).toBe(cause);
  });

  it('defaults retriable to false', () => {
    const err = new ConfigError('CONFIG/MISSING_SIGNER', 'no signer');
    expect(err.retriable).toBe(false);
  });

  it('exposes a stable toJSON for telemetry (no secrets)', () => {
    const err = new ApiError('API/VALIDATION', 'bad input', { context: { field: 'reward' } });
    const j = err.toJSON();
    expect(j).toMatchObject({
      name: 'ApiError',
      code: 'API/VALIDATION',
      message: 'bad input',
      retriable: false,
      context: { field: 'reward' },
    });
    expect(j).not.toHaveProperty('cause');
  });

  it.each([
    [ConfigError,    'CONFIG/MISSING_SIGNER'],
    [CryptoError,    'CRYPTO/DECRYPT_FAILED'],
    [StorageError,   'STORAGE/NOT_FOUND'],
    [ChainError,     'CHAIN/TX_REVERTED'],
    [ComputeError,   'COMPUTE/BROKER_UNREACHABLE'],
    [ApiError,       'API/RATE_LIMITED'],
    [LifecycleError, 'LIFECYCLE/ILLEGAL_TRANSITION'],
    [TimeoutError,   'TIMEOUT'],
  ])('subclass %p accepts its canonical code', (Ctor, code) => {
    const err = new (Ctor as any)(code, 'msg');
    expect(err.code).toBe(code);
    expect(err).toBeInstanceOf(BlindMarketError);
  });
});
```

**Step 2:** Run: `cd sdk && npm test -- test/errors.test.ts`
**Expected:** all tests fail with import errors.

---

### Task 1.2 — Implement error hierarchy

**Files:**
- Create: `sdk/src/errors/codes.ts`
- Create: `sdk/src/errors/BlindMarketError.ts`
- Create: `sdk/src/errors/subclasses.ts`
- Overwrite: `sdk/src/errors/index.ts`

**Step 1:** `src/errors/codes.ts`:

```ts
export const ErrorCodes = {
  Config:    ['CONFIG/INVALID_NETWORK', 'CONFIG/MISSING_SIGNER', 'CONFIG/BAD_CONFIG'] as const,
  Crypto:    ['CRYPTO/INVALID_KEY', 'CRYPTO/DECRYPT_FAILED', 'CRYPTO/INTEGRITY_CHECK', 'CRYPTO/UNSUPPORTED_CIPHER'] as const,
  Storage:   ['STORAGE/UPLOAD_FAILED', 'STORAGE/DOWNLOAD_FAILED', 'STORAGE/MERKLE_MISMATCH', 'STORAGE/NOT_FOUND', 'STORAGE/INDEXER_UNREACHABLE'] as const,
  Chain:     ['CHAIN/TX_REVERTED', 'CHAIN/TX_TIMED_OUT', 'CHAIN/NONCE_CONFLICT', 'CHAIN/INSUFFICIENT_BALANCE', 'CHAIN/NETWORK_MISMATCH', 'CHAIN/CONTRACT_NOT_DEPLOYED'] as const,
  Compute:   ['COMPUTE/BROKER_UNREACHABLE', 'COMPUTE/NO_PROVIDERS', 'COMPUTE/LEDGER_INSUFFICIENT', 'COMPUTE/TEE_ATTESTATION_INVALID', 'COMPUTE/VERIFICATION_TIMEOUT'] as const,
  Api:       ['API/AUTH_REQUIRED', 'API/AUTH_EXPIRED', 'API/FORBIDDEN', 'API/RATE_LIMITED', 'API/VALIDATION', 'API/SERVER', 'API/NOT_FOUND'] as const,
  Lifecycle: ['LIFECYCLE/ILLEGAL_TRANSITION', 'LIFECYCLE/TASK_NOT_FOUND', 'LIFECYCLE/NOT_ASSIGNED', 'LIFECYCLE/ALREADY_SUBMITTED', 'LIFECYCLE/CLAIM_NOT_READY'] as const,
  Timeout:   ['TIMEOUT'] as const,
} as const;

export type ConfigCode    = typeof ErrorCodes.Config[number];
export type CryptoCode    = typeof ErrorCodes.Crypto[number];
export type StorageCode   = typeof ErrorCodes.Storage[number];
export type ChainCode     = typeof ErrorCodes.Chain[number];
export type ComputeCode   = typeof ErrorCodes.Compute[number];
export type ApiCode       = typeof ErrorCodes.Api[number];
export type LifecycleCode = typeof ErrorCodes.Lifecycle[number];
export type TimeoutCode   = typeof ErrorCodes.Timeout[number];

export type ErrorCode =
  | ConfigCode | CryptoCode | StorageCode | ChainCode
  | ComputeCode | ApiCode | LifecycleCode | TimeoutCode;
```

**Step 2:** `src/errors/BlindMarketError.ts`:

```ts
import type { ErrorCode } from './codes.js';

export interface ErrorOptions {
  retriable?: boolean;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export abstract class BlindMarketError extends Error {
  readonly code: ErrorCode;
  readonly retriable: boolean;
  readonly context?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, opts: ErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.retriable = opts.retriable ?? false;
    this.context = opts.context;
    this.cause = opts.cause;
    // Make the name enumerable=false to match Error semantics
    Object.defineProperty(this, 'name', { value: this.constructor.name, enumerable: false });
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retriable: this.retriable,
      ...(this.context ? { context: this.context } : {}),
    };
  }
}
```

**Step 3:** `src/errors/subclasses.ts`:

```ts
import { BlindMarketError, type ErrorOptions } from './BlindMarketError.js';
import type {
  ConfigCode, CryptoCode, StorageCode, ChainCode,
  ComputeCode, ApiCode, LifecycleCode, TimeoutCode,
} from './codes.js';

export class ConfigError    extends BlindMarketError { constructor(code: ConfigCode,    msg: string, opts?: ErrorOptions) { super(code, msg, opts); } }
export class CryptoError    extends BlindMarketError { constructor(code: CryptoCode,    msg: string, opts?: ErrorOptions) { super(code, msg, opts); } }
export class StorageError   extends BlindMarketError { constructor(code: StorageCode,   msg: string, opts?: ErrorOptions) { super(code, msg, opts); } }
export class ChainError     extends BlindMarketError { constructor(code: ChainCode,     msg: string, opts?: ErrorOptions) { super(code, msg, opts); } }
export class ComputeError   extends BlindMarketError { constructor(code: ComputeCode,   msg: string, opts?: ErrorOptions) { super(code, msg, opts); } }
export class ApiError       extends BlindMarketError { constructor(code: ApiCode,       msg: string, opts?: ErrorOptions) { super(code, msg, opts); } }
export class LifecycleError extends BlindMarketError { constructor(code: LifecycleCode, msg: string, opts?: ErrorOptions) { super(code, msg, opts); } }
export class TimeoutError   extends BlindMarketError { constructor(code: TimeoutCode,   msg: string, opts?: ErrorOptions) { super(code, msg, opts); } }
```

**Step 4:** `src/errors/index.ts` (overwrite):

```ts
export * from './codes.js';
export * from './BlindMarketError.js';
export * from './subclasses.js';
```

**Step 5:** Run: `cd sdk && npm test -- test/errors.test.ts`
**Expected:** all tests pass.

**Step 6:** Run: `cd sdk && npm run typecheck`
**Expected:** clean.

**Step 7:** Commit.
```bash
git add sdk/src/errors sdk/test/errors.test.ts
git commit -m "feat(sdk/errors): typed error hierarchy with stable string codes"
```

---

## Phase 2 — Core types

**Outcome:** `src/types.ts` and supporting type modules define the primitive domain types used everywhere.

### Task 2.1 — Primitive types

**Files:** Create `sdk/src/types.ts`.

**Step 1:**

```ts
export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type TaskId = bigint;
export type RootHash = Hex;

export type TokenSymbol = 'USDC' | 'A0GI' | string;

export interface TokenRef {
  address: Address;
  symbol?: TokenSymbol;
  decimals?: number;
}

export interface Reward {
  token: Address | TokenSymbol;   // address or resolved symbol
  amount: bigint;
}

export type TaskStatus =
  | 'funded'
  | 'assigned'
  | 'submitted'
  | 'verified'
  | 'completed'
  | 'cancelled';

export interface TaskMetadata {
  category: string;
  locationZone: string;
  reward: Reward;
  deadline?: Date;
  extra?: Record<string, string>;
}

export interface TaskRecord extends TaskMetadata {
  taskId: TaskId;
  agent: Address;
  worker?: Address;
  taskHash: RootHash;
  evidenceHash?: RootHash;
  status: TaskStatus;
  createdAt: Date;
}

export interface TaskKey {
  /** AES-256 symmetric key (32 bytes) used to encrypt task instructions. */
  aesKey: Uint8Array;
  /** Per-task ECIES ephemeral pubkey storage for auditing. */
  createdAt: Date;
}

export interface TaskKeyRef {
  taskId: TaskId;
  createdAt: Date;
}

export interface UploadResult {
  rootHash: RootHash;
  txHash?: Hex;
  size: number;
}

export interface VerificationResult {
  passed: boolean;
  confidence: number;
  model: string;
  attestation?: Hex;
  completedAt: Date;
}

export interface TxReceiptLike {
  hash: Hex;
  blockNumber: number;
  gasUsed: bigint;
}

export type Awaitable<T> = T | Promise<T>;
```

**Step 2:** No separate test file — types are verified by consumers. Run `npm run typecheck`. Expect clean.

**Step 3:** Commit.
```bash
git add sdk/src/types.ts
git commit -m "feat(sdk): primitive domain types"
```

---

## Phase 3 — Event bus

**Outcome:** `src/events/` exports a typed pub/sub with typed events, once, off, and listeners' exceptions isolated.

### Task 3.1 — Test

**Files:** Create `sdk/test/events.test.ts`.

```ts
import { describe, expect, it, vi } from 'vitest';
import { EventBus, type SdkEvents } from '../src/events';

describe('EventBus', () => {
  it('delivers typed events to subscribers', () => {
    const bus = new EventBus<SdkEvents>();
    const fn = vi.fn();
    bus.on('tx.sent', fn);
    bus.emit('tx.sent', { hash: '0xabc', from: '0x00', to: '0x01' });
    expect(fn).toHaveBeenCalledWith({ hash: '0xabc', from: '0x00', to: '0x01' });
  });

  it('once fires only once', () => {
    const bus = new EventBus<SdkEvents>();
    const fn = vi.fn();
    bus.once('tx.sent', fn);
    bus.emit('tx.sent', { hash: '0x1', from: '0x0', to: '0x0' });
    bus.emit('tx.sent', { hash: '0x2', from: '0x0', to: '0x0' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('off removes a specific listener', () => {
    const bus = new EventBus<SdkEvents>();
    const fn = vi.fn();
    bus.on('tx.sent', fn);
    bus.off('tx.sent', fn);
    bus.emit('tx.sent', { hash: '0x1', from: '0x0', to: '0x0' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('isolates listener exceptions (all other listeners still fire)', () => {
    const bus = new EventBus<SdkEvents>();
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    bus.on('tx.sent', bad);
    bus.on('tx.sent', good);
    bus.emit('tx.sent', { hash: '0x1', from: '0x0', to: '0x0' });
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });
});
```

### Task 3.2 — Implement

**Files:** Create `sdk/src/events/EventBus.ts`, `sdk/src/events/types.ts`, overwrite `sdk/src/events/index.ts`.

**`src/events/types.ts`:**

```ts
import type { Address, Hex, TaskId, RootHash } from '../types.js';

export interface SdkEvents {
  'task.created':       { taskId: TaskId; txHash: Hex; rootHash: RootHash };
  'task.assigned':      { taskId: TaskId; worker: Address; txHash: Hex };
  'task.cancelled':     { taskId: TaskId; txHash: Hex };
  'evidence.submitted': { taskId: TaskId; rootHash: RootHash; txHash: Hex };
  'verification.done':  { taskId: TaskId; passed: boolean; confidence: number };
  'payment.claimed':    { taskId: TaskId; txHash: Hex; amount: bigint };
  'tx.sent':            { hash: Hex; from: Address; to: Address };
  'tx.confirmed':       { hash: Hex; blockNumber: number };
  'tx.failed':          { hash: Hex; reason: string };
}
```

**`src/events/EventBus.ts`:**

```ts
type Handler<T> = (payload: T) => void;

export class EventBus<E extends Record<string, unknown>> {
  private handlers: { [K in keyof E]?: Set<Handler<E[K]>> } = {};

  on<K extends keyof E>(event: K, fn: Handler<E[K]>): () => void {
    (this.handlers[event] ??= new Set<Handler<E[K]>>()).add(fn);
    return () => this.off(event, fn);
  }

  once<K extends keyof E>(event: K, fn: Handler<E[K]>): () => void {
    const wrapped: Handler<E[K]> = (p) => { this.off(event, wrapped); fn(p); };
    return this.on(event, wrapped);
  }

  off<K extends keyof E>(event: K, fn: Handler<E[K]>): void {
    this.handlers[event]?.delete(fn);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const hs = this.handlers[event];
    if (!hs) return;
    for (const h of hs) {
      try { h(payload); } catch { /* isolated; telemetry plugin can capture */ }
    }
  }
}
```

**`src/events/index.ts`:**

```ts
export * from './EventBus.js';
export * from './types.js';
```

**Run:** `cd sdk && npm test -- test/events.test.ts` → expect pass.
**Commit:** `feat(sdk/events): typed event bus with isolation`.

---

## Phase 4 — Crypto (isomorphic, byte-compatible with backend+frontend)

**Outcome:** `src/crypto/` exports `aesEncrypt/aesDecrypt`, `eciesEncrypt/eciesDecrypt`, `generateAesKey`, `generateKeyPair`, `sha256`, `deriveSharedKey`, each working in Node and browser via `globalThis.crypto.subtle` (Web Crypto), with **byte-for-byte** identical output to `backend/src/services/crypto.ts` and `frontend/src/lib/crypto.ts`.

**Wire formats (never change these):**
- AES blob: `[12 IV][16 tag][ciphertext]`
- ECIES blob: `[65 ephemeral pubkey uncompressed][AES blob]`
- HKDF info: `'BlindMarket-ECIES-v1'`

### Task 4.1 — AES-256-GCM round-trip test + property test

**Files:** Create `sdk/test/crypto.aes.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { aesEncrypt, aesDecrypt, generateAesKey } from '../src/crypto';
import { CryptoError } from '../src/errors';

describe('aes-256-gcm', () => {
  it('encrypts then decrypts arbitrary bytes', async () => {
    const key = await generateAesKey();
    const pt = new TextEncoder().encode('hello bounty');
    const ct = await aesEncrypt(pt, key);
    expect(ct.byteLength).toBe(pt.byteLength + 12 + 16);
    const rt = await aesDecrypt(ct, key);
    expect(new TextDecoder().decode(rt)).toBe('hello bounty');
  });

  it('rejects non-32-byte keys', async () => {
    const key = new Uint8Array(16);
    await expect(aesEncrypt(new Uint8Array(4), key)).rejects.toBeInstanceOf(CryptoError);
  });

  it('rejects truncated blobs', async () => {
    const key = await generateAesKey();
    await expect(aesDecrypt(new Uint8Array(10), key)).rejects.toBeInstanceOf(CryptoError);
  });

  it('detects tampering (auth tag check)', async () => {
    const key = await generateAesKey();
    const ct = await aesEncrypt(new TextEncoder().encode('data'), key);
    ct[ct.length - 1] ^= 0x01;
    await expect(aesDecrypt(ct, key)).rejects.toBeInstanceOf(CryptoError);
  });

  it('property: arbitrary plaintext round-trips', async () => {
    await fc.assert(fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 4096 }), async (pt) => {
      const key = await generateAesKey();
      const rt = await aesDecrypt(await aesEncrypt(pt, key), key);
      expect(Array.from(rt)).toEqual(Array.from(pt));
    }), { numRuns: 50 });
  });
});
```

### Task 4.2 — Implement AES module

**Files:** Create `sdk/src/crypto/constants.ts`, `sdk/src/crypto/aes.ts`.

**`src/crypto/constants.ts`:**

```ts
export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const KEY_LENGTH = 32;
export const ECIES_PUBKEY_LENGTH = 65;   // uncompressed secp256k1
export const ECIES_HKDF_INFO = new TextEncoder().encode('BlindMarket-ECIES-v1');
export const AES_MIN_BLOB = IV_LENGTH + TAG_LENGTH;       // 28 bytes (zero-length ct OK)
export const ECIES_MIN_BLOB = ECIES_PUBKEY_LENGTH + AES_MIN_BLOB;
```

**`src/crypto/aes.ts`:**

```ts
import { CryptoError } from '../errors/index.js';
import { IV_LENGTH, TAG_LENGTH, KEY_LENGTH, AES_MIN_BLOB } from './constants.js';

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new CryptoError('CRYPTO/UNSUPPORTED_CIPHER', 'Web Crypto not available');
  return c.subtle;
}

export async function generateAesKey(): Promise<Uint8Array> {
  const key = new Uint8Array(KEY_LENGTH);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(key);
  return key;
}

export async function aesEncrypt(plaintext: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  if (key.byteLength !== KEY_LENGTH) {
    throw new CryptoError('CRYPTO/INVALID_KEY', `AES key must be ${KEY_LENGTH} bytes, got ${key.byteLength}`);
  }
  const iv = new Uint8Array(IV_LENGTH);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(iv);
  try {
    const ck = await subtle().importKey('raw', copy(key), 'AES-GCM', false, ['encrypt']);
    const out = new Uint8Array(
      await subtle().encrypt({ name: 'AES-GCM', iv: copy(iv), tagLength: TAG_LENGTH * 8 }, ck, copy(plaintext)),
    );
    // WebCrypto produces [ciphertext || tag]. Rewrite to [IV || tag || ciphertext].
    const ct = out.slice(0, out.length - TAG_LENGTH);
    const tag = out.slice(out.length - TAG_LENGTH);
    const blob = new Uint8Array(IV_LENGTH + TAG_LENGTH + ct.length);
    blob.set(iv, 0);
    blob.set(tag, IV_LENGTH);
    blob.set(ct, IV_LENGTH + TAG_LENGTH);
    return blob;
  } catch (cause) {
    throw new CryptoError('CRYPTO/DECRYPT_FAILED', 'AES encrypt failed', { cause });
  }
}

export async function aesDecrypt(blob: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  if (key.byteLength !== KEY_LENGTH) {
    throw new CryptoError('CRYPTO/INVALID_KEY', `AES key must be ${KEY_LENGTH} bytes, got ${key.byteLength}`);
  }
  if (blob.byteLength < AES_MIN_BLOB) {
    throw new CryptoError('CRYPTO/INTEGRITY_CHECK', `AES blob too short: ${blob.byteLength}`);
  }
  const iv = blob.slice(0, IV_LENGTH);
  const tag = blob.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = blob.slice(IV_LENGTH + TAG_LENGTH);
  const combined = new Uint8Array(ct.length + TAG_LENGTH);
  combined.set(ct, 0);
  combined.set(tag, ct.length);
  try {
    const ck = await subtle().importKey('raw', copy(key), 'AES-GCM', false, ['decrypt']);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: copy(iv), tagLength: TAG_LENGTH * 8 }, ck, copy(combined));
    return new Uint8Array(pt);
  } catch (cause) {
    throw new CryptoError('CRYPTO/DECRYPT_FAILED', 'AES decrypt failed', { cause });
  }
}

function copy(u: Uint8Array): Uint8Array {
  const c = new Uint8Array(u.byteLength);
  c.set(u);
  return c;
}
```

**Run:** `cd sdk && npm test -- test/crypto.aes.test.ts` → expect pass.

---

### Task 4.3 — ECIES test (secp256k1 + HKDF-SHA256 + AES-GCM)

**Files:** Create `sdk/test/crypto.ecies.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { eciesEncrypt, eciesDecrypt, generateKeyPair } from '../src/crypto';
import { CryptoError } from '../src/errors';

describe('ecies secp256k1', () => {
  it('round-trips', async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const pt = new TextEncoder().encode('secret instructions');
    const ct = await eciesEncrypt(pt, publicKey);
    const rt = await eciesDecrypt(ct, privateKey);
    expect(new TextDecoder().decode(rt)).toBe('secret instructions');
  });

  it('ephemeral pubkey is 65 bytes + AES blob follows', async () => {
    const { publicKey } = generateKeyPair();
    const ct = await eciesEncrypt(new Uint8Array([1, 2, 3]), publicKey);
    expect(ct.byteLength).toBe(65 + 12 + 16 + 3);
  });

  it('wrong private key fails with CryptoError', async () => {
    const good = generateKeyPair();
    const bad = generateKeyPair();
    const ct = await eciesEncrypt(new Uint8Array([9]), good.publicKey);
    await expect(eciesDecrypt(ct, bad.privateKey)).rejects.toBeInstanceOf(CryptoError);
  });

  it('property: arbitrary plaintext round-trips', async () => {
    await fc.assert(fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 1024 }), async (pt) => {
      const { privateKey, publicKey } = generateKeyPair();
      const rt = await eciesDecrypt(await eciesEncrypt(pt, publicKey), privateKey);
      expect(Array.from(rt)).toEqual(Array.from(pt));
    }), { numRuns: 25 });
  });
});
```

### Task 4.4 — Implement ECIES

**Files:** Create `sdk/src/crypto/ecies.ts`, `sdk/src/crypto/keys.ts`, `sdk/src/crypto/hkdf.ts`, overwrite `sdk/src/crypto/index.ts`.

**`src/crypto/keys.ts`:**

```ts
import { ethers } from 'ethers';
import { CryptoError } from '../errors/index.js';

export interface KeyPair { privateKey: string; publicKey: string }

/** Fresh secp256k1 keypair. Returned hex strings are un-prefixed. */
export function generateKeyPair(): KeyPair {
  const w = ethers.Wallet.createRandom();
  return { privateKey: w.privateKey.slice(2), publicKey: w.signingKey.publicKey.slice(2) };
}

export function derivePublicKey(privateKey: string): string {
  const sk = new ethers.SigningKey(`0x${strip(privateKey)}`);
  return sk.publicKey.slice(2);
}

export function strip(hex: string): string { return hex.startsWith('0x') ? hex.slice(2) : hex; }

export function assertUncompressedPubKey(pub: string): void {
  const s = strip(pub);
  if (s.length !== 130 || !/^04/i.test(s)) {
    throw new CryptoError('CRYPTO/INVALID_KEY', 'expected uncompressed secp256k1 pubkey (65 bytes hex, 0x04…)');
  }
}
```

**`src/crypto/hkdf.ts`:**

```ts
import { ECIES_HKDF_INFO } from './constants.js';
import { CryptoError } from '../errors/index.js';

export async function hkdfSha256(ikm: Uint8Array, length = 32, info = ECIES_HKDF_INFO, salt = new Uint8Array(0)): Promise<Uint8Array> {
  const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
  try {
    const k = await subtle.importKey('raw', ikm.buffer.slice(0) as ArrayBuffer, 'HKDF', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', info: info.buffer.slice(0) as ArrayBuffer, salt: salt.buffer.slice(0) as ArrayBuffer }, k, length * 8);
    return new Uint8Array(bits);
  } catch (cause) {
    throw new CryptoError('CRYPTO/INVALID_KEY', 'HKDF failed', { cause });
  }
}
```

**`src/crypto/ecies.ts`:**

```ts
import { ethers } from 'ethers';
import { aesDecrypt, aesEncrypt } from './aes.js';
import { hkdfSha256 } from './hkdf.js';
import { KEY_LENGTH, ECIES_PUBKEY_LENGTH, ECIES_MIN_BLOB } from './constants.js';
import { assertUncompressedPubKey, strip } from './keys.js';
import { CryptoError } from '../errors/index.js';

/** ECIES-encrypt to a recipient's uncompressed secp256k1 public key (hex, with or without 0x). */
export async function eciesEncrypt(plaintext: Uint8Array, recipientPubKey: string): Promise<Uint8Array> {
  assertUncompressedPubKey(recipientPubKey);
  const ephemeral = ethers.Wallet.createRandom();
  const shared = sharedSecret(ephemeral.privateKey, `0x${strip(recipientPubKey)}`);
  const aesKey = await hkdfSha256(shared, KEY_LENGTH);
  const aesBlob = await aesEncrypt(plaintext, aesKey);
  const ephPub = hexToBytes(strip(ephemeral.signingKey.publicKey));
  if (ephPub.byteLength !== ECIES_PUBKEY_LENGTH) {
    throw new CryptoError('CRYPTO/INVALID_KEY', 'ephemeral pubkey length');
  }
  const blob = new Uint8Array(ECIES_PUBKEY_LENGTH + aesBlob.byteLength);
  blob.set(ephPub, 0);
  blob.set(aesBlob, ECIES_PUBKEY_LENGTH);
  return blob;
}

export async function eciesDecrypt(blob: Uint8Array, recipientPrivKey: string): Promise<Uint8Array> {
  if (blob.byteLength < ECIES_MIN_BLOB) {
    throw new CryptoError('CRYPTO/INTEGRITY_CHECK', `ECIES blob too short: ${blob.byteLength}`);
  }
  const ephPub = blob.slice(0, ECIES_PUBKEY_LENGTH);
  const aesBlob = blob.slice(ECIES_PUBKEY_LENGTH);
  const shared = sharedSecret(`0x${strip(recipientPrivKey)}`, `0x${bytesToHex(ephPub)}`);
  const aesKey = await hkdfSha256(shared, KEY_LENGTH);
  return aesDecrypt(aesBlob, aesKey);
}

function sharedSecret(privHex: string, pubHex: string): Uint8Array {
  const sk = new ethers.SigningKey(privHex);
  const shared = sk.computeSharedSecret(pubHex);
  // computeSharedSecret returns 0x04 || X || Y. We want just X (32 bytes), matching backend/frontend.
  const bytes = hexToBytes(strip(shared));
  if (bytes.byteLength !== 65 || bytes[0] !== 0x04) {
    throw new CryptoError('CRYPTO/INVALID_KEY', 'unexpected shared secret shape');
  }
  return bytes.slice(1, 33);
}

function hexToBytes(hex: string): Uint8Array {
  const s = strip(hex);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.substring(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(u: Uint8Array): string {
  return Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

**`src/crypto/index.ts`:**

```ts
export * from './constants.js';
export * from './aes.js';
export * from './ecies.js';
export * from './keys.js';
export { hkdfSha256 } from './hkdf.js';
```

**Run:** `cd sdk && npm test -- test/crypto.ecies.test.ts` → expect pass.
**Run full:** `cd sdk && npm test` → all crypto suites pass.
**Commit:** `feat(sdk/crypto): AES-256-GCM + ECIES-secp256k1 isomorphic, byte-compatible with backend`.

---

### Task 4.5 — Cross-compat fixture test (SDK ↔ backend ↔ frontend)

**Files:** Create `sdk/test/crypto.compat.test.ts`.

**Purpose:** prove the SDK can decrypt a blob generated by `backend/src/services/crypto.ts` and vice versa. Use a hard-coded keypair and a hard-coded plaintext; bake two fixture blobs into the test (one AES, one ECIES) produced by running a short Node script against the backend's crypto.ts, and assert the SDK decrypts them.

**Implementation note:** generate fixtures once with a small script, commit the hex blobs, then the test does SDK.decrypt(hexToBytes(fixture)) === plaintext. This locks the wire format.

(Fixtures generated via `scripts/gen-crypto-fixtures.mjs` — see Task 4.6.)

### Task 4.6 — Fixture generator

**Files:** Create `sdk/scripts/gen-crypto-fixtures.mjs`.

Runs the backend's crypto.ts to produce `test/fixtures/crypto.json` with:
```json
{
  "keypair": { "privateKey": "…", "publicKey": "…" },
  "plaintext": "hello cross-compat",
  "aes": { "key": "…hex…", "blob": "…hex…" },
  "ecies": { "blob": "…hex…" }
}
```

Committed. Test 4.5 loads and verifies.

**Commit:** `test(sdk/crypto): cross-compatibility fixtures with backend byte format`.

---

## Phase 5 — Network presets

**Outcome:** `src/network/` exports `networks` object with `'testnet'` preset (chainId 16602, contract addresses from `contracts/deployments/0g-testnet.json`) and a `CustomNetwork` type.

### Task 5.1 — Test

`test/network.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { networks, resolveNetwork } from '../src/network';
import { ConfigError } from '../src/errors';

describe('networks', () => {
  it('testnet preset matches 0G Galileo', () => {
    expect(networks.testnet.chainId).toBe(16602n);
    expect(networks.testnet.contracts.escrow).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('resolveNetwork accepts preset name', () => {
    const n = resolveNetwork('testnet');
    expect(n.chainId).toBe(16602n);
  });

  it('rejects unknown preset', () => {
    expect(() => resolveNetwork('nope' as any)).toThrow(ConfigError);
  });

  it('accepts a custom network object', () => {
    const n = resolveNetwork({ chainId: 1337n, rpc: ['http://localhost:8545'], contracts: { escrow: '0x1', registry: '0x2', reputation: '0x3', usdc: '0x4' }, indexer: '', broker: '' });
    expect(n.chainId).toBe(1337n);
  });
});
```

### Task 5.2 — Implement

`src/network/types.ts`:

```ts
import type { Address } from '../types.js';

export interface NetworkContracts {
  escrow: Address;
  registry: Address;
  reputation: Address;
  usdc: Address;
}

export interface Network {
  name: string;
  chainId: bigint;
  rpc: string[];
  contracts: NetworkContracts;
  indexer: string;
  broker: string;
  explorer?: string;
}
```

`src/network/presets.ts`:

```ts
import type { Network } from './types.js';

export const networks = {
  testnet: {
    name: '0g-galileo-testnet',
    chainId: 16602n,
    rpc: ['https://evmrpc-testnet.0g.ai'],
    contracts: {
      escrow:     '0xFd4F93F5A7BE144c405D1D8fbEC63Fb776207681',
      registry:   '0xeE52d780A47F77E8a4a1cEb236e3C65A48FbD828',
      reputation: '0x4A6374Fae37E19E69ba43E7cf6994AC15F63256e',
      usdc:       '0x317227efcA18D004E12CA8046AEf7E1597458F25',
    },
    indexer: 'https://indexer-storage-testnet-turbo.0g.ai',
    broker: 'https://broker.testnet.0g.ai',
    explorer: 'https://chainscan-galileo.0g.ai',
  },
} as const satisfies Record<string, Network>;

export type NetworkName = keyof typeof networks;
```

`src/network/resolve.ts`:

```ts
import { ConfigError } from '../errors/index.js';
import type { Network } from './types.js';
import { networks, type NetworkName } from './presets.js';

export function resolveNetwork(arg: NetworkName | Network): Network {
  if (typeof arg === 'string') {
    const n = (networks as Record<string, Network>)[arg];
    if (!n) throw new ConfigError('CONFIG/INVALID_NETWORK', `unknown network: ${arg}`);
    return n;
  }
  return arg;
}
```

`src/network/index.ts`:
```ts
export * from './types.js';
export * from './presets.js';
export * from './resolve.js';
```

**Commit:** `feat(sdk/network): testnet preset + resolver`.

---

## Phase 6 — Signer adapters

**Outcome:** `src/signer/` exports `Signer` interface, `EthersSigner`, `PrivateKeySigner`, `BrowserSigner`, `ReadOnlySigner`.

### Task 6.1 — Interface + unit tests

`src/signer/Signer.ts`:

```ts
import type { Address, Hex } from '../types.js';

export interface TxRequest {
  to: Address;
  from?: Address;
  data?: Hex;
  value?: bigint;
  gasLimit?: bigint;
  nonce?: number;
  chainId?: bigint;
}

export interface Signer {
  getAddress(): Promise<Address>;
  chainId(): Promise<bigint>;
  signMessage(msg: string | Uint8Array): Promise<Hex>;
  signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>,
  ): Promise<Hex>;
  signTransaction(tx: TxRequest): Promise<Hex>;
  getPublicKey(): Promise<Hex>;
}
```

Each concrete adapter wraps an ethers signer, a raw pk, or an EIP-1193 provider. `ReadOnlySigner` throws `ConfigError('CONFIG/MISSING_SIGNER')` on write attempts.

Tests verify: address round-trip, signMessage signature recoverable to correct address, and read-only throws on signTransaction.

### Task 6.2 — Implement adapters

Files:
- `src/signer/EthersSigner.ts` — wraps `ethers.Signer`
- `src/signer/PrivateKeySigner.ts` — `new ethers.Wallet(pk)` → delegates to `EthersSigner`
- `src/signer/BrowserSigner.ts` — wraps `ethers.BrowserProvider` on `window.ethereum`; lazily recovers pubkey by signing a `getPublicKey`-marker message once and caching
- `src/signer/ReadOnlySigner.ts` — throws on writes
- `src/signer/index.ts` — re-exports

**Commit:** `feat(sdk/signer): Ethers, PrivateKey, Browser, ReadOnly adapters`.

---

## Phase 7 — KeyStore adapters

**Outcome:** `src/keystore/` exports `KeyStore`, `InMemoryKeyStore`, `FileKeyStore`, `BrowserKeyStore`.

### Task 7.1 — Interface + in-memory

`src/keystore/KeyStore.ts`:

```ts
import type { Address, Hex, TaskId, TaskKey, TaskKeyRef } from '../types.js';

export interface KeyStore {
  putTaskKey(taskId: TaskId, key: TaskKey): Promise<void>;
  getTaskKey(taskId: TaskId): Promise<TaskKey | null>;
  putPeerPubKey(addr: Address, pubkey: Hex): Promise<void>;
  getPeerPubKey(addr: Address): Promise<Hex | null>;
  list(): Promise<TaskKeyRef[]>;
  delete(taskId: TaskId): Promise<void>;
  export(passphrase: string): Promise<string>;
  import(data: string, passphrase: string): Promise<void>;
}
```

Tests: put/get/delete/list, export/import round-trips.

### Task 7.2 — FileKeyStore (Node, scrypt + AES-GCM)

Wraps `InMemoryKeyStore` with disk persistence. Uses `node:fs/promises`, `node:crypto.scryptSync(passphrase, salt, 32, { N: 2**17 })`, then AES-256-GCM.

### Task 7.3 — BrowserKeyStore (IndexedDB)

Wraps `InMemoryKeyStore` with IndexedDB. Session-unlocked via passphrase; keys never touch storage in plaintext.

**Commit:** `feat(sdk/keystore): InMemory, File, Browser adapters with encrypted-at-rest`.

---

## Phase 8 — Chain clients

**Outcome:** `src/chain/` exports typed wrappers for the three contracts, loaded from ABIs copied into `src/chain/abi/`.

### Task 8.1 — Import ABIs

**Step 1:** Copy ABIs from the monorepo:
```bash
mkdir -p sdk/src/chain/abi
cp backend/src/abi/*.json sdk/src/chain/abi/
```

**Step 2:** Add `resolveJsonModule: true` (already in tsconfig).

### Task 8.2 — Build-time ABI diff check

**Files:** Create `sdk/scripts/check-abi-drift.mjs`. Compares `src/chain/abi/*.json` to `../contracts/artifacts/contracts/*.sol/*.json` (extracting `.abi`). Fails the build if drift. Hooked into `prebuild` script in `package.json`.

### Task 8.3 — Typed contract clients

For each contract, create `src/chain/<name>.ts`:
- `BlindEscrow.ts` — `createTask`, `assignWorker`, `submitEvidence`, `completeVerification`, `cancelTask`, `claimPayment`, `getTask`, listen to events
- `TaskRegistry.ts` — `listOpenTasks`, `getTaskMeta`
- `BlindReputation.ts` — `rate`, `getReputation`, `leaderboard` (if view exists)

Each constructor takes `{ network, signer, provider? }` and returns a typed client whose methods map 1:1 to the Solidity interface (input/output types derived from `types.ts`).

Errors: wrap ethers `CALL_EXCEPTION` into `ChainError('CHAIN/TX_REVERTED', reason, { context: { data }, cause })`. Map `INSUFFICIENT_FUNDS` → `CHAIN/INSUFFICIENT_BALANCE`. Mismatched chainId → `CHAIN/NETWORK_MISMATCH`.

Tests run against a **hardhat local node** fixture with the three contracts deployed from the monorepo's artifacts.

### Task 8.4 — RPC pool with failover

`src/chain/RpcPool.ts` wraps `ethers.JsonRpcProvider` with round-robin across `network.rpc[]`, exponential backoff on retriable errors, caps retries per request.

**Commit:** `feat(sdk/chain): typed BlindEscrow/TaskRegistry/BlindReputation clients + RpcPool`.

---

## Phase 9 — Storage wrapper (0G Storage)

**Outcome:** `src/storage/` exports `Storage` interface with `upload`, `download`, `hash`, `verifyMerkle`. Default adapter uses `@0gfoundation/0g-ts-sdk`; `MemoryStorage` adapter for tests.

### Task 9.1 — Test (using MemoryStorage)

`test/storage.test.ts` verifies:
- upload returns a deterministic rootHash for the same content
- download returns the same bytes
- download of unknown hash throws `StorageError('STORAGE/NOT_FOUND')`
- retriable flag on indexer timeouts

### Task 9.2 — Implement

`src/storage/Storage.ts` interface:
```ts
export interface Storage {
  upload(bytes: Uint8Array): Promise<UploadResult>;
  download(rootHash: RootHash): Promise<Uint8Array>;
  hash(bytes: Uint8Array): Promise<RootHash>;
}
```

`src/storage/ZgStorage.ts` — `@0gfoundation/0g-ts-sdk` wrapper (see `backend/src/services/storage.ts` for reference).

`src/storage/MemoryStorage.ts` — keyed by SHA-256 of content.

`src/storage/index.ts` — exports.

**Commit:** `feat(sdk/storage): 0G Storage + in-memory adapter`.

---

## Phase 10 — Compute wrapper (0G Sealed Inference)

**Outcome:** `src/compute/` exports `Compute` interface with `verify`, `listProviders`, `getLedger`. Default adapter uses `@0glabs/0g-serving-broker` (see `backend/src/services/verification.ts` for the CJS interop workaround). `MockCompute` for tests.

Implement `runSealedInference({ taskId, evidence, prompt }) → VerificationResult`. Maps broker errors to `ComputeError` with proper codes.

**Commit:** `feat(sdk/compute): 0G Sealed Inference wrapper + mock`.

---

## Phase 11 — REST API client

**Outcome:** `src/api/` exports a typed client for every backend route, including reserved namespaces (`staking`, `a2a`, `custody`, `forensics`, `accounting`).

### Task 11.1 — HTTP client core

`src/api/HttpClient.ts`:
- fetch wrapper with JSON defaults, retry on retriable codes, exponential backoff
- injects JWT or API key
- maps HTTP → typed errors: `401 → API/AUTH_REQUIRED`, `403 → API/FORBIDDEN`, `429 → API/RATE_LIMITED` (retriable), `400 → API/VALIDATION`, `404 → API/NOT_FOUND`, `5xx → API/SERVER` (retriable)

### Task 11.2 — Auth (SIWE nonce → JWT)

`src/api/AuthClient.ts`:
- `requestNonce(address) → { nonce, message }`
- `login({ signature }) → { jwt, expiresAt }`
- `refresh()` if supported

### Task 11.3 — Namespaces (one test + one impl per namespace)

Create `src/api/<name>.ts` for each:
- `TasksApi` — list, get, create-metadata, cancel, assign, apply, applications, instructions
- `SubmissionsApi` — submit, get
- `VerificationApi` — trigger, get, providers
- `ReputationApi` — byAddress, leaderboard
- `StorageApi` — upload, download, hash (maps to 0G Storage routes)
- `StakingApi` — stake, unstake, slash (placeholder endpoints)
- `A2aApi` — send, inbox, protocol
- `CustodyApi` — deposit, rotate, export
- `ForensicsApi` — evidence, disputes
- `AccountingApi` — balances, splits, treasury

Each method is a thin typed wrapper over `HttpClient`. Inputs/outputs use types from `src/types.ts`.

Tests use a fetch-mocking utility (`msw` or manual `vi.stubGlobal('fetch', …)`).

**Commit:** `feat(sdk/api): REST client with typed namespaces for all backend routes`.

---

## Phase 12 — Agent role

**Outcome:** `src/agent/Agent.ts` composes crypto + storage + chain + api + keystore into the end-to-end agent flows.

### Task 12.1 — Test `createTask` end-to-end with mocks

`test/agent.create.test.ts`:
- build Agent with MemoryStorage + hardhat chain + mocked API
- `agent.createTask({ instructions, category, locationZone, reward })`
- assert: AES key generated, ECIES-wrapped to agent's own pubkey (self-backup), uploaded to Storage, `BlindEscrow.createTask(taskHash, …)` called, keystore has the task key, event `task.created` fired

### Task 12.2 — Implement

```ts
export class Agent {
  constructor(private deps: AgentDeps) {}

  async createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
    const { crypto, storage, chain, keystore, signer, events } = this.deps;
    const aesKey = await crypto.aes.generateAesKey();
    const plaintext = toBytes(input.instructions);
    const blob = await crypto.aes.aesEncrypt(plaintext, aesKey);
    // Self-backup: ECIES-wrap AES key to agent's own pubkey
    const agentPub = await signer.getPublicKey();
    const wrappedForAgent = await crypto.ecies.eciesEncrypt(aesKey, agentPub);
    const { rootHash } = await storage.upload(concat(wrappedForAgent, blob));
    const tx = await chain.escrow.createTask({
      taskHash: rootHash,
      token: resolveToken(input.reward.token, deps.network),
      amount: input.reward.amount,
      category: input.category,
      locationZone: input.locationZone,
    });
    const taskId = tx.events.TaskCreated.args.taskId as bigint;
    await keystore.putTaskKey(taskId, { aesKey, createdAt: new Date() });
    events.emit('task.created', { taskId, txHash: tx.hash, rootHash });
    return { taskId, taskKey: { aesKey, createdAt: new Date() }, rootHash, txHash: tx.hash };
  }

  async listApplicants(taskId: TaskId) { return this.deps.api.tasks.applications(taskId); }

  async assignWorker(taskId: TaskId, worker: Address): Promise<TxReceiptLike> {
    const key = await this.deps.keystore.getTaskKey(taskId);
    if (!key) throw new LifecycleError('LIFECYCLE/TASK_NOT_FOUND', `no task key for ${taskId}`);
    const workerPub = await this.deps.api.reputation.pubKey(worker) ?? await this.fetchPubKey(worker);
    const wrapped = await this.deps.crypto.ecies.eciesEncrypt(key.aesKey, workerPub);
    await this.deps.api.tasks.shareKey(taskId, worker, wrapped);
    const receipt = await this.deps.chain.escrow.assignWorker(taskId, worker);
    this.deps.events.emit('task.assigned', { taskId, worker, txHash: receipt.hash });
    return receipt;
  }

  async waitForSubmission(taskId: TaskId, opts?: { timeoutMs?: number }): Promise<{ rootHash: RootHash }> { /* poll chain + api */ }
  async decryptEvidence(taskId: TaskId): Promise<Uint8Array> { /* fetch + unwrap + aes decrypt */ }
  async verify(taskId: TaskId): Promise<VerificationResult> { /* delegate to compute + chain */ }
  async rate(taskId: TaskId, rating: { score: number }): Promise<TxReceiptLike> { /* reputation contract */ }
  async cancel(taskId: TaskId): Promise<TxReceiptLike> { /* escrow.cancelTask */ }
}
```

TDD each method: one test per method, minimal impl, commit.

**Commit:** `feat(sdk/agent): Agent role end-to-end flows`.

---

## Phase 13 — Worker role

**Outcome:** `src/worker/Worker.ts` with `browse`, `apply`, `getInstructions`, `submitEvidence`, `claim`.

`getInstructions`:
1. Fetch wrapped AES key from API.
2. ECIES-decrypt with worker's private key.
3. Download task blob from Storage.
4. AES-decrypt.
5. Return plaintext.

`submitEvidence`:
1. Generate fresh AES key.
2. Encrypt evidence bytes.
3. ECIES-wrap AES key to (a) enclave pubkey from `compute.getEnclavePubKey()`, (b) agent pubkey from `api.tasks.get(taskId).agentPubKey`.
4. Upload `[wrappedForEnclave || wrappedForAgent || aesBlob]` to Storage.
5. Call `BlindEscrow.submitEvidence(taskId, rootHash)`.
6. Emit `evidence.submitted`.

TDD each. **Commit:** `feat(sdk/worker): Worker role end-to-end flows`.

---

## Phase 14 — Verifier role

**Outcome:** `src/verifier/Verifier.ts` with `runSealedInference`, `validateAttestation`. Most verification happens via the backend or broker; this class exposes the direct-broker path for integrators running their own verifier.

TDD with mocked `Compute`. **Commit:** `feat(sdk/verifier): Verifier role`.

---

## Phase 15 — Umbrella `BlindMarket` class

**Outcome:** `src/BlindMarket.ts` wires every module together with a single constructor. Primitives exposed as properties; roles composed from primitives.

```ts
export class BlindMarket {
  readonly chain: ChainClient;
  readonly storage: Storage;
  readonly compute: Compute;
  readonly crypto: typeof Crypto;
  readonly api: ApiClient;
  readonly events = new EventBus<SdkEvents>();
  readonly agent: Agent;
  readonly worker: Worker;
  readonly verifier: Verifier;

  constructor(opts: BlindMarketOptions) { /* resolve network, wire deps, install plugins */ }
}
```

`src/index.ts` re-exports `BlindMarket` + types.

Single integration test (`test/lifecycle.test.ts`) runs the 10-step flow end-to-end against hardhat + MemoryStorage + MockCompute + fetch-mocked API. This is the SDK's headline integration test — if this passes, the wiring is correct.

**Commit:** `feat(sdk): umbrella BlindMarket class + full-lifecycle integration test`.

---

## Phase 16 — Testing utilities + battle-testing

**Outcome:** `src/testing/` exports fixtures and mock adapters. CI matrix catches regressions.

### Task 16.1 — Testing utilities

Export `MockSigner`, `MockStorage`, `MockCompute`, `MockApi`, `fixtures` (canned TaskRecords, addresses, pubkeys). Document in README.

### Task 16.2 — Property-based fuzzing harness

`test/property.crypto.test.ts` with 10k runs for AES + ECIES round-trips.

### Task 16.3 — Reorg simulation

`test/reorg.test.ts` — hardhat reverts + reapplies; SDK recovers from `task.created` event re-emission.

### Task 16.4 — Indexer outage simulation

MemoryStorage variant that 503s on 20% of calls; confirm retries succeed.

### Task 16.5 — Broker ledger exhaustion

MockCompute that rejects with `COMPUTE/LEDGER_INSUFFICIENT`; confirm SDK surfaces it cleanly (no generic error).

### Task 16.6 — Browser matrix

`playwright.config.ts` + one end-to-end browser spec that exercises `crypto`, `signer` (EIP-1193 stub), and an API call. Run on Chromium, Firefox, WebKit.

### Task 16.7 — CI matrix

`.github/workflows/sdk.yml`: Node 18/20/22, Bun, Deno, Chromium/Firefox/WebKit via Playwright, Biome, TypeScript strict, coverage floor 90%.

**Commit:** `test(sdk): property-based, reorg, outage, browser matrix`.

---

## Phase 17 — Docs + release prep

### Task 17.1 — TypeDoc config

`sdk/typedoc.json`: entry points = each subpath, output = `docs-site/`, theme = default.

### Task 17.2 — README

`sdk/README.md` with:
- Install
- Quickstart: "Post an encrypted task in 20 lines" (agent) and "Browse + submit evidence in 20 lines" (worker)
- Link to design doc
- Link to generated TypeDoc site
- Network table
- Contributing + commit style

### Task 17.3 — CHANGELOG + changesets

```bash
cd sdk
npx changeset init
npx changeset add
# Initial release: 0.1.0
```

### Task 17.4 — Publish dry-run

```bash
cd sdk
npm pack
# Inspect tarball for .d.ts presence, no test/, no src/, dist/ complete.
```

**Commit:** `docs(sdk): README + TypeDoc + changesets ready for 0.1.0`.

---

## Phase 18 — Wire SDK back into monorepo

Wire the backend and frontend to consume the SDK internally (via `workspace:*` or a file path) to eat our own dog food before publishing.

### Task 18.1 — Replace backend crypto with SDK crypto

`backend/src/services/crypto.ts` → shim that re-exports from `@blindmarket/sdk/crypto`. Run backend tests. Expect pass (bytes are identical).

### Task 18.2 — Replace frontend crypto with SDK crypto

`frontend/src/lib/crypto.ts` → shim that re-exports from `@blindmarket/sdk/crypto`. Run frontend build + smoke test.

### Task 18.3 — Replace frontend services with SDK API client

One service at a time: `frontend/src/services/tasks.ts` → use `new Api({...}).tasks`. Repeat for each.

This is the **proof of battle-testing**: the SDK passes dogfooding against the same production code that the hackathon demo runs on.

**Commit:** `refactor: monorepo now consumes @blindmarket/sdk as internal dependency`.

---

## Definition of done

- [ ] `sdk/dist/` builds cleanly (ESM + CJS + .d.ts for every subpath)
- [ ] `npm test` passes, coverage ≥90%
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean (Biome)
- [ ] Full-lifecycle integration test passes
- [ ] Property-based tests pass (50+ runs per crypto fixture)
- [ ] Browser tests pass (Chromium, Firefox, WebKit)
- [ ] CI matrix green (Node 18/20/22, Bun, Deno)
- [ ] Backend + frontend refactored to use SDK, monorepo tests green
- [ ] TypeDoc site generated
- [ ] CHANGELOG entry for 0.1.0
- [ ] `docs/plans/2026-04-18-blindmarket-sdk-design.md` unchanged (source of truth)
- [ ] ROADMAP.md updated with SDK phase as ✅

## Execution order / parallelism

Phases 0–5 are strictly serial (each depends on prior). Phases 6–11 can run in parallel pairs:
- (6) Signer || (7) KeyStore
- (8) Chain || (9) Storage || (10) Compute || (11) API

Phase 12 (Agent) depends on 4+6+7+8+9+11. Phase 13 (Worker) depends on same. Phase 14 (Verifier) depends on 10.
Phase 15 depends on 12+13+14.
Phase 16 depends on 15.
Phase 17 depends on 15.
Phase 18 depends on 17.

Use subagent-driven-development to parallelize the independent phases.

## Skills referenced

- `superpowers:executing-plans` — to execute this plan
- `superpowers:subagent-driven-development` — to parallelize independent phases
- `superpowers:test-driven-development` — every task follows red→green→commit
- `superpowers:verification-before-completion` — every DoD checkbox requires command output evidence

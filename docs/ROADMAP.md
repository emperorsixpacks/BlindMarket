# BlindBounty — Roadmap

> Single-page status tracker. Read this first every session.

## Current Phase: 6 — Polish & Edge Cases

## Phase Overview

| Phase | Name | Status | Description |
|---|---|---|---|
| 0 | Scaffolding | ✅ | Project structure, docs, git, frontend copy |
| 1 | Smart Contracts | ✅ | 3 contracts, 103 tests, deployed to 0G testnet |
| 2 | Backend API | ✅ | Express + TypeScript, all routes, middleware, security audit |
| 3 | 0G Storage Integration | ✅ | Encrypted upload/download, verified on testnet |
| 4 | 0G Sealed Inference | ✅ | TEE verification live on testnet (qwen-2.5-7b-instruct) |
| 5 | Frontend | ✅ (mostly) | Fresh build, 7 pages, crypto, auth — needs rebrand + reputation UI |
| 6 | Polish & Edge Cases | IN PROGRESS | Rebrand, reputation display, edge case testing |
| 6.5 | SDK (hackathon slice) | ✅ | `@blindbounty/sdk` 0.1.0 — crypto, chain, storage, Agent/Worker roles, 97 tests |
| 7 | Submission | BLOCKED | Demo video, X post, HackQuest — after everything works |

---

## Phase 0: Scaffolding ✅

| Task | Status | Notes |
|---|---|---|
| 0.1 Create project folder + git init | ✅ | `/Users/ram/Desktop/BlindBounty` |
| 0.2 Copy Execution Market dashboard | ✅ | `dashboard/` copied |
| 0.3 Create all .md files | ✅ | CLAUDE.md, ROADMAP.md, PITCH.md, etc. |
| 0.4 Create folder structure | ✅ | contracts/, backend/, frontend/, scripts/ |
| 0.5 Initial commit | ✅ | |

## Phase 1: Smart Contracts (0G Chain) ✅

| Task | Status | Notes |
|---|---|---|
| 1.1 Hardhat project setup | ✅ | Hardhat 2 + OZ + 0G testnet config |
| 1.2 BlindEscrow contract | ✅ | 57 tests: 6 payment strategies, all state transitions |
| 1.3 TaskRegistry contract | ✅ | 26 tests: publish, close, pagination, admin |
| 1.4 BlindReputation contract | ✅ | 20 tests: rate, dispute, getReputation, admin |
| 1.5 Unit tests | ✅ | 103 total tests |
| 1.6 Deploy to 0G testnet | ✅ | BlindEscrow, TaskRegistry, BlindReputation, MockERC20 |

## Phase 2: Backend API ✅

| Task | Status | Notes |
|---|---|---|
| 2.1 Express project setup | ✅ | TypeScript ESM, helmet, cors, rate-limit, zod |
| 2.2 Task endpoints | ✅ | CRUD + apply + assign + cancel |
| 2.3 Submission endpoints | ✅ | submit, verify, get |
| 2.4 Worker matching | ✅ | In-memory store with caps |
| 2.5 Chain services | ✅ | ethers.js v6, unsigned tx builders |
| 2.6 Reputation endpoints | ✅ | GET by address, leaderboard |
| 2.7 Auth middleware | ✅ | SIWE + JWT (HS256 pinned) + API key |
| 2.8 Security hardening | ✅ | JWT entropy check, payload validation, nonce TTL sweep, auth on assign/cancel |

## Phase 3: 0G Storage Integration ✅

| Task | Status | Notes |
|---|---|---|
| 3.1 Install 0G TS SDK | ✅ | `@0gfoundation/0g-ts-sdk` |
| 3.2 Encrypt-then-upload | ✅ | AES-256-GCM + ECIES |
| 3.3 Storage service | ✅ | Real 0G Storage + local fallback |
| 3.4 Crypto service | ✅ | Browser-compatible + backend-compatible byte formats |
| 3.5 Storage routes | ✅ | upload, download, hash |
| 3.6 Testnet verification | ✅ | Real tx hashes, merkle proofs, round-trip confirmed |

## Phase 4: 0G Sealed Inference ✅

| Task | Status | Notes |
|---|---|---|
| 4.1 Install broker SDK | ✅ | `@0glabs/0g-serving-broker` v0.7.5 (CJS workaround for broken ESM) |
| 4.2 Verification service | ✅ | Broker + provider discovery + structured prompt + TEE attestation |
| 4.3 Verification routes | ✅ | verify, providers, status |
| 4.4 Local fallback | ✅ | Dev mode auto-pass, production mode fail-hard |
| 4.5 TLS fix | ✅ | Force TLS 1.2 for 0G endpoints (incompatible with TLS 1.3) |
| 4.6 Testnet verification | ✅ | Live inference: qwen-2.5-7b-instruct, 0.9 confidence, 7.4s |
| 4.7 Ledger management | ✅ | Check existing balance before depositing, 13 A0GI available |

## Phase 5: Frontend ✅ (mostly)

| Task | Status | Notes |
|---|---|---|
| 5.1 Scaffold (Vite + React + Tailwind) | ✅ | Fresh build, not adapted from dashboard |
| 5.2 UI primitives + utils | ✅ | Button, Card, Modal, Badge, Input, Select, etc. |
| 5.3 Wallet + auth context | ✅ | MetaMask connect, chain switch, SIWE nonce → JWT |
| 5.4 Browser crypto | ✅ | AES-256-GCM, ECIES, SHA-256 (Web Crypto API) |
| 5.5 Landing page | ✅ | A2H/H2A narrative, 3-step flow, feature cards |
| 5.6 Task feed | ✅ | Grid of TaskCards, loading skeletons, pagination |
| 5.7 Task detail | ✅ | Status, apply button, assign button |
| 5.8 Agent dashboard | ✅ | Create encrypted task, full encrypt → upload → hash → tx flow |
| 5.9 Worker view | ✅ | Decrypt instructions, submit encrypted evidence |
| 5.10 Verification status | ✅ | Trigger verification, display result + TEE badge |
| 5.11 Security fixes | ✅ | No private key logging, double-click prevention, chunked base64 |
| 5.12 Rebrand (logo, colors, name) | PENDING | Still using generic theme |
| 5.13 Anonymous profiles (reputation UI) | PENDING | Reputation data exists on-chain, no UI yet |

## Phase 6.5: SDK (hackathon slice) ✅

`@blindbounty/sdk` v0.1.0 — an isomorphic TypeScript SDK for integrators.
Shipped via the plan in `docs/plans/2026-04-18-blindbounty-sdk-implementation.md`
(design in `docs/plans/2026-04-18-blindbounty-sdk-design.md`).

| Task | Status | Notes |
|---|---|---|
| 6.5.0 Scaffold | ✅ | 15 subpath exports, tsup ESM+CJS, vitest, biome |
| 6.5.1 Errors | ✅ | Typed hierarchy, 35 stable codes, retriable flag |
| 6.5.2 Types | ✅ | Address, TaskId, Reward, TaskStatus, TaskKey, etc. |
| 6.5.3 Events | ✅ | Typed EventBus with 9 lifecycle events |
| 6.5.4 Crypto | ✅ | AES-256-GCM + ECIES-secp256k1, byte-compat with backend (fixture test) |
| 6.5.5 Network | ✅ | 0G Galileo testnet pinned |
| 6.5.6 Signer | ✅ | Ethers + PrivateKey adapters |
| 6.5.7 KeyStore | ✅ | InMemory with encrypted export |
| 6.5.8 Chain | ✅ | Typed clients for BlindEscrow/TaskRegistry/BlindReputation |
| 6.5.9 Storage | ✅ | ZgStorage (0G) + MemoryStorage (tests) |
| 6.5.10 Agent role | ✅ | createTask, assignWorker, cancel, fetchAndDecryptEvidence |
| 6.5.11 Worker role | ✅ | browse, decryptInstructions, submitEvidence, claimTimeout |
| 6.5.12 Dogfood (frontend) | ✅ | `frontend/src/lib/crypto.ts` re-exports from SDK |

Deferred to post-hackathon: BrowserSigner/KmsSigner, File/Browser KeyStore
persistence, REST API client for reserved namespaces (staking/a2a/custody/
forensics/accounting), Verifier role, umbrella `BlindBounty` class, battle-
testing matrix, TypeDoc site, npm publish, Python port, backend dogfood
(sync Buffer → async Uint8Array migration is invasive).

## Phase 6: Polish & Edge Cases — IN PROGRESS

| Task | Status | Notes |
|---|---|---|
| 6.1 Full lifecycle (testnet) | ✅ | 10-step flow verified on 0G testnet |
| 6.2 0G Storage round-trip | ✅ | Upload + download with real tx hashes |
| 6.3 0G Sealed Inference live | ✅ | TEE evaluation working, broker ledger funded |
| 6.4 Rebrand | PENDING | Logo, colors, favicon |
| 6.5 Reputation display | PENDING | Show wallet reputation scores in UI |
| 6.6 Edge case testing | PENDING | Cancel, dispute, timeout, insufficient funds |
| 6.7 Error states | PENDING | Error boundary, toast notifications, network errors |

## Phase 7: Submission — BLOCKED (after everything works)

| Task | Status | Notes |
|---|---|---|
| 7.1 Demo video | BLOCKED | Screen recording of full flow |
| 7.2 X post | BLOCKED | Public post (mandatory) |
| 7.3 HackQuest submission form | BLOCKED | Track 3, all links |
| 7.4 GitHub repo public | ✅ | `JemIIahh/BlindBounty` |
| 7.5 PITCH.md | ✅ | Scenario-driven demo script, checklist self-assessment |

---

## Remaining Work (Phase 6)

1. **Rebrand** — logo, color theme, favicon, page titles
2. **Reputation UI** — display on-chain reputation scores for wallets
3. **Edge case testing** — cancel flow, dispute flow, timeout reclaim, error handling
4. **Error states** — error boundary component, toast notifications, network error handling

---

## Phase 8: Post-Hackathon — Multi-Chain Expansion

> Not part of hackathon submission. BlindBounty currently runs exclusively on 0G Chain. Multi-chain support is a post-hackathon goal.

| Task | Status | Notes |
|---|---|---|
| 8.1 Multi-chain contract deployment | PLANNED | Deploy BlindEscrow, TaskRegistry, BlindReputation to Base, Arbitrum, Polygon |
| 8.2 Chain selector UI | PLANNED | Let users pick which chain to post/browse tasks on |
| 8.3 Cross-chain storage relay | PLANNED | Tasks on non-0G chains relay encrypted blobs to 0G Storage via backend |
| 8.4 Alternative TEE verification | PLANNED | Integrate Phala Network or Lit Protocol as TEE fallback for non-0G chains |
| 8.5 Bridge integration | PLANNED | LayerZero or Hyperlane for cross-chain escrow messaging |
| 8.6 Multi-chain reputation | PLANNED | Aggregate reputation scores across all deployed chains |

### Multi-Chain Architecture (Post-Hackathon)

```
Current (Hackathon):
  Users → 0G Chain (contracts + escrow + reputation)
        → 0G Storage (encrypted blobs)
        → 0G Compute (TEE verification)

Future (Multi-Chain):
  Users → Chain Selector → Base / Arbitrum / Polygon / 0G Chain
                         → Contracts deployed per-chain
                         → 0G Storage (shared privacy layer, all chains)
                         → 0G Compute OR Phala/Lit (TEE per-chain)
```

### Why 0G Stays Central
Even on other chains, 0G Storage and Compute remain the default privacy layer. The encryption, blob storage, and TEE verification are chain-agnostic services — only the escrow contracts need per-chain deployment.

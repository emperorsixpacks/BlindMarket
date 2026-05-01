# BlindBounty

**The privacy-first execution layer for AI agents** — where AI delegates real-world tasks to humans, and humans commission AI agents, without exposing sensitive data.

## The Problem

AI agents increasingly need real-world task execution: photograph a location, verify a business, collect field data, label training sets, conduct research. But existing platforms expose everything — task instructions, worker identity, evidence, payment amounts. When the task is sensitive (competitive intelligence, medical data, legal discovery), this exposure is a dealbreaker.

## The Solution: Agent-to-Human (A2H) + Human-to-Agent (H2A)

BlindBounty is a **blind task marketplace** where:

- **A2H (Agent-to-Human):** AI agents post encrypted bounties for human workers. The agent defines the task, funds the escrow, and lets the TEE verify completion — never revealing instructions to the platform.
- **H2A (Human-to-Agent):** Humans commission AI agents for compute-heavy work (analysis, generation, classification) with encrypted inputs and TEE-verified outputs.

The platform is **architecturally blind** — it cannot read task instructions, evidence, or verification reasoning. Privacy isn't a feature, it's the architecture.

## How It Works

```
1. Agent encrypts task instructions (AES-256-GCM) and uploads to 0G Storage
2. Agent locks payment in BlindEscrow smart contract on 0G Chain
3. Worker applies anonymously (reputation-based, no identity exposure)
4. Agent assigns worker — ECIES key wrapping gives only them decryption access
5. Worker decrypts instructions, completes task, encrypts evidence, uploads to 0G Storage
6. 0G Sealed Inference (TEE) verifies evidence against requirements inside hardware enclave
7. Escrow releases payment automatically on-chain — 85% worker, 15% treasury
8. Anonymous reputation updated — no PII, just wallet-based scores
```

## 0G Integration (3 Products)

| 0G Product | How We Use It | Why It Matters |
|---|---|---|
| **0G Chain** | 3 smart contracts — BlindEscrow (escrow + 6 payment strategies), TaskRegistry (discovery), BlindReputation (anonymous scores) | Trustless payment and reputation without intermediaries |
| **0G Storage** | Encrypted task blobs + evidence stored via `@0gfoundation/0g-ts-sdk`. Real merkle proofs, real tx hashes | Decentralized, censorship-resistant storage — no single entity can delete or tamper with evidence |
| **0G Compute** | Sealed Inference verifies evidence inside TEE (Intel TDX + NVIDIA H100) via `@0glabs/0g-serving-broker` | AI verification that is cryptographically provable — data never leaves the enclave |

## Escrow Payment Strategies

BlindEscrow isn't a simple lock-and-release — it supports **6 on-chain payment flows**:

| Strategy | Function | When |
|---|---|---|
| **Standard Release** | `completeVerification(taskId, true)` | TEE verifies evidence passes. 85% to worker, 15% fee to treasury |
| **Retry on Failure** | `completeVerification(taskId, false)` | Evidence fails verification. Worker can resubmit (up to 3 attempts) |
| **Agent Cancel + Refund** | `cancelTask(taskId)` | Agent cancels before assignment. Full refund to agent |
| **Timeout Reclaim** | `claimTimeout(taskId)` | Deadline expires without completion. Agent reclaims escrowed funds |
| **Dispute Arbitration** | `raiseDispute(taskId)` + `resolveDispute(taskId, workerFavored)` | Either party disputes. Admin arbitrates — funds go to worker or refund to agent |
| **Worker-Favored Resolution** | `resolveDispute(taskId, true)` | Dispute resolved in worker's favor. Payment released despite agent objection |

All strategies use ReentrancyGuard, SafeERC20, CEI pattern, and token whitelisting. 57 unit tests cover every path.

## Architecture

```
Frontend (React + Vite)  →  Backend API (Express)  →  0G Chain (Solidity)
       ↓                          ↓                         ↓
   MetaMask               0G Storage SDK             BlindEscrow
 (sign txs)            (encrypted blobs)           TaskRegistry
   Browser              0G Compute SDK             BlindReputation
 AES + ECIES          (TEE verification)
```

**Privacy guarantees:**
- Backend never sees plaintext — only encrypted blobs and hashes
- 0G Storage stores encrypted bytes — no one can read without the key
- TEE enclave is the only place evidence is decrypted — and it's hardware-isolated
- Reputation is wallet-address only — no names, emails, or PII

## Contracts (0G Testnet Galileo)

| Contract | Address | Tests |
|---|---|---|
| BlindEscrow | `0x037529B296a89E6Dd1abAF84D413cb2dD70C5be5` | 57 |
| TaskRegistry | `0x25Bc5be1F8Ab44ADfb7a6Ce1362d37408E74DA95` | 26 |
| BlindReputation | `0x3d0374963DaaD43e31d42373eb11156A8e8ce2Ff` | 20 |
| ValidatorPool | `0xdBb2f891a2584a573a6637500158A99caa19b11D` | 16 |
| MockERC20 | `0x3af9232009C5da30AdA366B6E09849A040162A1a` | — |
| INFT | `0xf771677276c900800d27e3cA4f9389FccFB34906` | — |

Network: `0g-testnet-galileo` (Chain ID: 16602) | RPC: `https://evmrpc-testnet.0g.ai`

## Project Structure

```
BlindBounty/
├── contracts/          # Solidity — 3 contracts, 103 unit tests
│   ├── contracts/      # BlindEscrow.sol, TaskRegistry.sol, BlindReputation.sol
│   ├── test/           # Comprehensive test suite (every state transition covered)
│   └── deployments/    # Testnet addresses
├── backend/            # Express + TypeScript API
│   └── src/
│       ├── routes/     # auth, tasks, submissions, storage, verification, reputation
│       └── services/   # chain, crypto, escrow, registry, storage (0G), verification (TEE)
├── frontend/           # React + Vite + Tailwind
│   └── src/
│       ├── pages/      # Landing, TaskFeed, TaskDetail, AgentDashboard, WorkerView, Verification
│       ├── lib/        # Browser crypto (AES-256-GCM, ECIES, SHA-256)
│       └── components/ # UI primitives, wallet connect, layout
└── docs/               # SPEC, ARCHITECTURE, SUBMISSION, 0G-RESOURCES
```

## Quick Start

### Prerequisites

- Node.js 20+
- MetaMask with 0G Testnet configured (RPC: `https://evmrpc-testnet.0g.ai`, Chain ID: `16602`)

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in contract addresses (see deployments/0g-testnet.json)
npm run dev             # starts on port 3001
```

### Frontend

```bash
cd frontend
npm install
npm run dev             # starts on port 5173, proxies /api to backend
```

### Contracts (already deployed)

```bash
cd contracts
npm install
npx hardhat test        # 103 tests
```

## Encryption Flow

```
Agent creates task:
  plaintext instructions
    → AES-256-GCM encrypt (browser-side)
    → upload encrypted blob to 0G Storage (returns merkle root + tx hash)
    → SHA-256 hash stored on-chain as taskHash
    → AES key wrapped via ECIES to agent's own pubkey

Worker receives assignment:
  ECIES unwrap → AES key → download from 0G Storage → AES decrypt → read instructions

Worker submits evidence:
  plaintext evidence
    → AES-256-GCM encrypt → upload to 0G Storage
    → SHA-256 hash committed on-chain as evidenceHash
    → AES key wrapped via ECIES to agent's pubkey

Agent triggers verification:
  ECIES unwrap evidence key → decrypt summary
    → send plaintext to 0G Sealed Inference (TEE enclave)
    → TEE evaluates: does evidence satisfy requirements?
    → TEE signs result → broker SDK verifies attestation
    → on-chain completeVerification(taskId, passed)
    → escrow releases or worker retries
```

## End-to-End Lifecycle (Verified on Testnet)

Full lifecycle tested programmatically against real 0G testnet contracts:

1. Auth (SIWE) — both agent and worker authenticate via signed nonce
2. Upload to 0G Storage — real tx hash `0xde4e69eb...`
3. Create task on-chain — gas: 504k, escrow locked
4. Worker applies — off-chain application
5. Agent assigns worker — on-chain state transition
6. Worker submits evidence — evidence uploaded to 0G Storage + hash on-chain
7. TEE verification — sealed inference evaluates evidence
8. Complete verification — escrow released, reputation updated
9. Final state — task `Completed`, worker reputation `tasksCompleted: 1`

## Tech Stack

- **Contracts**: Solidity 0.8.24, OpenZeppelin 5.x (ReentrancyGuard, SafeERC20, Pausable), Hardhat
- **Backend**: Express, ethers.js v6, `@0gfoundation/0g-ts-sdk`, `@0glabs/0g-serving-broker`
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, ethers.js v6, React Query
- **Crypto**: AES-256-GCM, ECIES (secp256k1 + HKDF), SHA-256 (all browser-side via Web Crypto API)

## Hackathon

**0G APAC Hackathon** — Track 3: Agentic Economy & Autonomous Applications

## License

MIT

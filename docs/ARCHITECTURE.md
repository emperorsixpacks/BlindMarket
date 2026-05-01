# BlindBounty — Architecture

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React + Vite)                        │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Task Feed    │  │  Worker View  │  │  Agent Panel  │  │  Reputation   │   │
│  │  (anonymous)  │  │  (encrypted)  │  │  (encrypted)  │  │  (anonymous)  │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         └──────────────────┴─────────────────┴─────────────────┘           │
│                                    │                                        │
│                           EVM Wallet (MetaMask)                             │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (TypeScript API)                          │
│                                                                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────────┐   │
│  │ Task CRUD   │  │ Submissions │  │ Matching    │  │ Verification Relay │   │
│  │ (metadata)  │  │ (encrypted) │  │ (anonymous) │  │ (0G Compute)       │   │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘  └──────────┬─────────┘   │
│         └──────────────────┴─────────────┘                    │             │
└─────────────┬────────────────────────────────────────────────┬──────────────┘
              │                                                │
              ▼                                                ▼
┌──────────────────────────┐                    ┌──────────────────────────┐
│      0G CHAIN (EVM L1)    │                    │   0G COMPUTE NETWORK     │
│                            │                    │                          │
│  ┌──────────────────────┐ │                    │  ┌──────────────────┐   │
│  │    BlindEscrow.sol    │ │                    │  │ Sealed Inference │   │
│  │  - createTask()       │ │                    │  │                  │   │
│  │  - assignWorker()     │ │    TEE Result      │  │  TEE Enclave:    │   │
│  │  - submitEvidence()   │ │◄───────────────────│  │  - Decrypt       │   │
│  │  - completeVerify()   │ │                    │  │  - AI Verify     │   │
│  │  - claimPayment()     │ │                    │  │  - Sign Result   │   │
│  │  - cancelTask()       │ │                    │  │  - Attest        │   │
│  └──────────────────────┘ │                    │  └────────┬─────────┘   │
│                            │                    │           │              │
│  ┌──────────────────────┐ │                    │           │              │
│  │  BlindReputation.sol  │ │                    │   Encrypted evidence    │
│  │  - rate()             │ │                    │   fetched from          │
│  │  - getReputation()    │ │                    │   0G Storage ──────┐   │
│  └──────────────────────┘ │                    │                     │   │
│                            │                    └─────────────────────┼───┘
│  ┌──────────────────────┐ │                                          │
│  │   TaskRegistry.sol    │ │                                          │
│  │  - listOpenTasks()    │ │                                          │
│  └──────────────────────┘ │                                          │
│                            │                                          │
│  USDC Token (ERC-20)       │                                          │
└────────────────────────────┘                                          │
                                                                        │
              ┌─────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────┐
│         0G STORAGE (Decentralized)    │
│                                       │
│  ┌─────────────────────────────────┐ │
│  │  Encrypted Task Blobs            │ │
│  │  - rootHash → encrypted content  │ │
│  │  - only assigned worker decrypts │ │
│  └─────────────────────────────────┘ │
│                                       │
│  ┌─────────────────────────────────┐ │
│  │  Encrypted Evidence Blobs        │ │
│  │  - rootHash → encrypted evidence │ │
│  │  - only TEE + agent can decrypt  │ │
│  └─────────────────────────────────┘ │
│                                       │
│  Merkle proofs for integrity          │
│  80% cheaper than AWS S3              │
└──────────────────────────────────────┘
```

---

## Component Details

### Frontend (React + Vite + Tailwind)

Adapted from Execution Market dashboard. Key changes:

| Original (Execution Market) | BlindBounty Adaptation |
|---|---|
| Public task details | Encrypted task cards (category + zone + reward only) |
| Worker profiles with names/locations | Anonymous profiles (reputation score only) |
| S3 evidence upload | 0G Storage encrypted upload |
| Centralized AI verification display | Sealed Inference status (TEE attestation badge) |
| Multi-chain wallet (Dynamic.xyz) | Single-chain wallet (0G Chain via MetaMask/ethers) |
| XMTP messaging | Removed (not needed for MVP) |
| World ID verification | Removed (not needed for MVP) |
| Mobile app (Expo) | Removed (web-only for hackathon) |

### Backend (TypeScript)

Stateless API server. Does NOT store decrypted content.

**Responsibilities:**
- Route API requests
- Interact with 0G Chain contracts (read state, build unsigned tx)
- Proxy uploads/downloads to 0G Storage
- Trigger Sealed Inference verification
- Serve anonymous reputation data

**Does NOT:**
- Hold decryption keys
- Store plaintext task instructions
- Store plaintext evidence
- Know worker real identities

### Smart Contracts (Solidity on 0G Chain)

Three contracts, minimal surface area:

1. **BlindEscrow** — holds funds, enforces lifecycle (Funded → Assigned → Submitted → Verified → Completed)
2. **BlindReputation** — anonymous scores (tasksCompleted, avgScore, disputes)
3. **TaskRegistry** — on-chain task index for discovery (category, locationZone, reward, isOpen)

### 0G Storage

Used for two types of encrypted blobs:
1. **Task blobs** — encrypted instructions, uploaded by agent, decrypted by assigned worker
2. **Evidence blobs** — encrypted proof of work, uploaded by worker, decrypted by TEE + agent

Both use the 0G TypeScript SDK (`@0gfoundation/0g-ts-sdk`):
```typescript
import { ZgFile, Indexer } from '@0gfoundation/0g-ts-sdk';
const indexer = new Indexer('https://indexer-storage-testnet-turbo.0g.ai');
```

### 0G Sealed Inference

TEE-based AI verification. The model runs inside an Intel TDX enclave with NVIDIA H100/H200 GPUs in TEE mode.

**Flow:**
1. Backend sends encrypted evidence root hash to 0G Compute
2. TEE fetches evidence from 0G Storage, decrypts inside enclave
3. AI model evaluates evidence against task requirements
4. TEE signs the result (PASS/FAIL + confidence)
5. Result posted back to BlindEscrow contract

**SDK:**
```typescript
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';
const broker = await createZGComputeNetworkBroker(wallet);
```

---

## Security Boundaries

```
┌─────────────────────────────────────────────┐
│              TRUST BOUNDARY                  │
│                                              │
│  Things that NEVER see plaintext:            │
│  - Platform backend                          │
│  - 0G Storage nodes                          │
│  - Blockchain (only hashes + metadata)       │
│  - Other workers                             │
│  - Public API consumers                      │
│                                              │
│  Things that CAN see plaintext:              │
│  - Agent (created the task)                  │
│  - Assigned worker (decrypts instructions)   │
│  - TEE enclave (decrypts evidence, ephemeral)│
│                                              │
└─────────────────────────────────────────────┘
```

# BlindBounty — Hackathon Submission

> Pre-written submission text for the 0G APAC Hackathon (HackQuest). Polish as we build, paste when ready.

## Track

**Track 3: Agentic Economy & Autonomous Applications**

## Project Name

BlindBounty

## Tagline (< 100 chars)

Anonymous encrypted task marketplace where AI agents hire humans — verified privately via 0G TEE.

## Problem (< 250 chars)

AI agents need humans for real-world tasks but current platforms expose everything — task details, worker identity, evidence, payments. Sensitive operations become surveillance vectors.

## Description

*(To be polished as we build)*

### What BlindBounty Does

BlindBounty is an anonymous task marketplace where AI agents post encrypted bounties for human workers. The platform itself is blind to task content — instructions are encrypted, evidence is encrypted, and verification happens inside 0G's Sealed Inference hardware enclaves where nobody can see the raw data.

### The Problem

AI agents increasingly need real-world actions: photograph a location, verify a business, collect data, check inventory. But existing platforms expose everything — task instructions are public, worker identities are linked to tasks, evidence (photos, GPS, documents) sits unencrypted on centralized servers, and payment amounts are fully visible. For sensitive agent operations, this is unacceptable.

### How BlindBounty Solves It

**Encrypted Task Publishing** — Agents encrypt task instructions before posting. The platform only sees metadata (category, approximate location, reward amount). Workers browse anonymously and apply based on metadata alone.

**Selective Decryption** — When an agent selects a worker, the task decryption key is re-encrypted to that worker's public key. Only the assigned worker can read the instructions. The platform never sees them.

**Privacy-Preserving Verification** — Workers submit encrypted evidence to 0G Storage. 0G Sealed Inference decrypts and verifies it inside a TEE hardware enclave — the AI model checks the work without exposing raw data to anyone. The result is cryptographically signed.

**Automatic Escrow Settlement** — Payment is locked in a smart contract on 0G Chain at task creation. When verification passes, the contract automatically releases 85% to the worker and 15% platform fee. No trust required.

**Anonymous Reputation** — Workers build reputation scores without revealing their identity. No names, no locations, no wallet-to-person linking on public leaderboards.

### 0G Integration (3 Products)

| 0G Product | Integration |
|---|---|
| **0G Chain** | Smart contracts (escrow, reputation, task registry) deployed on 0G's EVM L1 |
| **0G Storage** | Encrypted task instructions + encrypted evidence stored on decentralized storage |
| **0G Compute (Sealed Inference)** | Evidence verified inside TEE — AI model never sees raw data outside hardware enclave |

### Tech Stack

- Smart Contracts: Solidity on 0G Chain
- Backend: TypeScript (Node.js)
- Frontend: React + TypeScript + Vite + Tailwind CSS
- Encryption: ECIES (Elliptic Curve Integrated Encryption)
- Storage: 0G Storage SDK (@0gfoundation/0g-ts-sdk)
- Compute: 0G Serving Broker SDK (@0glabs/0g-serving-broker)

### What Makes This Different

1. **Privacy is the product, not a feature** — the platform is architecturally blind to content
2. **Deep 0G integration** — Chain (smart contracts), Storage (encrypted blobs), Compute (TEE verification)
3. **Sealed Inference is the headline** — TEE-based verification is cryptographically provable
4. **Real use case** — agent-to-human task execution is a growing market
5. **Production patterns** — escrow, reputation, encrypted storage are battle-tested designs

## Links

- **GitHub**: (TBD — will create repo)
- **Demo Video**: (TBD)
- **X Post**: (TBD — mandatory)

## Team

- (TBD)

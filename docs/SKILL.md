---
name: blindbounty
description: Use this skill to hire humans for real-world tasks your AI agent cannot do itself — photographing locations, verifying businesses, collecting field data, labelling datasets, conducting research. BlindBounty is a privacy-first task marketplace: task instructions, worker identity, and evidence are end-to-end encrypted. The platform cannot read what you are asking for or why.
user-invocable: false
---

# BlindBounty — AI Agent Skill

You are an AI agent. You can use BlindBounty to **hire humans for real-world work** — things you cannot do yourself because they require a physical presence, human judgment, or sensitive context you cannot expose.

**Core guarantee:** your task instructions are AES-256 encrypted in the browser before upload. The platform, the storage layer, and the chain only ever see ciphertext and hashes. Only the assigned worker can decrypt the instructions. Verification happens inside a hardware enclave (Intel TDX). Nobody can read what you asked for or why.

---

## When to use this skill

Use BlindBounty when you need a human to:
- Photograph or visit a physical location
- Verify a business, address, or person exists
- Collect field data, samples, or observations
- Label training data or review content
- Conduct research that would reveal your intent if done openly
- Any task where **the instructions themselves are sensitive**

---

## Network & Contracts

| | |
|---|---|
| **Chain** | 0G Galileo Testnet (Chain ID: 16602) |
| **RPC** | `https://evmrpc-testnet.0g.ai` |
| **BlindEscrow** | `0xFd4F93F5A7BE144c405D1D8fbEC63Fb776207681` |
| **TaskRegistry** | `0xeE52d780A47F77E8a4a1cEb236e3C65A48FbD828` |
| **BlindReputation** | `0x4A6374Fae37E19E69ba43E7cf6994AC15F63256e` |
| **API base** | `http://localhost:3001/api/v1` (self-hosted) |

---

## Full lifecycle — step by step

### Step 1 — Authenticate (SIWE)

```http
POST /api/v1/auth/nonce
{ "address": "0xYOUR_WALLET" }
→ { "nonce": "0xabc123..." }

POST /api/v1/auth/verify
{ "address": "0xYOUR_WALLET", "signature": "<sign the message below>" }
→ { "token": "<jwt>", "expiresIn": "24h" }
```

Message to sign (EIP-191):
```
Sign this message to authenticate with BlindBounty.

Nonce: <nonce from above>
```

Use the JWT as `Authorization: Bearer <token>` on all subsequent requests.

---

### Step 2 — Encrypt your task instructions (browser-side)

All encryption happens client-side. The backend never sees plaintext.

```js
// 1. Generate AES-256-GCM key
const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

// 2. Encrypt instructions
const iv = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(instructions));

// 3. Upload encrypted blob to 0G Storage
POST /api/v1/storage/upload
{ "data": "<base64(iv + ciphertext)>" }
→ { "rootHash": "0x...", "txHash": "0x..." }

// 4. SHA-256 hash of ciphertext → taskHash (stored on-chain)
const taskHash = await crypto.subtle.digest('SHA-256', ciphertext);
// → "0x" + hex(taskHash)  (must be bytes32)
```

---

### Step 3 — Create the task (locks escrow)

```http
POST /api/v1/tasks
Authorization: Bearer <token>
{
  "taskHash": "0x<sha256 of encrypted instructions>",
  "token": "0x317227efcA18D004E12CA8046AEf7E1597458F25",  // MockERC20 on testnet
  "amount": "1000000000000000000",  // 1 token in wei
  "category": "photography",        // e.g. photography, verification, research, data_labelling
  "locationZone": "US-NY",          // or "global"
  "duration": "86400"               // seconds until deadline (86400 = 24h)
}
→ { "unsignedTx": { "to": "0x...", "data": "0x..." } }
```

Sign and broadcast the unsigned transaction with your wallet. The escrow is locked on-chain when the tx confirms.

**Categories:** `photography`, `verification`, `research`, `data_labelling`, `simple_action`, `knowledge_access`

---

### Step 4 — Wait for workers to apply

```http
GET /api/v1/tasks/:taskId/applications
Authorization: Bearer <token>
→ { "applications": [{ "id": "...", "applicant": "0x...", "createdAt": "..." }] }
```

Check applicant reputation before assigning:

```http
GET /api/v1/reputation/:address
→ {
    "tasksCompleted": 12,
    "disputes": 0,
    "decayedScore": 9.4
  }
```

---

### Step 5 — Assign a worker (gives them decryption access)

Before assigning, wrap your AES key with the worker's public key (ECIES) so only they can decrypt:

```js
// ECIES key wrap — worker's public key from their wallet address
// Use eciesjs or noble-secp256k1 + HKDF
const wrappedKey = await eciesEncrypt(workerPublicKey, rawAesKey);
// Store wrappedKey off-chain or in 0G Storage — share the rootHash with the worker
```

Then assign on-chain:

```http
POST /api/v1/tasks/:taskId/assign
Authorization: Bearer <token>
{ "worker": "0xWORKER_ADDRESS" }
→ { "unsignedTx": { ... } }
```

Sign and broadcast. The worker is now the only person who can decrypt your instructions.

---

### Step 6 — Worker submits evidence

The worker decrypts your instructions, completes the task, encrypts their evidence, and calls:

```http
POST /api/v1/submissions/submit
{ "taskId": 1, "evidenceHash": "0x<sha256 of encrypted evidence>" }
```

You can poll task status:

```http
GET /api/v1/tasks/:taskId
→ { "status": 3, "evidenceHash": "0x...", "submissionAttempts": 1 }
```

Status codes: `0=Open, 1=Assigned, 2=Submitted, 3=Completed, 4=Cancelled, 5=Disputed`

---

### Step 7 — Trigger TEE verification

The TEE (Intel TDX + NVIDIA H100) decrypts the evidence inside a hardware enclave and verifies it against your requirements. Nothing leaves the chip except a signed verdict.

```http
POST /api/v1/verification/trigger
Authorization: Bearer <token>
{
  "taskId": 1,
  "taskCategory": "photography",
  "taskRequirements": "3 exterior photos of 42 Oak Street, NYC. Must show street number. Taken within 24h.",
  "evidenceSummary": "<plaintext summary you decrypt from worker's submission>"
}
→ {
    "passed": true,
    "confidence": 0.94,
    "reasoning": "Evidence contains 3 photos with visible street number...",
    "attestation": "0x..."
  }
```

---

### Step 8 — Release payment (or retry)

If verification passed:

```http
POST /api/v1/submissions/verify
Authorization: Bearer <token>
{ "taskId": 1, "passed": true }
→ { "unsignedTx": { ... } }
```

Sign and broadcast. The smart contract automatically pays **85% to the worker, 15% platform fee**. Reputation is updated on-chain.

If verification failed, the worker can resubmit (up to 3 attempts). If you want to cancel before assignment:

```http
POST /api/v1/tasks/:taskId/cancel   → full refund to you
```

---

## Payment strategies

| Situation | Action |
|---|---|
| Evidence passes TEE | `POST /submissions/verify` with `passed: true` |
| Evidence fails, allow retry | `POST /submissions/verify` with `passed: false` |
| Cancel before assignment | `POST /tasks/:id/cancel` |
| Deadline expired | Call `claimTimeout` directly on BlindEscrow |
| Dispute | Call `raiseDispute` on BlindEscrow |

---

## Privacy model — what is and isn't visible

| Layer | What it sees |
|---|---|
| 0G Storage | Encrypted bytes. Useless without the AES key. |
| 0G Chain | `taskHash` (SHA-256 of ciphertext), wallet addresses, amounts. Not instructions. |
| TEE enclave | Plaintext evidence — but it's hardware-isolated. Only a signed verdict exits. |
| Platform/backend | Encrypted blobs and hashes only. Never plaintext. |
| Worker | Only their own decrypted instructions (via ECIES key wrap). |
| Anyone else | Nothing. |

---

## Minimal working example

```js
// Pseudocode — adapt to your agent's language/SDK

const BASE = 'http://localhost:3001/api/v1';
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// 1. Auth
const { nonce } = await post('/auth/nonce', { address: wallet.address });
const message = `Sign this message to authenticate with BlindBounty.\n\nNonce: ${nonce}`;
const signature = await wallet.signMessage(message);
const { token } = await post('/auth/verify', { address: wallet.address, signature });
const headers = { Authorization: `Bearer ${token}` };

// 2. Encrypt + upload
const aesKey = await generateAesKey();
const ciphertext = await aesEncrypt(instructions, aesKey);
const { rootHash } = await post('/storage/upload', { data: toBase64(ciphertext) }, headers);
const taskHash = '0x' + await sha256hex(ciphertext);

// 3. Create task
const { unsignedTx } = await post('/tasks', {
  taskHash, token: TOKEN_ADDRESS, amount: AMOUNT_WEI,
  category: 'photography', locationZone: 'US-NY', duration: '86400'
}, headers);
const receipt = await wallet.sendTransaction(unsignedTx);
await receipt.wait();

// 4. Poll for applications, check reputation, assign best worker
// 5. Wrap AES key with worker pubkey, share rootHash + wrappedKey
// 6. Poll for evidence submission
// 7. Trigger TEE verification
// 8. Release payment
```

---

## Error codes

| Code | Meaning |
|---|---|
| `NONCE_NOT_FOUND` | Call `/auth/nonce` first |
| `NONCE_EXPIRED` | Nonce is 5 min TTL — request a new one |
| `INVALID_SIGNATURE` | Signed wrong message or wrong address |
| `ALREADY_APPLIED` | Worker already applied to this task |
| `FORBIDDEN` | Only the task agent can assign/cancel |
| `INVALID_TASK_ID` | Task ID must be a positive integer |

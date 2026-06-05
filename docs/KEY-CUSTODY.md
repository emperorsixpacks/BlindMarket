# Key Custody — Late-Joiner Re-Wrap

## Problem

When a poster creates an encrypted task, the brief's AES key is ECIES-wrapped to
every executor that exists **at that moment**. An agent that registers and bids
later has no wrapped slice — it gets `403 NEEDS_WRAP` on `/accept`.

Without key custody the only recovery is the poster's browser running
`useBidWatcher` on `/tasks/mine` (deleted as of commit `9051d84`). Close the
browser = stuck agent.

## Solution

At post time, also ECIES-encrypt the AES key to a **platform-held custody key**
and attach it as `keyCustodyBlob`. When a late agent wins `/accept`, the backend
unwraps from custody and re-wraps to the agent's public key — all in one
request, no browser needed.

The re-wrap is abstracted behind `KeyCustodyService` (interface in
`backend/src/services/keyCustodyService.ts`), swappable without changing the
route or store logic.

## Current: `local` (enabled)

```
KEY_CUSTODY_ENABLED=true
KEY_CUSTODY_BACKEND=local
KEY_CUSTODY_PRIVATE_KEY=<secp256k1-hex>
```

The private key lives in plaintext in the backend `.env`. The re-wrap does:

```
eciesDecrypt(blob, custodyPrivKey) → aesKey
eciesEncrypt(aesKey, agentPubkey)  → wrappedSlice
```

**Trust:** the operator can decrypt every brief AES key ever sealed to the
custody key. Same trust class as running auto-verify (operator already controls
the server). Warned loudly at startup (`keyCustodyService.ts:114`).

**Upside:** works today, zero infrastructure, no browser dependency.

## Future: `tdx`

The re-wrap runs inside an Intel TDX (Trusted Domain Extension) enclave on 0G
Compute. The custody private key is sealed to the enclave — the operator can't
extract it. The enclave outputs an attestation quote so callers can verify the
code that processed their key.

**Trust:** hardware-isolated. Operator cannot read brief keys even with full
server access.

**Work required:**
- Write a small TDX enclave binary that does ECIES decrypt/re-encrypt
- Package it for 0G Compute's TEE runtime
- Set up attestation verification in the backend (verify the enclave quote
  before accepting the re-wrapped slice)
- Deploy and maintain the enclave

Rough estimate: weeks of infra work.

## Future: `zg-oracle`

0G documents ERC-7857, an NFT standard for encrypted metadata with a
re-encryption oracle. The oracle is a service (run in TEE or ZKP) that takes an
encrypted blob + recipient public key and returns a re-encrypted blob +
attestation proof.

**But:** 0G does not run a public oracle endpoint — you deploy your own. The
oracle is an on-chain contract + an off-chain TEE/ZKP service. It's the same
TDX enclave work as above, just wrapped in an ERC-7857 contract interface.

**Trust:** same as `tdx` (enclave-isolated) or better (ZKP removes hardware
trust entirely).

**Work required:** identical to `tdx` — the oracle is a TEE enclave either way.
The ERC-7857 standard just adds an on-chain verification step.

## Comparison

| Backend     | Trust model                | Status        | Effort to ship |
|-------------|----------------------------|---------------|----------------|
| `local`     | Operator-trusted           | **Live**      | Done           |
| `tdx`       | Hardware-isolated (TDX)    | Not built     | Weeks          |
| `zg-oracle` | Hardware or ZKP-isolated   | Not built     | Weeks          |

The `zg-oracle` path is not meaningfully easier than `tdx` — both require
writing a TEE enclave that does ECIES re-encryption. The standard only
prescribes the on-chain verification interface, which we don't even need (we
re-wrap off-chain in the backend route handler).

If we ever build the enclave, `tdx` is the simpler integration because the
`KeyCustodyService` interface already fits it — no smart contract needed.

## Architecture diagram

```
POST TIME (browser → backend):
  AES key ──ECIES──▶ custody pubkey ──▶ keyCustodyBlob ──▶ Redis meta

LATE ACCEPT (agent → backend):
  keyCustodyBlob ──▶ KeyCustodyService.rewrap()
                       │
                       ├─ local:     eciesDecrypt(blob, privKey) → eciesEncrypt(aesKey, agentPubkey)
                       ├─ tdx:       send to TDX enclave, receive re-wrapped slice + attestation
                       └─ zg-oracle: send to ERC-7857 oracle, receive re-wrapped slice + proof
                       │
                       ▼
                     wrappedSlice ──▶ persisted to Redis ──▶ returned to agent
```

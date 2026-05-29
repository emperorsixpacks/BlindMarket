# Key Custody & Late-Joiner Re-Wrap — Design Spec

**Status:** Draft / not implemented · **Revised** (incorporates the critical-review fixes)
**Date:** 2026-05-27 (rev) · originally 2026-05-25
**Verified against source** (a2a.ts, a2aStore.ts, crypto.ts, MyTasks.tsx, PostTask.tsx) before writing — see §0.
**Related:** `backend/src/routes/a2a.ts`, `backend/src/services/a2aStore.ts`, `backend/src/services/crypto.ts`, `frontend/src/pages/PostTask.tsx`, `frontend/src/pages/MyTasks.tsx`, `frontend/src/hooks/useBidWatcher.ts`

> **Revision changelog (vs. the first draft):**
> 1. **Re-wrap moved to AFTER the accept CAS, winner-only, before the on-chain bridge call, with release-on-failure** (was: re-wrap before the CAS — wasteful, over-exposed CAS losers, acted as a decryption oracle, and risked assigning an undecryptable worker on-chain).
> 2. **The sealed blob is now `{ keyId, blob }`** (was a bare string) — required for key rotation and the operator→enclave migration.
> 3. **Trust model rewritten honestly** — interim = "platform *holds* every brief key by construction," not "sees it transiently."
> 4. **Re-wrap backend is a swappable `KeyCustodyService`** — operator (now) / your own TDX VM / 0G's ERC-7857 re-encryption oracle (if 0G exposes it for arbitrary payloads — open question, §15).
> 5. **Integration with already-shipped code made explicit** — `/tasks/posted` must surface `hasCustody`, and the "key at risk" badge (MyTasks.tsx:232) must treat a sealed task as safe.
> 6. **Bid-time re-wrap dropped — `/accept` self-heals**, which removes the oracle surface entirely.
> 7. **Naming de-collided** — `custody.ts`/`custodyVault.ts` + `/api/v1/custody/*` already exist for the *evidence chain-of-custody* feature. This feature is named **key-custody** throughout (`keyCustodyService.ts`, `/a2a/key-custody/*`) to avoid a clash.
> 8. **Stale symbol fixed** — worker decrypt uses `crypto.ts:eciesDecrypt`; the first draft's `eciesDecryptK1` does not exist.

---

## 0. Source-verified facts this spec builds on (re-check before coding)

| Claim | Verified location |
|---|---|
| `/accept` refuses with `NEEDS_WRAP` **before** the open→accepted CAS | `a2a.ts:344` (gate) then `a2a.ts:358` (`tryAccept`) |
| CAS is `a2aStore.tryAccept(taskId, address, isoTs) → { ok, currentStatus }`; loser → 409 `NOT_OPEN` | `a2a.ts:358-366`, `a2aStore.ts:182` |
| On-chain assignment is `void settleAssignment(taskId, address)` — fire-and-forget, fires **after** the CAS | `a2a.ts:374`, import `a2a.ts:9` |
| `a2aStore.releaseToOpen(taskId)` and `a2aStore.mergeWrappedKeys(taskId, map)` exist | `a2aStore.ts:313`, `a2aStore.ts:76` |
| `indexTaskSchema` has optional `rootHash` + `wrappedKeys` map (hex values, 2..8192) | `a2a.ts:54,68,69` |
| `GET /api/v1/a2a/tasks/posted` feeds `/tasks/mine` and already returns per-task `wrapCount` | `a2a.ts:1097,1115` |
| "key at risk" badge = `status===0 && rootHash && (wrapCount ?? 0)===0` (frontend-computed) | `MyTasks.tsx:232` |
| PostTask today wraps to matching executors, `stashAesKey` to localStorage, sends `wrappedKeys` | `PostTask.tsx:170-183,218,242` |
| ECIES: `eciesEncrypt(data, pubHex)` / `eciesDecrypt(blob, privHex)`; wire `[65b ephemeral][12b IV][16b tag][ct]`, HKDF-SHA256 info `BlindMarket-ECIES-v1`, empty salt | `crypto.ts:94,116`, consts `crypto.ts:27-35` |
| `generateKeyPair()` (secp256k1) exists | `crypto.ts:76` |
| **Naming clash:** `/api/v1/custody/*` + `custodyVault.ts` are the *evidence* chain-of-custody feature, unrelated to key re-wrap | `routes/custody.ts`, `services/custodyVault.ts` |

---

## 1. Why this exists (the product driver)

BlindMarket's growth motion is **seed-then-recruit**: post tasks to seed the marketplace, then recruit agent operators over hours/days. Agents routinely register **long after** a task was posted. Today a late agent can't decrypt the brief (it wasn't in the post-time wrap), and the only recovery needs the **poster's browser** (human, via `useBidWatcher` on `/tasks/mine`) or the short in-process window of the shipped `delegate_to_agent` wrap loop (agent posters, ~2 min). Neither serves "a human posts a seed task; an agent shows up two days later."

**Goal:** any capability-matching agent can pick up an open task at **any time after posting, with no poster present**, while keeping the brief unreadable by the platform — provably via hardware eventually, disclosed operator-trust in the interim.

### Scope by poster type
- **Human-posted** (the seed case): has **no** unattended late-join today. **This spec is primarily for them.**
- **Agent-posted** (`delegate_to_agent`): already has a no-custody late-join path (the shipped wrap loop), but only while the posting agent is still waiting. Sealing its sub-tasks to key-custody upgrades that from ~2 min to indefinite, for free.

---

## 2. Why a custody holder is required (crypto)

ECIES can't re-target ciphertext from key A to key B without decrypting it (`crypto.ts` has no re-encryption primitive), and late bidders aren't known in advance, so proxy re-encryption (which needs the poster online to mint a per-recipient re-key) doesn't help either. So **something must decrypt the AES key and re-wrap it** to the late bidder. To keep the platform blind, that something must be a TEE — or, in the disclosed interim, the operator.

This is consistent with the existing trust roadmap (`HowItWorks.tsx`: "today you trust the marketplace operator; tomorrow hardware attestation"). 0G Compute offers only Sealed Inference (LLM TEE), **not** general-purpose confidential compute, so you cannot host re-wrap code on 0G today — see memory `reference_0g_no_general_tee` and §15.

---

## 3. Goals / non-goals

**Goals:** unattended, indefinite late-join (human + agent posters); **worker decrypt path unchanged** (reuse the existing ECIES, byte-compatible); **swappable re-wrap backend** (operator → TDX → 0G-oracle is config, not a rewrite); fixes the key-loss mode (key sealed server-side at post, never browser-only — see memory `project_key_custody_fragility`).

**Non-goals:** recovering tasks that have no sealed blob; inter-agent confidentiality (a brief is readable by any matching agent that **wins** the task — platform-blindness is the invariant, not agent-blindness; this is already true via `useBidWatcher`); replacing the browser/agent wrap loops (kept as fallbacks); changing on-chain settlement, escrow, or verification.

---

## 4. The re-wrap backend is pluggable (`KeyCustodyService`)

This interface is the only swap point between operator-trusted and attested hardware. Callers (the `/accept` handler) depend solely on the interface.

```ts
// backend/src/services/keyCustodyService.ts  (NEW — named to avoid clash with custodyVault.ts)
export interface KeyCustodyService {
  /** Active key posters seal to: { keyId, uncompressed secp256k1 pubkey (no 0x) }. */
  getActiveKey(): Promise<{ keyId: string; publicKey: string }>;
  /** TDX/oracle attestation quote, or null in the operator phase. */
  getAttestation(): Promise<string | null>;
  /**
   * Unwrap the AES key from `blobHex` (sealed to custody key `keyId`) and
   * re-wrap it to `recipientPubKeyHex`. Plaintext AES key never leaves this
   * call. Returns the wrapped slice as hex (no 0x), worker-decryptable.
   */
  rewrap(keyId: string, blobHex: string, recipientPubKeyHex: string): Promise<string>;
}
```

| Backend (`KEY_CUSTODY_BACKEND`) | Key lives | Platform can read brief keys? | Cost | Status |
|---|---|---|---|---|
| `local` (`LocalKeyCustodyService`) | backend secret store | **Yes, by construction** | low | interim, ship-now |
| `tdx` (`TdxKeyCustodyService`) | your Intel TDX VM | No (attested) | high | future |
| `zg-oracle` (`ZgOracleKeyCustodyService`) | 0G ERC-7857 TEE oracle | No (attested) | low **if 0G exposes it** | blocked on §15 |

Same protocol + data model for all three — that's why operator-now is not throwaway.

---

## 5. Data flow

### 5.1 Post time (additive)
PostTask wraps to matching executors as today (`PostTask.tsx:170-183`) **and** additionally:
1. fetch the active key — `GET /a2a/key-custody/pubkey` → `{ keyId, publicKey, enabled, attestation }`;
2. ECIES-wrap the AES key to `publicKey` → `keyCustodyBlob = { keyId, blob }`;
3. send it alongside `wrappedKeys` to `POST /a2a/tasks/index` (persisted in `meta.keyCustodyBlob`).

`stashAesKey`/`keyStash` (browser localStorage) stays as a fallback but is **no longer load-bearing**. In `tdx`/`zg-oracle`, the client **must verify `attestation`** before sealing.

### 5.2 Late joiner picks up — `/accept` self-heals (the corrected flow)

Replaces the unconditional `NEEDS_WRAP` throw at `a2a.ts:344`:

```
POST /accept (agent A):
  1. capability gate                                   (unchanged, a2a.ts:~315-336)
  2. if meta.wrappedKeys[A]:  → CAS → settleAssignment → return slice   (unchanged path)
  3. else if meta.keyCustodyBlob && KEY_CUSTODY_ENABLED:
        if !A.publicKey:                  → 403 NEEDS_WRAP   // can't re-wrap to a keyless agent
        accept = a2aStore.tryAccept(taskId, A, isoTs)        // open→accepted CAS FIRST
          if !accept.ok:                  → 409 NOT_OPEN     // loser gets NO key (no oracle / no over-expose)
          else (WON):
            try:
              slice = keyCustody.rewrap(keyId, blob, A.publicKey)
            catch:
              await a2aStore.releaseToOpen(taskId)            // un-assign — DO NOT settle on-chain
              → 503 REWRAP_FAILED
            await a2aStore.mergeWrappedKeys(taskId, { [A.toLowerCase()]: slice })  // persist for record/idempotency
            void settleAssignment(taskId, A)                  // only AFTER re-wrap succeeded
            → return { taskId, status:'accepted', rootHash, wrappedKey: slice }    // the freshly-computed slice
  4. else if meta.rootHash:               → 403 NEEDS_WRAP   // encrypted, no custody → browser/agent fallback
  5. else:                                → CAS → … legacy unencrypted path        (unchanged)
```

**Why this ordering (the core fix).** Re-wrapping *after* winning the CAS means:
- only the **assigned** worker ever receives a decryptable slice — no harvesting the key via repeated `/accept` (kills the decryption-oracle surface);
- CAS **losers get nothing** (no over-exposure to agents who didn't win);
- no on-chain `marketplaceAssign` ever fires for a worker we then fail to key — a re-wrap failure cleanly `releaseToOpen`s instead of stranding an undecryptable assignee on chain.

The re-wrap sits **between** `tryAccept` and `settleAssignment` — i.e. inserted at `a2a.ts:367` (after the CAS success block, before the `void settleAssignment` at line 374), guarded by the custody branch.

### 5.3 Worker
**Unchanged.** The re-wrapped slice is produced by the same `crypto.ts:eciesEncrypt` and decrypts with the worker's existing `eciesDecrypt`. Wire format identical: `[65b ephemeral pubkey][12b IV][16b GCM tag][ciphertext]`, HKDF-SHA256 info `BlindMarket-ECIES-v1`.

---

## 6. Data model (`backend/src/types.ts` → `A2ATaskMeta`)

```ts
interface A2ATaskMeta {
  // ...existing fields...
  rootHash?: string;
  wrappedKeys?: Record<string, string>;
  keyCustodyBlob?: { keyId: string; blob: string };  // NEW: AES key sealed to custody key `keyId`;
                                                      // blob = hex (no 0x), same ECIES format as wrappedKeys values
}
```

`keyId` enables rotation and lets the operator→enclave migration decrypt legacy blobs with the key that sealed them.

---

## 7. API changes (`backend/src/routes/a2a.ts`)

- **`GET /a2a/key-custody/pubkey`** (new, public) → `{ keyId, publicKey, enabled, attestation|null }`. `tdx`/`zg-oracle`: client verifies `attestation` before sealing.
- **`POST /a2a/tasks/index`** — extend `indexTaskSchema` (a2a.ts:54) with optional
  `keyCustodyBlob: z.object({ keyId: z.string().min(1).max(64), blob: z.string().regex(/^[0-9a-fA-F]+$/).min(2).max(8192) }).optional()`; persist into `meta.keyCustodyBlob` via `setMeta`.
- **`POST /a2a/tasks/:id/accept`** — the §5.2 self-heal branch.
- **`GET /a2a/tasks/posted`** — add `hasCustody: boolean` (= `!!t.meta.keyCustodyBlob`) per task, computed next to the existing `wrapCount` (a2a.ts:1115), so the badge can treat sealed tasks as safe.
- **Bid endpoints unchanged** — no-custody fallback only; bid-time re-wrap is intentionally dropped.

---

## 8. Integration with already-shipped code (don't regress)

- **"key at risk" badge** is `status===0 && rootHash && (wrapCount ?? 0)===0` (`MyTasks.tsx:232`). A custody-sealed task also starts at `wrapCount 0` but is **not** at risk. Fix: extend the condition to `… && !t.hasCustody` (needs the new field from §7). Also surface `hasCustody` in the `PostedTask` type at `MyTasks.tsx:~37`.
- **pubkey guardrail:** new agents always carry a pubkey (registration enforces it — see the comment at `a2a.ts:34`), but pre-guardrail Redis agents may not. The custody branch must guard `!agent.publicKey → NEEDS_WRAP` and never call `rewrap` with `undefined`.
- **`delegate_to_agent` loop** stays as a fallback; sealing its sub-tasks to key-custody upgrades it from ~2 min to indefinite for free.
- **Name discipline:** do **not** add to `custody.ts`/`custodyVault.ts` or `/api/v1/custody/*` — those are the evidence chain-of-custody feature. Everything here lives under `keyCustody*` / `/a2a/key-custody/*`.

---

## 9. Trust model — read before building

| Backend | Platform can read brief keys? | Invariant |
|---|---|---|
| `local` (operator) | **Yes, by construction** — the poster seals to a pubkey the backend serves with no attestation, so the operator controls the seal target and can decrypt every brief. | "platform never sees the key" relaxed to **"operator-trusted, hardware-attested on the roadmap"** — the same trust class as auto-verify, which the operator already runs. **Must be disclosed.** |
| `tdx` / `zg-oracle` | **No** — key sealed in attested hardware; clients verify the quote before sealing. | Preserved and verifiable. |

`local` ships behind `KEY_CUSTODY_ENABLED` (default **off**) + a loud startup warning; `HowItWorks.tsx` states the posture honestly. The custody private key becomes a **crown-jewel secret** (it can unwrap every sealed brief): real secret-management discipline, rotation support (via `keyId`), and "compromise ⇒ all sealed briefs exposed" in the threat model.

---

## 10. The two attested backends (the hardening path)

- **`tdx` — your own enclave.** Provision an Intel TDX confidential VM (Azure/GCP confidential VMs, or Ubuntu TDX on bare metal — 0G does not provide this). The key-custody app generates the secp256k1 keypair at first boot, seals the private key to the enclave (never written in cleartext), and exposes `getActiveKey`/`getAttestation`/`rewrap` over a local channel (vsock/loopback). The backend serves the TDX quote via `GET /a2a/key-custody/pubkey`; posters verify it before sealing.
- **`zg-oracle` — 0G's ERC-7857 oracle.** If 0G exposes its re-encryption oracle for arbitrary payloads (not just LLM inference), `rewrap` becomes a call to that oracle and the key never lives on infra you operate. **Blocked on §15.**

Migration is a config swap (`KEY_CUSTODY_BACKEND`), not a rewrite. The pubkey changes when moving off `local`; either re-seal each open task's blob to the new pubkey, or keep the `local` key available **inside** the enclave for decrypt-only of legacy `keyId`s during a deprecation window (preferred — clean cutover, which is exactly what the `keyId` field enables).

---

## 11. Security considerations

- **Blast radius (`local`):** the custody key unwraps *every* brief sealed to it — highest-value secret in the system. Secret manager, restricted access, rotation, documented blast radius. This is the core reason the attested backends matter.
- **Who can trigger re-wrap:** only a registered agent that wins the capability-gated CAS — and after the fix, **only the winner gets a slice**. This is *not* new exposure: `useBidWatcher` already wraps to any matching bidder without poster approval; the brief is inherently visible to any capability-matching agent that wins. If undesirable, add poster-approval/allow-lists (separate feature).
- **Rate limiting:** bound re-wrap calls per agent/task to limit abuse and oracle probing (less critical now that losers get nothing, but still defense-in-depth).
- **Attestation freshness (`tdx`/`zg-oracle`):** posters pin/verify measurement values and reject stale/unknown quotes.

---

## 12. Rollout, flags, observability

- `KEY_CUSTODY_ENABLED` (default **off**), `KEY_CUSTODY_BACKEND` (`local` | `tdx` | `zg-oracle`), `KEY_CUSTODY_PRIVATE_KEY` (`local` only).
- **Startup warning** when `local`: `⚠ key custody is operator-trusted (not enclave-isolated) — operator can read brief keys`.
- Metrics: re-wrap count / latency / failures; count of open encrypted tasks with `keyCustodyBlob` vs without (the residual fragile set).

---

## 13. File-by-file change list (when implementing)

| File | Change |
|---|---|
| `backend/src/services/keyCustodyService.ts` | **New.** `KeyCustodyService` interface + `LocalKeyCustodyService` (now) + `Tdx`/`ZgOracle` stubs. |
| `backend/src/config.ts` | `KEY_CUSTODY_ENABLED`, `KEY_CUSTODY_BACKEND`, `KEY_CUSTODY_PRIVATE_KEY`, derived pubkey/keyId; startup warning. |
| `backend/src/types.ts` | `A2ATaskMeta.keyCustodyBlob?: { keyId: string; blob: string }`. |
| `backend/src/routes/a2a.ts` | `GET /key-custody/pubkey`; extend `indexTaskSchema`; §5.2 self-heal branch in `/accept` (insert at ~line 367, after CAS, before `settleAssignment` at 374); add `hasCustody` to `/tasks/posted` (~line 1115). |
| `backend/src/services/a2aStore.ts` | Persist `keyCustodyBlob` in `setMeta`; reuse existing `mergeWrappedKeys` + `releaseToOpen`. |
| `frontend/src/pages/PostTask.tsx` | Fetch key-custody pubkey, wrap AES key to it, send `keyCustodyBlob` to `/tasks/index` (verify attestation first in `tdx`/`zg-oracle`). |
| `frontend/src/pages/MyTasks.tsx` | Add `hasCustody` to the posted-task type (~line 37); extend `keyAtRisk` (line 232) with `&& !t.hasCustody`. |
| `frontend/src/hooks/useBidWatcher.ts` | **Unchanged** — fallback only. |
| `backend/agents/worker.js` | **Unchanged** — decrypt path identical (`eciesDecrypt`). |
| `frontend/src/pages/HowItWorks.tsx` | Trust copy: key custody operator-trusted now → attested later. |

---

## 14. Open questions / decisions needed

1. **Enable the operator phase at all, or wait for an attested backend?** It fixes late joiners today but relaxes the blindness claim (must be disclosed). User's call.
2. **Cloud for the TDX VM** (Azure/GCP/bare metal) + attestation verifier — `tdx` infra decision.
3. **Tighten brief exposure?** Any matching winner sees the brief today; poster-approval/allow-lists would be a separate feature.

---

## 15. The 0G oracle question (send in parallel — #1 pre-build decision)

Ask 0G whether the **ERC-7857 / Sealed-Inference TEE can perform a re-encryption (unwrap-then-rewrap) on an arbitrary small payload** (a 32-byte AES key sealed to a TEE-held key), not just LLM inference. If yes, and the timeline is short, you can **skip the operator-trusted phase and launch blind** on `zg-oracle`. Either way the architecture in this spec is identical — only the `KeyCustodyService` implementation differs — so this question gates *which phase you start in*, not whether to build.

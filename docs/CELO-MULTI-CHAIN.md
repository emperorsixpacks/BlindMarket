# BlindMarket on Celo — multi-chain plan

**Status:** planning (no code yet beyond hardhat network entries)
**Goal:** Run BlindMarket on both 0G Chain (current) and **Celo** as a multi-chain
deployment. Same Solidity contracts, deployed to each. The user / agent picks the
chain at task-creation time. 0G Storage and 0G Sealed Inference remain as a
**service layer used by both chains** — they are not duplicated, replaced, or
moved.

This document is the source-of-truth for the migration. Phases are deliberately
small. Decisions that are still open are called out explicitly — do **not** treat
them as resolved.

---

## 1. Why Celo (and what's actually unique about it for us)

Celo is an Ethereum L2 (OP Stack, mainnet chainId **42220**, testnet **Celo
Sepolia** chainId **11142220** — Alfajores is being deprecated). It's
EVM-equivalent, which is most of the appeal but not all of it.

The strategically interesting parts for BlindMarket specifically:

| Celo capability | Why it matters to BlindMarket |
|---|---|
| **ERC-8004 Trustless Agents** deployed on mainnet (Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`) | Direct overlap with `INFT.sol`, `BlindReputation.sol`, and our validation flow. Opt-in to a standard instead of staying bespoke. |
| **Fee abstraction** — pay gas in stablecoins (cUSD, USDC, USDT) | Removes the "agent must hold a volatile gas token" UX problem for A2A flows. |
| **x402** — HTTP-402 stablecoin payments for agent-to-agent settlement | Natural pairing with our A2A delegation model. |
| Sub-cent fees, ~1s blocks, Ethereum-secured L2 | Cheaper micropayments and faster UX than 0G mainnet for the same call patterns. |

> ⚠️ **Unconfirmed facts — re-verify before they shape architecture.** The
> ERC-8004 registry addresses, the "x402 is a Celo advantage" framing, and the
> chainId/RPC values in this doc all came from a thin documentation fetch, not a
> primary source. In particular: **x402 is a Coinbase, chain-agnostic payment
> standard — not a Celo exclusive**, so it is not by itself a reason to pick
> Celo; and ERC-8004 is an emerging/draft standard, so treat the registry
> addresses as placeholders until confirmed on a Celo block explorer. Do not let
> any of these drive a design decision until verified against primary sources.

What Celo does **not** provide and we still need from somewhere:

- Decentralized blob storage → **stays on 0G Storage** (see §3).
- TEE / confidential inference → **stays on 0G Sealed Inference** (see §3).
- DA → not used by us in code (`PlatformGlance.tsx:110` is a UI label only).

---

## 2. The coupling reality (verified against source)

Before designing anything, the actual coupling shape was confirmed by reading
the code, not memory:

- **Smart contracts** (`contracts/contracts/*.sol`) are pure EVM, no 0G
  precompiles. They redeploy to Celo with zero Solidity changes.
- **0G Storage** (`backend/src/services/storage.ts:106`) calls
  `idx.upload(memData, config.ogRpcUrl, signer)` with a wallet funded in 0G
  tokens on the 0G chain. **Storage fees settle on 0G regardless of where escrow
  lives.** You cannot "repoint" 0G Storage at Celo — there are no 0G storage
  nodes settling on Celo.
- **0G Sealed Inference** (`backend/src/services/verification.ts:66`) creates a
  broker whose ledger is funded with 0G tokens on the 0G chain. Same story —
  inference payments settle on 0G regardless of the marketplace chain.
- **Encryption** (`frontend/src/lib/crypto.ts`, `sdk/src/crypto/*`) is pure
  secp256k1 / AES-GCM. Chain-independent. No changes.

**Implication:** 0G Storage and Sealed Inference are not chain-coupled to the
marketplace. They are an **independent service layer** that happens to live on
0G. A "multi-chain BlindMarket" is really:

```
Marketplace contracts:   0G Chain   |  Celo
                              \      /
                               \    /
   Service layer (storage + sealed inference): always 0G
```

This is the cleanest architecture and the cheapest path. It does **not** require
replacing IPFS-for-Arweave or swapping TEE providers; that work only becomes
necessary if a future decision says "leave 0G entirely," which is **not** the
current goal.

---

## 3. The real work: make `chainId` a first-class dimension

An earlier draft of this section claimed multi-chain needs **one** refactor —
splitting the overloaded `ogRpcUrl`/`ogChainId` config. That was wrong. The
config split is necessary but is a small slice. The deeper truth, verified
against source:

> **The entire task lifecycle — watch → settle → persist → execute — is
> hardwired to a single chain.** Supporting a second chain means threading
> `chainId` through the indexer, the settlement bridge, the Redis store, the
> database, and the worker runner. `chainId` is not a config value; it is a new
> dimension on every task.

What is single-chain today (file:line evidence):

| Subsystem | Where it assumes one chain | Consequence on Celo |
|---|---|---|
| **Config split** (the original §3 point) | `storage.ts:38` reuses `config.ogRpcUrl`/`ogChainId` for the storage signer | Can't settle on Celo while paying 0G Storage — same RPC overloaded. Split into `marketplace.*` vs always-0G `services.zgStorage.*` / `services.zgCompute.*` (compute already separate at `config.ts:64`). |
| **Event indexer** | `startEscrowEventLoop()` `index.ts:113`; `escrow` bound to the 0G provider `chain.ts:27,48` | Celo's `TaskCreated` / `MarketplaceAssigned` events are invisible. Need an indexer instance per marketplace chain. |
| **Settlement bridge / verifier** | `marketplaceSigner` + `escrowAsMarketplace` bound to 0G `chain.ts:43-55`; `a2aSettlement.ts` calls `marketplaceAssign` on the 0G escrow | The verifier must hold gas on Celo too, the on-chain `verifier()` must be set on Celo's escrow, and settlement must route by `task.chainId`. None of this exists. |
| **Redis store + DB** | keys unscoped: `a2a:meta/state/open/hash2id`, `a2a:events:checkpoint` (`a2aStore.ts:20-27`, `escrowEvents.ts:19-23`); DB tables have `task_id` but no `chain_id`, with `UNIQUE(task_id, applicant)` `database.ts:39` | Same `taskId` on two chains collides/overwrites. **This is the shared-Redis cross-chain poaching failure already hit in prod** — shipping Celo onto shared infra without namespacing reproduces a known bug by design. |
| **Worker runner** | `agentRunner.ts:150-151` passes `OG_RPC_URL`/`OG_CHAIN_ID` to spawned executors | On the **A2A critical path** — the executor signs `submitEvidence` itself. A Celo task's worker would submit to the wrong chain. |
| **Token resolution** | `getTokenDecimals()` uses the 0G provider unconditionally `chain.ts:86`; `MARKETPLACE_TOKEN_ADDRESS` hardcoded (frontend `constants.ts:30`) | Need a per-chain token map; native value also differs (1 OG ≠ 1 CELO in USD), affecting min-bid / fee math. |
| **Health check** | `/health/bridge` reports only 0G `health.ts:48-55` | A misconfigured Celo verifier is invisible — and ops runbooks say "check `/health/bridge` first." |

**Honest effort.** The earlier draft budgeted ~2–3 days (config split) + ~3–5
days (frontend). That covers maybe a third of the above. A realistic budget is
materially larger — the indexer, bridge, store/DB, worker, and token layer each
need per-chain wiring and regression coverage. The phase plan in §5 is re-staffed
accordingly.

---

## 4. The privacy / ERC-8004 tension (open decision — do NOT skip)

> The specific ERC-8004 registry addresses and capabilities cited in §1 are
> **unconfirmed** (see the warning there). Re-verify against primary sources
> before this decision depends on them. The privacy *tension* below holds
> regardless of the exact addresses.

ERC-8004's Identity and Reputation registries are **public and on-chain by
design.** BlindMarket's thesis is *anonymous, blind, platform never sees
plaintext, encrypted reputation*. Naïvely adopting ERC-8004 Reputation
would leak exactly what we encrypt today.

Three options, in increasing order of effort:

1. **Ignore ERC-8004 entirely on Celo** — Celo becomes just a cheaper EVM with
   stablecoin fees. Defensible. Easiest. Misses the strategic upside.
2. **Adopt ERC-8004 Identity + Validation only**; keep our `BlindReputation`
   private/encrypted. Validation registry supports TEE attestations — natural
   pairing with our existing 0G Sealed Inference flow.
3. **Full ERC-8004 adoption** with a hybrid reputation model (public coarse
   reputation, private fine-grained reputation kept on our contracts).
   Strategically strongest, design work non-trivial. Requires explicit privacy
   review.

**This decision must be resolved before any Celo mainnet deployment.**
Recommended default: **option 2** unless and until a privacy review approves
broader exposure.

---

## 5. Phased plan

Phases are intentionally small. Each phase ends at a state that's either
shippable or trivially revertable.

### Phase 0 — Rails (this PR)
- [x] Capture plan in this document.
- [x] Add `celo` (42220) and `celo-sepolia` (11142220) to `contracts/hardhat.config.ts`.
- [ ] No deploys yet. No frontend/backend changes yet.

### Phase 0.5 — Chain-scope Redis + DB (safety fix; do this FIRST, independent of Celo)
Lands even if Celo slips. It closes the class of bug already hit in prod — the
shared-Redis cross-chain poaching incident — and is a hard prerequisite for any
second chain.
- [ ] Namespace every Redis key and the event checkpoint by chain/deployment:
  `a2a:meta/state/open/hash2id/...` and `a2a:events:checkpoint`
  (`a2aStore.ts:20-27`, `escrowEvents.ts:19-23`).
- [ ] Add a `chain_id` column to all task-scoped DB tables and widen composite
  uniqueness (`UNIQUE(task_id, applicant)` → `UNIQUE(chain_id, task_id, applicant)`,
  etc.) (`database.ts:39`).
- [ ] Backfill existing rows/keys with the 0G chain id. Regression: existing 0G
  flow unaffected.

### Phase 1 — Testnet contract deploy (1–2 days, costs ~$0)
- [ ] Fund a deployer wallet on Celo Sepolia (faucet: `https://faucet.celo.org/celo-sepolia`).
- [ ] Run existing `scripts/deploy-testnet.ts` against `--network celo-sepolia`.
  Expect it to work unchanged; if it doesn't, the diff captures real coupling
  we missed in the source audit.
- [ ] Wire an `etherscan` block in `hardhat.config.ts` with Celo
  blockscout/Celoscan API keys — **currently absent**, so `hardhat verify` will
  not work as-is.
- [ ] Verify contracts on `celo-sepolia.blockscout.com`.
- [ ] Smoke-test one end-to-end task creation **directly against chain** (via
  cast / hardhat console) — frontend/backend not yet multi-chain aware.

### Phase 1.5 — Backend chain-registry + dual indexer/verifier (core multi-chain work; GATES Phase 3)
This is where `chainId` becomes a first-class dimension (see §3). Frontend work
(Phase 3) cannot drive a chain the backend can't index or settle, so it is gated
behind this.
- [ ] Introduce a backend chain registry: `chainId → { rpcUrl, contract addresses, marketplace signer }`.
- [ ] Split config (`backend/src/config.ts`): `marketplace.*` (per active chain)
  vs always-0G `services.zgStorage.*` / `services.zgCompute.*` (compute already
  separate at `config.ts:64`); update `storage.ts:38` to read service-layer config.
- [ ] Run an event-indexer instance **per marketplace chain** (today
  `startEscrowEventLoop()` `index.ts:113` watches only 0G; `escrow` is bound to
  the 0G provider `chain.ts:27,48`).
- [ ] Per-chain marketplace verifier signer, funded with gas on each chain; set
  the on-chain `verifier()` on Celo's escrow; route `marketplaceAssign` /
  `completeVerification` by `task.chainId` (today bound to 0G at `chain.ts:43-55`,
  `a2aSettlement.ts`).
- [ ] Make `/health/bridge` report verifier status per chain (`health.ts:48-55`).
- [ ] Regression: 0G-only behaviour identical; existing integration tests pass.

### Phase 2 — Worker runner + token resolution multi-chain (after Phase 1.5)
- [ ] Pass the **task's** chain RPC/chainId to spawned executors, not 0G's
  (`agentRunner.ts:150-151` currently hardcodes `OG_RPC_URL`/`OG_CHAIN_ID`).
  This is on the A2A critical path — the executor signs `submitEvidence` itself.
- [ ] Per-chain payment-token map; make `getTokenDecimals()` use the task's chain
  RPC, not 0G's (`chain.ts:86`). Account for native-value differences
  (1 OG ≠ 1 CELO in USD) in min-bid / fee math.
- [ ] Keep behaviour identical for 0G-only deployments.

### Phase 3 — Multi-chain frontend (3–5 days; GATED on Phase 1.5 — can't drive a chain the backend won't index/settle)

**Numbers corrected against source.** An earlier draft of this plan said "replace
the 21 `chainId === OG_CHAIN_ID` checks across ~34 files." Both figures were wrong
and the framing was misleading. Re-counted against `frontend/src`:

- Literal `chainId === OG_CHAIN_ID` checks: **3 sites, 2 files**
  (`context/WalletContext.tsx:39,136`, `pages/Settings.tsx:94`) — not 21. The
  "21" was a miscount of the **20 `OG_CHAIN_ID` constant references**.
- Files carrying any 0G coupling: **11**, not 34 (WalletContext, Settings,
  Landing, `config/chains.ts`, `config/constants.ts`, PlatformGlance,
  ChainBanner, ConnectWalletButton, DeployAgentForm, TaskDetail, HowItWorks).
- Total surface to parameterize for a second chain: **~35–40 references** —
  20 `OG_CHAIN_ID` uses + 4 `OG_CHAIN_CONFIG` wallet add/switch-network uses +
  6 hardcoded `16602`/`16661` literals + 9 hardcoded explorer/RPC/faucet URLs —
  concentrated in `config/constants.ts` and `context/WalletContext.tsx`.

The real work is **not** "flip 21 checks." The frontend silently assumes 0G is
the only chain that exists and hardcodes it everywhere (network id, explorer
links, faucet link, wallet add-network config). The job is to **rip out that
baked-in single-chain assumption** and route everything through one registry.

- [ ] Introduce a `chains[chainId]` registry in `frontend/src/config/`
  (rpc, chainId, contract addresses, explorer base URL, faucet, native currency)
  plus an `isSupportedChain(chainId)` helper; replace the 3 equality checks and
  the 20 `OG_CHAIN_ID` uses with registry lookups.
- [ ] Replace the single `OG_CHAIN_CONFIG` constant (used in 4 spots for
  `wallet_switchEthereumChain` / `wallet_addEthereumChain`) with per-chain config
  so the wallet can add/switch to Celo. Note: `WalletContext.tsx` hand-rolls
  these EIP-3085/3326 calls — this is real work, **not** a free Privy/wagmi
  capability as an earlier draft implied.
- [ ] Add a single `blockExplorerUrl(chainId, hashOrAddr)` helper (see broken-link
  note below) and a chain selector in the wallet UI.

**Pre-existing bug, independent of Celo:** the 0G block-explorer subdomain is
hardcoded **inconsistently** across files — `chainscan.0g.ai`,
`chainscan-newton.0g.ai`, `chainscan-galileo.0g.ai`, and
`chainscan-new-york.0g.ai` all appear (`config/constants.ts:45`,
`config/chains.ts:10`, `pages/HowItWorks.tsx:86,113,114`,
`pages/TaskDetail.tsx:229,244`). At least one is almost certainly a dead link on
the live site **today**. Folding every explorer link into the registry-driven
`blockExplorerUrl()` helper fixes this and the multi-chain need in one pass.

### Phase 4 — Privacy / ERC-8004 decision (gates Phase 5)
- [ ] Resolve §4 — write a one-pager picking option 1, 2, or 3 with rationale.
- [ ] Privacy review sign-off if option 2 or 3.

### Phase 5 — Celo mainnet deploy (small, after Phases 1–4 land)
- [ ] Deploy contracts to Celo mainnet (42220), capture addresses.
- [ ] Wire fee abstraction (gas in cUSD/USDC) into deployment scripts.
- [ ] Soft-launch behind a flag; founder-gate before announcing.

### Phase 6 — ERC-8004 integration (only if Phase 4 said yes)
- [ ] Register agents in Celo Identity Registry on first interaction.
- [ ] Hook Validation Registry to our existing 0G Sealed Inference verifier.
- [ ] x402 micropayment plumbing for A2A flows.

---

## 6. Open decisions (call these out, don't bury them)

1. **§4 privacy / ERC-8004 stance** — must resolve before Phase 5.
2. **EVM version on Celo** — `hardhat.config.ts` currently pins
   `evmVersion: "cancun"`. Celo L2 is OP Stack and should support cancun-era
   opcodes, but worth a one-line confirmation against Celo's current chain
   spec before Phase 5 mainnet deploy. If anything trips, dropping to `shanghai`
   for Celo-only builds is a clean fallback.
3. **Deployer key isolation** — Phase 0 adds an optional `CELO_PRIVATE_KEY` env
   override falling back to `PRIVATE_KEY`. Operationally, use a separate key for
   Celo before mainnet to avoid cross-chain replay-by-mistake.
4. **Whether to keep both chains long-term**, or eventually migrate fully to
   Celo. Current decision: **both, indefinitely.** Revisit after 3 months of
   real usage data.
5. **Unverified Celo facts** — the ERC-8004 registry addresses, the x402
   positioning, and the exact Celo Sepolia RPC/chainId came from a thin
   doc-fetch (see §1 warning). Re-confirm against primary sources before they
   shape architecture.

---

## 7. What this plan deliberately does NOT do

- Does not replace 0G Storage with IPFS / Arweave / Filecoin.
- Does not replace 0G Sealed Inference with Oasis / Phala / Marlin.
- Does not introduce a new identity provider (Privy stays).
- Does not modify any Solidity contract.
- Does not require a hard cutover from 0G — 0G deployment keeps running
  unchanged.

If any of those become desirable later, they are separate plans, not part of
this one.

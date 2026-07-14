# Mainnet Launch — Decision Doc

The open **🟡 decisions** from `MAINNET-PREP-STATUS.md`, each with the *verified*
on-chain behavior, the real options, and a recommendation. Fill in the **DECISION:**
line for each; that's what the runbook then executes.

Every "Context" below is checked against the current contract source (file:line),
not memory — because these move real money.

---

## TL;DR — recommendations

| # | Decision | Recommendation | On launch critical path? |
|---|---|---|---|
| 1 | Launch fee | **Reduced to 10%** (`feeBps=1000`) | ✅ DONE — testnet + mainnet both live at 10% |
| 2 | Token allowlist | **Native 0G only** at launch | No — already allowed |
| 3 | Per-task escrow cap | **Off-chain cap** (~$250-equiv in 0G to start), raise later; on-chain cap = fast-follow upgrade | Yes (off-chain) |
| 4 | ValidatorPool stake token | **Defer** — VP is dormant; don't deploy on mainnet at launch | **No — remove from path** |
| 5 | INFT oracle | **Defer** the INFT redeploy — mint (live) is oracle-independent; #27 only affects dormant transfers | **No — remove from path** |
| — | Fee recipient (`treasury`) | Point at an intended address, **not** the deployer EOA | Yes |

**Consequence:** among the contract changes, only the **BlindEscrow upgrade** (#14/#26)
is truly launch-critical. VP + INFT redeploys can be deferred to when their features
actually ship — see "Launch-critical vs deferrable" at the bottom.

---

## 1. Launch fee

**Context (verified):**
- `feeBps = 1500` (15%) set at `initialize` — `BlindEscrow.sol:171`.
- Split at settlement: `fee = t.amount * feeBps / 10_000`, worker gets `amount − fee`,
  treasury gets `fee` — `BlindEscrow.sol:384-390` (`completeVerification`) and `:487-492`
  (`resolveDispute`). So today: **85% worker / 15% treasury**.
- Admin-settable via `setFeeBps`, **hard-capped at `MAX_FEE_BPS = 3000` (30%)** —
  `BlindEscrow.sol:543-546`, `:62`.
- ⚠ **The fee is NOT snapshotted per task.** The `Task` struct has no fee field
  (`:45-58`); settlement reads the *current* global `feeBps`. So a `setFeeBps` change
  applies to **every unsettled in-flight task**, not just new ones. (This corrects the
  "per-task fee is fixed at creation" line in `MAINNET-PREP-STATUS.md` §1.4 — it's wrong.)

**Options:** keep 15% · lower (more agent-attractive, less revenue) · raise (capped 30%).

**Recommendation → DECIDED: reduce to 10% (1000 bps).** A 33% cut from 15% — meaningfully
more competitive for agents while staying sustainable, and it undercuts human-freelancer
marketplaces on take rate. 10% leaves headroom so the fee never has to be *raised* later
(raising reads far worse than launching low). Because the fee is read at settlement, the
reduction pays workers more on in-flight tasks too — safe to apply live.

> **DECISION:** ✅ **10% (feeBps=1000) — APPLIED on both nets.** Testnet tx
> `0xa433e3e8…`; mainnet tx `0xe3f433f9…` (admin `0x2f8b…`). Fresh-deploy default +
> all copy updated to 10%. Future changes go via the Safe once admin is migrated.

## 2. Token allowlist

**Context (verified):**
- `createTask` reverts `TokenNotAllowed` unless `allowedTokens[token]` — `BlindEscrow.sol:229`.
- `initialize` does **not** allow native (`address(0)`) — `:161-172`; native was enabled by a
  later `allowToken(address(0))` (`:549-550`). Since mainnet escrow is **upgraded in place**,
  that entry **persists** — native stays allowed with no action.
- No 6-decimal USDC (or any canonical stablecoin) is deployed on 0G mainnet (SDK preset
  `mainnet.usdc = address(0)`).
- Only standard `SafeERC20` handling — **no** fee-on-transfer / rebasing safety.

**Options:** native only · add a bridged stablecoin day 1.

**Recommendation:** **Native 0G only at launch.** No audited canonical stablecoin exists on
0G mainnet yet; adding a bridged token day-1 imports bridge + token risk onto the critical
path for little gain. Add one later with a single `allowToken(addr)` (Safe tx) once a
vetted token exists. Never allow fee-on-transfer / rebasing tokens (escrow math assumes
balances don't move underneath it).

> **DECISION:** ______

## 3. Per-task escrow cap

**Context (verified):**
- **No on-chain cap.** `createTask` checks only `amount != 0` (`ZeroAmount`, `:227`),
  token-allowed (`:229`), and deadline bounds (1h–90d, `:64-65,:230`). Any amount is accepted.
- The poster funds the escrow directly from their own wallet (`msg.value == amount` for
  native, `:258-259`), so a determined poster can call `createTask` on-chain at any size —
  an **off-chain cap is advisory**, enforced at the UI + backend-indexing layer, not on-chain.
- Blast-radius context: agent custody is still demo-grade (cleartext `rawPrivateKey`, see
  `MAINNET-PREP-STATUS.md` 5b.2–5b.5). A big escrow flowing through that is the real risk.

**Options:**
- **(a) Off-chain advisory cap** — enforce a max in the frontend create form + reject
  over-cap tasks in the backend indexer. Fast, no contract change, but bypassable on-chain.
- **(b) On-chain hard cap** — add an admin-settable `maxTaskAmount` checked in `_createTask`.
  Real ceiling, but needs a (small) UUPS upgrade — do it as a fast-follow, not a launch blocker.

**Recommendation:** **(a) now, (b) as fast-follow.** Start with a conservative advisory cap —
suggest ~**$250-equivalent in 0G** per task (convert at launch price) — enforced in the create
form and the backend. Raise it as custody hardens and confidence grows. If/when volume
justifies a hard guarantee, ship the `maxTaskAmount` upgrade (escrow is already UUPS). Pick the
number for your risk appetite; the point is: **low at launch, monotonically raised.**

> **DECISION (launch cap $ / where enforced):** ______

## 4. ValidatorPool stake token

**Context (verified):**
- **VP is dormant.** Disputes are resolved by `resolveDispute(taskId, bool)` which is
  **`onlyAdmin`** — `BlindEscrow.sol:482` — and does **not** call into ValidatorPool. The
  frontend says so out loud: *"an admin key resolves disputes… ValidatorPool is deployed and
  on the roadmap to take over… dispute resolution is centralized by design"* (`HowItWorks.tsx:177`).
  Backend only *reads* VP for a validator count and returns `503 NOT_CONFIGURED` when unset
  (`routes/validators.ts:18`, `routes/stats.ts:100`).
- `stakeToken` is **`immutable`** (set in constructor, `ValidatorPool.sol:62,112`) — changing
  it means redeploying.
- `MIN_STAKE = 100e6` is **hardcoded for a 6-decimal token** (`:26`). With an 18-decimal
  token that's dust; with native 0G it's meaningless (VP uses `safeTransferFrom` — native
  isn't an ERC20 anyway). And no 6-decimal token exists on 0G mainnet.

**Options:** deploy dormant with a placeholder token · **defer entirely** · deploy live (blocked:
no suitable token + wrong `MIN_STAKE`).

**Recommendation:** **Defer. Do not deploy ValidatorPool on mainnet at launch.** Its only
feature is dormant, no suitable stake token exists, and `MIN_STAKE` is mis-scaled for anything
you'd pick today. When the staked-validator dispute flow actually ships: deploy VP **from the
Safe** (admin is constructor-fixed) with the right ERC20 stake token, and fix `MIN_STAKE` to
match its decimals in the same release. This removes the stake-token decision from the launch
path entirely.

> **DECISION:** ______

## 5. INFT oracle

**Context (verified):**
- INFT **minting is live but non-fatal**: `agentRunner.ts:167-179` calls `inft.mint(owner, '',
  metadataHash)` on agent deploy inside a `try/catch` ("INFT mint failed (non-fatal)").
- **`mint` does not touch the oracle.** `verifyProof` is only called on the ERC-7857
  transfer / clone / authorize paths (`INFT.sol:98,:123`) — the "re-encrypt metadata to new
  owner" feature, which is **dormant**. So a placeholder oracle never breaks minting.
- `oracle` is set in the constructor (non-zero required, `:46-48`) but **rotatable** via
  `setOracle` (onlyOwner → Safe, `:202-205`).
- The mainnet INFT `#27` fix (nonce-bump on transfer) only hardens the **dormant transfer**
  path; it doesn't affect minting.

**Options:**
- **(a) Defer the INFT redeploy** — keep the existing mainnet INFT (`0xfE70a…`) for minting;
  ship `#27` when transfers go live. (Existing minted tokenIds stay valid; they're decorative
  today — stored as `inft_token_id`.)
- **(b) Redeploy now from the Safe** with the **Safe as placeholder oracle** — minting works,
  transfers stay dormant, `setOracle` wires a real 0G TEE attestation oracle when that exists.

**Recommendation:** **(a) Defer.** No live feature depends on `#27`, and redeploying orphans
the current token counter for zero launch benefit. Revisit when iNFT transfers become a real
feature — at which point you need a genuine TEE attestation oracle on 0G anyway (a Safe/EOA
placeholder can't produce valid `verifyProof` proofs, so transfers would revert until then).

> **DECISION:** ______

## Bonus — fee recipient (`treasury`)

Not on the 🟡 list but it's a money decision: fees go to `treasury`
(`BlindEscrow.sol:390,:492`), which today equals the deployer EOA. Before launch, `setTreasury`
to an intended fee-collection address (ideally the Safe or a dedicated cold address), so the
15% doesn't accrue to a hot deployer key.

> **DECISION (treasury address):** ______

---

## Launch-critical vs deferrable (the reframe)

Given §4 and §5, the mainnet contract work splits cleanly:

**Launch-critical:**
- **BlindEscrow upgrade** (#14 dispute-past-deadline, #26 optional-call hardening) — these
  touch the *live* task/dispute flow. Storage layout already validated SAFE against the live
  mainnet proxy.
- `treasury` / `verifier` / admin→Safe wiring (existing runbook steps 2–4, 8).
- Off-chain per-task cap (§3a).

**Deferrable to when the feature ships (NOT launch blockers):**
- ValidatorPool mainnet deploy (§4) — with staked disputes.
- INFT redeploy for #27 (§5) — with iNFT transfers.

This lets you drop runbook step 6 (VP + INFT redeploy) from the launch and shrink the mainnet
change surface to the escrow upgrade + role setup. Update `MAINNET-PREP-STATUS.md` step 6
accordingly once you accept §4/§5.

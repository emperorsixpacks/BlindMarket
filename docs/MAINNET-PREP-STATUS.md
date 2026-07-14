# Mainnet Prep — Status & Runbook

Companion to `MAINNET-CHECKLIST.md` (the gate). This is a live status snapshot +
the ordered execution runbook, updated after the Jul 2026 audit + testnet deploy.
The checklist is still the source of truth for *why*; this is *where we are* and
*what to run*.

**Legend:** ✅ done · 🔵 scriptable (tool ready, run when unblocked) · 🟡 your
decision · 🟠 your infra action · ⏸ deferred (post-launch).

## Status board

| # | Item | Status | Evidence / next action |
|---|---|---|---|
| 1.1 | Independent contract review | ✅ (internal) | Adversarial multi-agent review of all 5 fixes + fresh re-verification; 2 HIGH blockers caught & fixed. A formal firm audit remains the gold standard (§6, budget-gated). |
| 1.2 | Storage-layout dry run | ✅ | `validate-escrow-upgrade.ts` = **SAFE on both testnet AND mainnet** (read-only, against the live mainnet proxy `0x3d0374…`). Upgrade is a same-address impl swap; no state migration. |
| 1.3 | Test suite green | ✅ | 123 contract tests pass, no skips. |
| 1.4 | Fee schedule | 🟡 | `feeBps=1500` (15%) today; admin-settable, hard-capped 30% (`MAX_FEE_BPS`). ⚠ **Not** per-task — read at settlement, so a change re-prices in-flight tasks. See `MAINNET-DECISIONS.md` §1. |
| 1.5 | Token allowlist | 🟡 | Mainnet escrow currently allows **native 0G only**. Decide if any stablecoin is added day 1 (no USDC is deployed on 0G mainnet — see VP note). Each needs `allowToken(addr)`. Avoid rebasing / fee-on-transfer tokens. |
| 2.1 | Deploy Gnosis Safe | 🟠 | Create an N-of-M Safe on 0G mainnet (2-of-3 min). This is the single biggest gate. |
| 2.2 | Transfer admin → Safe | 🔵 | `proposeAdmin(Safe)` (deployer) → `acceptAdmin()` (Safe UI) for **BlindEscrow, BlindReputation, TaskRegistry**; `transferOwnership(Safe)` for **INFT**. ⚠ **ValidatorPool admin is constructor-fixed — no transfer.** Deploy the mainnet VP *from the Safe* (or accept the EOA admin while VP stays dormant). |
| 2.3 | Cold-store deployer EOA | 🟠 | After admin=Safe, move funds off `0x2f8b…`, store key offline (don't delete). |
| 3.1 | Fresh marketplace signer | 🔵/🟠 | `generate-marketplace-signer.ts` on a clean machine → writes `MARKETPLACE_SIGNER_PRIVATE_KEY` to `.env`. Never commit. |
| 3.2 | Fund the signer | 🟠 | Send native 0G for gas (~0.01/50 settlements; calibrate). |
| 3.3 | Set verifier | 🔵 | `rotate-verifier.ts` — **run while the deployer is still admin** (it's deployer-signed). If admin is already the Safe, do `setVerifier` via the Safe UI instead. |
| 3.4 | Backend env → secret store | 🟠 | Signer key + mainnet chainId/RPC + mainnet addresses in a **secret store** (Vercel/AWS), not a plaintext `.env` on the host. |
| 3.5 | Rotation runbook | ✅ | Documented below (§ Runbook → "Emergency verifier rotation"). Practice once on testnet. |
| 4.1 | Monitoring | 🟠 | Alert on: any non-`marketplaceAssign`/`completeVerification` tx from the signer; any Safe admin tx; any `setVerifier`. Tenderly/Forta/polling. |
| 4.2 | Per-task escrow cap | 🟡 | Not enforced on-chain. Enforce off-chain (UI/backend) at launch. |
| 4.3 | Pause readiness | 🔵 | `escrow.pause()`/`unpause()` are admin-only (→ Safe). Practice a pause+unpause on testnet via the Safe. |
| 4.4 | Backend rate limiting | ✅ (tune) | `middleware/rateLimit.ts` = 100 req/60s. Confirm it suits mainnet traffic; tighten if needed. |
| 5 | Post-deploy verification | 🔵 | `verify-deployment-config.ts` (new) checks admin/verifier/treasury/feeBps/paused/allowlist, with `EXPECTED_*` assertions. Plus a live $1 test task before opening. |
| 5b.1 | Agent endpoint authorization | ✅ | **Checklist stale** — start/pause/stop/restart/resume/PATCH + withdraw/export-key all now use `requireAuth + authorizeOwner`. Verified this session. |
| 5b.2–5b.5 | Agent-wallet custody hardening | ⏸ | `rawPrivateKey` is still stored in cleartext (demo-grade custody). Dropping it / AgentVault / EIP-712 signed withdrawals / withdrawal delays are real pre-serious-usage work, not day-1 blockers. Track separately. |

## Blockers that are only yours to make/do

- **Decisions (🟡):** launch fee (1.4), token allowlist (1.5), per-task cap (4.2), treasury address. Each is written up with a recommendation in **`MAINNET-DECISIONS.md`**. Note: that doc recommends **deferring** the VP stake-token + INFT-oracle decisions — both features are dormant, so their mainnet deploys drop off the launch path.
- **Infra actions (🟠):** Gnosis Safe (2.1), fund the signer (3.2), secret store (3.4), monitoring (4.1), cold-store the EOA (2.3).

Everything else (🔵) is tooling that's built and verified — it just runs once the above are settled.

## Runbook — mainnet execution order

Do deployer-admin work FIRST, transfer admin to the Safe LAST (so the deployer can
still sign the upgrade + role setup). All commands need `contracts/.env` →
`PRIVATE_KEY` = admin, and the mainnet gate `export I_HAVE_READ_MAINNET_CHECKLIST=yes`.

1. **Lock decisions** (fee, allowlist, VP stake token, INFT oracle, cap).
2. **Deploy the Gnosis Safe** (2.1).
3. **Generate + fund the fresh marketplace signer** (3.1, 3.2) — clean machine.
4. **Rotate verifier to the fresh signer** (deployer still admin):
   `MARKETPLACE_SIGNER_ADDRESS=0x… npx hardhat run scripts/rotate-verifier.ts --network 0g-mainnet`
5. **Upgrade BlindEscrow** (#14/#26 — storage already validated SAFE):
   `npx hardhat run scripts/upgrade-blind-escrow.ts --network 0g-mainnet` → expect `✓ Upgraded & VERIFIED`.
6. **~~Redeploy ValidatorPool + INFT~~ — DEFERRED, not a launch step** (decision: `MAINNET-DECISIONS.md` §4/§5).
   Both features are dormant: disputes are admin-resolved (`resolveDispute` is `onlyAdmin`; VP is
   not wired into escrow), and the INFT `#27` fix only hardens the dormant transfer path while live
   minting is oracle-independent + non-fatal. Deploy each **when its feature actually ships**:
   - **ValidatorPool** — from the Safe (admin is constructor-fixed), with a real ERC20 stake token
     and `MIN_STAKE` rescaled to that token's decimals (today's `100e6` assumes 6-decimals).
   - **INFT** — with a real 0G TEE attestation oracle (a Safe/EOA placeholder can't produce valid
     `verifyProof` proofs, so transfers would revert until then).
   When you do deploy either: they get NEW addresses → run `cd contracts && npm run sync-addresses`,
   commit the regenerated `contractAddresses.ts`, and set `INFT_ADDRESS` / `VALIDATOR_POOL_ADDRESS`
   in the secret store. BlindEscrow is unaffected (upgraded in place at `0x3d0374…`).
7. **Set the token allowlist** — `allowToken(addr)` for each decided token (native 0G already allowed).
8. **Transfer admin → Safe** (2.2): `proposeAdmin(Safe)` (deployer) then `acceptAdmin()` (Safe UI) for BlindEscrow/BlindReputation/TaskRegistry; `transferOwnership(Safe)` for INFT.
9. **Wire the mainnet backend** (3.4): signer key + mainnet addresses in the secret store; restart.
10. **Verify** (§5):
    `EXPECTED_ADMIN=0xSafe EXPECTED_VERIFIER=0xSigner EXPECTED_TREASURY=0x… EXPECTED_FEE_BPS=1500 npx hardhat run scripts/verify-deployment-config.ts --network 0g-mainnet`
    then run one live **$1 test task** end-to-end before announcing.
11. **Cold-store the deployer EOA** (2.3).

### Emergency verifier rotation (3.5)
If the marketplace signer is suspected compromised: generate + fund a new key
(3.1/3.2), then the **Safe** executes `setVerifier(newAddr)` (once admin is the
Safe, this is a Safe-UI tx, not `rotate-verifier.ts`). Update the backend secret
store to the new key. ETA ~10 min. Rehearse on testnet first.

## Honest gaps to weigh before "real users, real money"

- **Custody (5b.2–5b.5):** cleartext `rawPrivateKey` per agent means a DB/env leak hands over every agent's funds. This is the biggest non-contract risk; plan the non-custodial migration before serious volume.
- **Single-EOA everything today:** admin = treasury = deployer on both nets. The Safe migration (§2) fixes admin; also point `treasury` at an intended address, not the deployer.
- **Formal audit / timelock / bug bounty** (§6) remain the mature-money measures.

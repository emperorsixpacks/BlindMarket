# Trust Closeout — founder-executed steps (items 1 & 7)

The code items (2–6) of the closeout ship in the backend batch. These two need
you: they involve key ceremonies and billing that Claude can't (and shouldn't)
perform. Goal: break the single hot EOA that today holds **admin + verifier +
custody** into separate, least-privilege roles, and stop the API from napping.

Current state (verified June 2026): `BlindEscrow` is a UUPS proxy with a 2-step
admin transfer (`proposeAdmin`/`acceptAdmin`), an admin-only `setVerifier`, and
`_authorizeUpgrade` gated `onlyAdmin`. So we can rotate the verifier and move
admin to a Safe **without redeploying** — no migration, no downtime.

## Item 1a — Isolate the verifier signer (do this FIRST; lowest risk)

The marketplace backend calls `marketplaceAssign` / `completeVerification` as
`verifier`. Today that's the deployer key. Give it its own key so a backend
compromise can't touch admin or upgrades.

```bash
cd contracts
# 1. Generate a fresh signer (prints address + private key; writes nothing on-chain)
npx hardhat run scripts/generate-marketplace-signer.ts
# 2. Fund the new address with a little 0G for gas (assignment/verdict txs)
#    — send from any wallet; ~1 0G is plenty to start.
# 3. Rotate the on-chain verifier role to it (admin key in contracts/.env signs this)
MARKETPLACE_SIGNER_ADDRESS=0x<new> npx hardhat run scripts/rotate-verifier.ts --network 0g-mainnet
```

Then set `MARKETPLACE_SIGNER_PRIVATE_KEY=0x<new>` in the **backend** env (Render)
and redeploy. Verify: `escrow.verifier()` returns the new address, and a test
task still settles. Keep the new private key out of the contracts repo `.env`
(that one stays the *admin* key, used only for ceremonies).

> Order matters: rotate the verifier **before** moving admin to the Safe — once
> admin is a multisig, `setVerifier` needs a multisig tx, which is slower. Do the
> easy single-key rotation now.

## Item 1b — Move admin to a Safe multisig

`admin` controls upgrades, `setVerifier`, `setTreasury`, `resolveDispute`,
`pause`. A single hot key here is the catastrophic-loss vector our own
MAINNET-CHECKLIST forbids.

1. Deploy a **Safe** on 0G mainnet (chainId 16661). If the Safe UI doesn't
   support 0G, deploy the Safe contracts via their CLI / a script and use the
   Safe Transaction Service or a local Safe frontend pointed at the 0G RPC.
   Start 2-of-3 with keys you control on separate devices/backups.
2. From the **current admin** key, propose the transfer:
   ```bash
   cd contracts
   # one-liner via hardhat console, or a tiny script:
   #   escrow.proposeAdmin("0x<safe>")
   ```
3. From the **Safe**, call `acceptAdmin()` (the 2-step design means the Safe must
   actively accept — this is what prevents locking yourself out by fat-fingering
   the address).
4. Verify `escrow.admin()` == Safe, `escrow.pendingAdmin()` == 0x0.

After this, the deployer key holds **no** standing privilege. Document the Safe
address and signer set in `deployments/0g-mainnet.json`.

> A `propose-admin.ts` helper to mirror `rotate-verifier.ts` is worth adding
> before step 2 — ask Claude to write it (reads admin from `.env`, calls
> `proposeAdmin`, re-reads `pendingAdmin` to confirm). Kept out of this batch
> because it's founder-run, not part of the backend deploy.

## Item 7 — Always-on hosting + uptime alerting

Symptom this fixes: the `x-render-routing: hibernate-wake-error` 503 outage —
the backend hibernated on the free/low tier and failed to wake. A trust product
cannot be asleep when a buyer or researcher first looks.

1. **Render:** upgrade the backend service to an always-on paid instance
   (no spin-down). Confirm the service has `Health Check Path` set (e.g.
   `/health`) so Render restarts a crashed boot instead of serving 503s.
2. **Uptime alerting:** add an external monitor (e.g. UptimeRobot / Better Stack)
   hitting `/health` every 1–5 min with alert-on-failure to your email/phone.
   External matters — Render watching itself misses the hibernate-wake class.
3. While here: confirm `OG_COMPUTE_PRIVATE_KEY` is set in the backend env.
   After the fail-closed change (item 6), auto-verification now **refuses** to
   settle if it's missing rather than silently auto-passing — so a prod deploy
   without it will stop releasing escrow (correct, but you want to know).

## Done criteria

- `escrow.verifier()` = isolated signer; backend uses it; a task settles end-to-end.
- `escrow.admin()` = Safe multisig; deployer key has no standing role.
- Backend stays up across a 10-min idle window; external monitor green; an
  intentional bad boot pages you.

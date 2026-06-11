# BlindMarket — Vision 2: The Confidential Outcome Market

**Status:** adopted June 2026 · supersedes the "anonymous task marketplace" framing
**Confidence:** ~55% as modified by adversarial red-team (June 10, 2026) — a good bet with
cheap kill switches, held honest by the falsification gates in §7. Nothing in this document
is exempt from those gates.

---

## 1. Thesis

BlindMarket is **the settlement layer for work that can't be posted publicly.**

Buyers post confidential briefs (end-to-end encrypted — the platform never sees plaintext).
Payment is escrowed on-chain and releases **only on machine-verified acceptance**. Workers —
AI agents or humans — are **vetted-but-pseudonymous**, never anonymous. We sell verified
outcomes, not labor listings.

> Confidential briefs. Verified outcomes. Settled on-chain.

## 2. Why this, why now

- The mechanic we pioneered — escrowed work with evaluator-gated release — is being
  standardized in **public-content form** (ERC-8183 by Virtuals + Ethereum Foundation;
  ERC-8195 by Daydreams). Plain escrow boards become a commodity ERC anyone implements.
- A June 2026 landscape sweep found exactly two unoccupied combinations in the entire
  agent-commerce market, and they are both ours: **E2E-encrypted task content + escrow**,
  and **encrypted content + verification-gated release**.
- Money flows where outcomes are verified and content stays private: Intercom Fin does
  $100M+ ARR at $0.99 per *verified* resolution; 80% of HackerOne programs are
  private/invite-only; Mercor's $1.5B run-rate is confidential NDA work. Money does **not**
  flow on open agent boards: the leading rivals measure lifetime worker earnings in single
  dollars, and 85% of ERC-8004-registered agents earn nothing.
- The AI-slop crisis (curl shut its bug bounty; HackerOne cut payouts 76–89%) is a
  **validation-cost crisis with dollars attached** — and a machine-verification engine
  gating real money is precisely the relief. That engine is our most-built asset.

## 3. The corrections we adopted (post red-team)

These are load-bearing. Reverting any of them requires re-running the argument, not vibes.

1. **Confidential ≠ anonymous.** Buyer-side brief/evidence confidentiality is the brand.
   Worker anonymity is an anti-feature for every paying segment we found: confidential-work
   buyers demand *more* identity (vetting, contracts, tax/OFAC compliance), not less.
   Workers are **vetted-but-pseudonymous**: pseudonymous to buyers and platform, with
   identity/tax held by a compliance custodian above payout thresholds, plus wallet
   screening at escrow. The word "anonymous" leaves the pitch and the product copy.
2. **Validation-led, confidentiality-closed.** The headline is "bonded, machine-validated
   submissions at a fraction of triage cost." Encryption is the closer, not the headline —
   the bounty crisis is a validation-cost crisis, not a confidentiality crisis.
3. **Verification honesty.** 0G sealed inference is inference-only: it cannot run a test
   suite or reproduce an exploit. Launch scope is **LLM-judgeable + deterministic-schema
   work only**. The lexical/keyword gate is a pre-filter, never settlement-grade. An
   attested execution runner (TDX-class sandbox) is roadmap, gated on a pilot that needs it.
4. **No slashing on a single LLM verdict — ever.** Once bonds exist, workers are paid to
   attack the judge (prompt injection via submitted evidence flips LLM verdicts at very
   high rates, in both directions). Stake is slashed only on deterministic checks or
   validator-majority vote, capped at the bond, with an appeal path.
5. **Demand-first sequencing.** Every mechanics phase gates on a signed LOI or paid pilot.
   On-chain ground truth at adoption time: 2 lifetime posters, ~$1 lifetime volume.
   Mechanics cannot fix that; only buyers can.
6. **Trust claims match deployed reality.** We market "operator-trusted today, attested on
   roadmap" — and we fix the posture before the pitch (see §8 prerequisite).

## 4. Who it's for — the audience map

Not one buyer. Every line below is someone who either pays us, supplies us, or decides
whether to trust us — and **every one of them reads code or relies on someone who does**
(agents integrate our API; standards reviewers evaluate our reference implementation;
researchers audit before they trust; grant committees do diligence). That is why the trust
closeout precedes everything.

**Demand, now:**
- Web3-native protocol teams and DAOs — audits, bounties, ops work; pseudonymity-normal;
  budgets already on-chain.
- OSS programs that cut or closed bounty programs under AI slop — buying validation relief.
- Self-hosted bounty/program operators — our verification engine as tooling, venue optional.

**Supply, now:**
- Agent operators on any stack (OpenClaw, Lucid, Claude-based, custom) — interop ingress
  later makes this explicit; nothing about our market requires *our* framework.
- Human specialists in the vetted-pseudonymous tier.

**Ecosystem:**
- 0G — Claw Launcher agents need an economy; AIverse ERC-7857 iNFTs need a utilization
  layer; grants/co-marketing are a channel, not a dependency.
- ERC-8183/8195 authors and reviewers — our production lessons are the standards play.
- Other marketplaces — future buyers of verification-as-a-service if we unbundle.

**Later (trigger-gated):**
- AI-lab data vendors — as B2B middleware (encrypted routing, attested eval execution),
  never as an anonymous marketplace; labs buy from identified, contracted vendors.
- Enterprises — after attestation hardening and the compliance tier mature.
- Agent owners and renters — Layer 3 below.

## 5. The three-layer arc

**Layer 1 — Outcome market (now).** Confidential briefs, escrowed payment, machine-verified
acceptance, vetted-pseudonymous workers. Everything in §8 serves this layer.

**Layer 2 — Trust ledger (emerges).** Every settled task writes an immutable, verified
performance record: work an agent did, judged by a committed acceptance spec, with money
moving on the verdict. This accumulates into the only capability proof in the agent economy
that can't be faked — *self-claimed capability tags are free; settled escrow is not.*
The stack (encryption + TEE) is copyable in months; **the ledger is the non-copyable asset.**

**Layer 3 — Agent capital market (later).** With verified earnings histories, trained agents
become priceable assets: rentable (cash flow), sellable (ERC-7857 iNFTs already trade
*ownership* on 0G with no income statement attached), eventually collateralizable. Sealed
execution protects both sides — the owner's prompts/memory from the renter, the renter's
data from the owner. GPT-Store-class attempts failed because they had listings without
proof; we will have proof before listings.

> Today we settle agent work; the exhaust of that settlement is the trust layer that turns
> agents into assets.

Layer 3 is **deferred by dependency, not by doubt**: a rental market without a performance
ledger is just another listings site. Near-term obligations to keep the option open:
keep reputation per-agent and portable (on-chain per-task rating already is), and carry the
iNFT-utilization line in the 0G ecosystem narrative.

## 6. Pillar status (post red-team)

| # | Pillar | Verdict | Note |
|---|--------|---------|------|
| P1 | Privacy moat | **Modify** | Confidential, not anonymous; a wedge bet requiring demand proof, not a standalone moat. Custody-local stays off; "operator-trusted today, attested on roadmap." |
| P2 | Acceptance-criteria-as-code | **Keep — the spine** | Survived all five red-team lenses; ~70% already shipped (rubric/judge services + on-chain taskHash commitment). 1–2 weeks of formalization, zero contract changes. |
| P3 | Kill applying / attested capabilities | **Drop for 2026** | Sybil-able without identity; already in rival ERC drafts; not the binding constraint at current GMV. Interim: on-platform validated track record. |
| P4 | Claim bonds + slashing | **Pilot experiment only** | A/B inside wedge pilots; slashing via deterministic checks or validator majority only. |
| P5 | Recursive sub-escrow DAGs | **Defer** | Trigger: a paying customer asks for subcontracting AND a quarter of lifecycle stability. Then: linked flat tasks + off-chain cascade — never recursion inside the live fund-holding proxy. |
| P6 | Streams / SLA mode | **Defer** | Adopt per-verified-outcome pricing language in proposals now; build streaming only at ≥3 repeat buyers asking. |
| P7 | Standards play | **Shrink** | 1–2 weeks: working encrypted-content reference profile compatible with ERC-8183/8195 + production-lessons post on Ethereum Magicians. No ingress engineering until a pilot asks. |
| P8 | Demand wedges | **Wedge 1 reframed, phase 1** | Validation-led bounty wedge for web3/OSS/self-hosted operators. Wedge 2 (AI-lab marketplace) dead as framed; reborn later as identified-vendor middleware. |
| P9 | Sequencing | **Inverted** | Demand motion first on existing mechanics; every build phase gates on an LOI or paid pilot. |

## 7. Falsification gates

This vision is a hypothesis. These tests can kill it cheaply — run them before any
expensive build:

1. **Design-partner sprint** — 15 structured conversations (web3 protocols, OSS programs
   that quit/cut bounties, self-hosted operators). *Kill the wedge if <3 advance to pilot
   terms by day 30; validate at ≥3 LOIs or 1 paid pilot by day 45.*
2. **Confidentiality willingness-to-pay** — encryption tier priced as a separate line item
   in every proposal. *Kill "confidential" as headline if nobody pays for it specifically.*
3. **Judge bench** — sealed judge + rubric specs vs 30–50 real artifacts including
   deliberate slop and prompt-injection attempts. *Kill bonds (P4) if false-fail >5% or
   injection flips verdicts; validates the judge as settlement pre-filter.*
4. **Compliance gate probe** — payout posture in front of 5 buyers' procurement/security
   contacts. *Kill non-crypto segments if 0/5 would pass it through review.*
5. **Concierge pilot** — 1–3 real paid confidential bounties on EXISTING mechanics
   (agent-mode verification + current escrow, zero contract changes), founders doing glue
   by hand. ***Hard gate: zero external paid settlements by day 60 → rethink the wedge,
   not the mechanics.***
6. **Standards reception probe** — reference profile + Ethereum Magicians post. *Kill the
   influence ambition (keep interface compat) if ignored after 30 days.*

## 8. The 90-day plan

**Days 0–14 — trust closeout (non-negotiable prerequisite).**
The repo is the pitch; these were verified open in source on June 10, 2026:
1. Safe multisig admin + isolated verifier signer (today admin == verifier == custody on
   one hot EOA — our own MAINNET-CHECKLIST forbids this). *Founder-in-loop.*
2. Auth-gate or remove the anonymous JSON-RPC `tasks/cancel` (public kill switch).
3. Browse projection: strip `wrappedKeys` / `keyCustodyBlob` / `rootHash` from
   unauthenticated browse/list responses; add pagination.
4. Worker-match assert in the already-settled branch of assignment settlement (no key
   material without confirming the on-chain assigned worker is the caller).
5. Worker decrypt-failure handling (no stranded tasks, no crashed agent loops).
6. Verification fails closed (no verdict when 0G Compute is unconfigured — never auto-PASS).
7. Always-on hosting tier + uptime alerting. *Founder-in-loop.*
   Plus: block poster-self-accept (wash-trading guard, per §10 principles).

**Closeout follow-ups (surfaced by the adversarial review of the batch):**
- **Deliverable confidentiality (`resultData`).** The unauthenticated `GET /tasks/:id`
  and JSON-RPC `tasks/get` still return `state.resultData` — the executor's plaintext
  work product — because today's TaskDetail renders it for everyone. Making the deliverable
  poster/executor-only is **P2 work**: it needs an authenticated result view to replace the
  public one (the batch already stripped key material and the `assignError`/`verifyError`
  internals from these surfaces). Until then, the brief is private but the *output* is not.
- **Socket auth.** The Socket.IO `join` handshake is unauthenticated; the batch removed
  `rootHash` from `task:offer` payloads as the immediate fix, but authenticating the
  handshake (only allow joining `agent:<self>`) is the durable one.
- **Test depth.** Added coverage for the projections, self-accept, and the settlement
  worker-match branches; the verification fail-closed truth table is still only documented,
  not unit-tested.

**Days 7–45 — demand sprint** (parallel): falsification tests 1, 2, 4; line up 3 concierge
pilots.
**Days 21–50 — P2-lite + judge bench:** verifier-spec JSON envelope inside the existing
encrypted brief (taskHash already commits it — zero contract change); 3 spec templates
(rubric / JSON-schema / sealed-inference prompt); run test 3; publish the honest trust-model
and compliance-posture doc.
**Days 30–60 — run the paid pilots** (test 5). **Hard gate at day 60.**
**Days 45–75 — standards play** (test 6) + 0G grant application as channel; x402 pay-in only
if a pilot asks.
**Days 75–90 — decide bonds** from observed pilot slop (validator-vote slashing only); write
the upgrade plan for whatever pilots proved. P3/P5/P6 stay parked. Multisig precedes ANY
contract upgrade work.

## 9. What we are explicitly NOT doing

| Not doing | Revisit trigger |
|---|---|
| "Anonymous" as brand or positioning | Never — superseded by confidential + vetted-pseudonymous |
| AI-lab work as a marketplace | Wedge-1 pipe proven + inbound from a data vendor → middleware form only |
| Attested-capability benchmarks (P3) | Real GMV makes self-claimed capabilities the binding constraint |
| Recursive sub-escrow DAGs (P5) | Paying customer asks + a stable quarter |
| Streaming/SLA mechanics (P6) | ≥3 repeat buyers with recurring engagements |
| x402 / ERC-8004 / A2A ingress engineering | A pilot asks, or a rail shows organic non-wash task flow |
| Chain/settlement migration to Base | ≥2 pilot deals stall specifically on 0G friction |
| A token | Never on current evidence — token-first agent projects are failing as a class |

## 10. Operating principles

1. **Verification gates settlement; settlement writes history; history is the moat.**
2. **Fail closed.** No verdict → no payout movement in either direction (and no unfair
   burn of a worker's attempt on infrastructure failure).
3. **GMV is reported net of self-dealing.** Self-accept is blocked; same-funder graphs are
   an analytics requirement, not an afterthought.
4. **No supply-side subsidies into a demand vacuum.** A2A volume is a cost center until
   external buyer revenue exists.
5. **Never retroactively change payout terms.** (The fastest documented way to torch
   worker trust.)
6. **Demand gates mechanics.** No build phase starts without an LOI or paid pilot.
7. **Trust claims match deployed reality.** Operator-trusted today, attested on roadmap;
   the upgrade path is public.
8. **The repo is the pitch.** Every audience in §4 reads code or relies on someone who
   does.

## 11. Honest trust model (today → roadmap)

| Component | Today | Roadmap |
|---|---|---|
| Escrow admin | Hot EOA → **Safe multisig (closeout item 1)** | Timelocked multisig |
| Verifier role | Operator backend signer (isolated from admin after closeout) | Per-task on-chain verifier identity (poster-committed at creation; already planned) |
| Brief encryption | Client-side AES-256-GCM + ECIES wrap; platform never sees plaintext | Unchanged — this is the invariant |
| Key custody (late joiners) | `local` backend **disabled** until hardened | TDX enclave or ERC-7857 re-encryption oracle |
| Verification | Sealed inference (0G TEE, inference-only) + deterministic schema checks; lexical gate as pre-filter only | Attested execution runner (TDX-class) for test-suite / PoC acceptance specs |
| Worker identity | Vetted-pseudonymous tier design (compliance custodian + wallet screening) | zk-credential upgrade path |

---

*This document loses to evidence. If a falsification gate fires, update the vision — don't
argue with the gate.*

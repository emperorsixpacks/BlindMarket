# BlindMarket — Demand Sprint Playbook

**Goal:** validate (or kill) the confidential-outcome-market wedge with real buyers, cheaply,
before any expensive build. This is falsification test 1 from `docs/VISION-2.md` §7, and it's
what the day-60 pilot gate ultimately rests on.

**Hard gates (from VISION-2 §7):**
- **Day 30 — KILL if <3 conversations reach "advanced to pilot terms"** (agreed scope + success metric).
- **Day 45 — VALIDATE if ≥3 LOIs OR ≥1 paid pilot.** Otherwise reshape the wedge (not the mechanics).
- Run in parallel with the founder-ops items in `docs/CLOSEOUT-FOUNDER-OPS.md`.

**What we're selling (say it exactly this way):** *bonded, machine-validated, confidential
submissions at a fraction of triage cost.* Validation-led; confidentiality is the closer.
Workers are **vetted-but-pseudonymous, never anonymous.**

> ⚠️ **The constraint that shapes everything:** 0G sealed inference is **inference-only**. It
> can machine-gate LLM-evaluable + deterministic-schema deliverables. It **cannot** run a test
> suite or reproduce an exploit PoC — that's a later TDX-sandbox phase. So the shippable wedge
> in security is the **triage / pre-screen / spec-review layer**, never exploit reproduction.
> Pitch the report-form/claim-coherence gate + reporter bonding; if a buyer's acceptance needs
> code execution, scope it out honestly (procurement will catch it otherwise).

*Targets below are research-sourced (live web research, 2026-06-11). Confirm the contact path
and that the program/RFP is still open before you send — these move.*

---

## The 15 — ranked shortlist

Priority = willingness-to-pay × reachability × pseudonymity-tolerance × verifiable-now, weighted
toward the 45-day clock (already-open procurements + nimble operators beat slow DAO governance).

### Tier 1 — lead now (paid-pilot path, verifiable today, reachable)

| # | Target | Why / pain (sourced) | Hook angle | Contact | Probes |
|---|--------|----------------------|-----------|---------|--------|
| 1 | **Cosmos / Interchain Foundation** security | 900% YoY slop surge; *publicly shopping "more advanced triage"* (cosmos.network/blog/updates-to-the-cosmos-bug-bounty-program, 2025) | "You're already buying triage — buy a bonded, machine-validated one on encrypted reports" | security@interchain.io; Cosmos HackerOne; Discord #security | T1, T4, T2(embargoed) |
| 2 | **Compound DAO — Security Service Provider RFP** | **LIVE 12-mo SSP RFP**, on-chain treasury, deliverables are advisory/spec-review = LLM-judgeable (comp.xyz/t/…/6955) | Respond to the RFP as a design partner | comp.xyz RFP thread #6955; Compound Gov Working Group; Discord | T1, T4, T2 |
| 3 | **Sovereign Tech Agency** (German govt) | €17M+ budget; pays YesWeHack to run Log4j2/systemd/GNOME bounties; **runs open tenders** (sovereign.tech/news/call-for-tenders-resilience) | "Fund the pre-filter so your funded maintainers triage only the real 5%" | sovereign.tech contact + tender channel; Tara Tarakiyee (OSS lead) | T1, **T4 (govt procurement — hardest, most informative)** |
| 4 | **Nextcloud GmbH** security | Suspended paid bounties Apr 2026; **explicitly "hopes to restart once a reliable filter is found"** — clearest stated-intent buyer (cybernews.com/ai-news/nextclouds-ai-bug-bounty-flood…) | "You said you'd restart once you can filter — that filter is the product" | security@nextcloud.com; HackerOne nextcloud; Nextcloud GmbH (commercial) | T1, T2(enterprise code), T4 |
| 5 | **Patchstack** (WordPress vuln program operator) | Self-runs its pipeline; **20+ AI duplicates per vuln**; rewrote rules eff. Jun 1 2026 (patchstack.com/articles/the-future-of-the-patchstack-bug-bounty-program) | "Instead of rejecting after the fact, bond + machine-judge before a human sees it" | security@patchstack.com; **Oliver Sild (founder, writes the posts — warm intro)** | T1, T4 |
| 6 | **Gray Swan AI — Arena** (AI red-team operator) | $25k–$300k pools, anonymized frontier models; acceptance = "did the transcript break the behavior" = **fully LLM-judgeable, zero execution**; targets inherently confidential (app.grayswan.ai/arena) | "Add a refundable bond + encrypted intake to your Arena" | Arena Discord; grayswan.ai; partnerships team | **T1 (fast contest loop), T2 (best home for the encryption line item)** |

### Tier 2 — strong design partners / fast LOI path

| # | Target | Why / pain (sourced) | Hook angle | Contact | Probes |
|---|--------|----------------------|-----------|---------|--------|
| 7 | **Aave DAO** security | Just approved **$200k / 2-mo advisory retainer** (advisory, not code-exec) as BGD stepped back (governance.aave.com/t/…/24385) | "On-call bonded advisory — every deliverable machine-validated + reputation-scored" | governance.aave.com (Development); ACI delegate; Discord | T1, T2, T4 |
| 8 | **SEAL / Security Alliance — Safe Harbor** | Open framework: on-chain bounty escrow + pre-authorized **pseudonymous** whitehats; adopted by Uniswap/zkSync/Pendle/Balancer (frameworks.securityalliance.org/safe-harbor) | "You already solved pseudonymous + on-chain payout — add bonding + machine-validation" | github.com/security-alliance/safe-harbor; @\_SEAL\_Org | **T4 (fastest pass — already solved legally), T2** |
| 9 | **HackAPrompt / Learn Prompting** (Sander Schulhoff) | Ran the 600k-jailbreak comp; acceptance = "did the prompt achieve the jailbreak" = LLM-judgeable; nimble operator (maven.com/learn-prompting-company/…) | "Run your next paid prompt bounty on our engine — bonded, encrypted, machine-judged" | Sander Schulhoff (X/LinkedIn); learnprompting.org; Discord | T1 (fast), T2 |
| 10 | **Displaced Code4rena wardens / judges** | C4 winding down Q2 2026, Immunefi absorbing *some*; the rest are **choosing new rails now** (cryptotimes.io 2026-05-13) | "Run your own bonded, confidential contests on our rails — don't rebuild a platform" | C4 Discord (judge channels); top wardens public on X | **T1 (fastest single-contest pilot), T2** |
| 11 | **Apache Log4j2 — P. Karwasz** (ppkarwasz) | "~1 in 20 legit"; **already designing a serious/questionable bucketing scheme** by hand; sits inside the Sovereign-Tech-funded program (github.com/apache/logging-log4j2/discussions/4052) | "Automate the bucketing you're already proposing" — champion to land #3 | ppkarwasz on GitHub; security@logging.apache.org | T1 (cleanest fit); pairs with #3 for T4 |
| 12 | **Small AI eval / dataset shops** (sub-Mercor) | Rubric-graded deliverables = LLM-judgeable; data is confidential; $95–450/hr (work.mercor.com/jobs; Surge) | "Confidential, bonded, rubric-gated contributor pool" | hiring posts (ZipRecruiter "AI Evaluator"); founders on X; DeepEval community | **T2 (cleanest encryption line item), T1 (nimble)** |

### Tier 3 — channel / reference / amplifier (lower revenue odds, high signal)

| # | Target | Role | Contact | Probes |
|---|--------|------|---------|--------|
| 13 | **Sherlock** (audit-contest platform) | Bonding already validated ($250 stake, 52% hit rate); sell a **confidential-contest tier** as tooling (sherlock.xyz/solutions/audit-contests) | Sherlock Discord; team on X | T1, **T2 (confidential tier = new product line)** |
| 14 | **Seth Larson / PSF** (Security Dev-in-Residence) | Coined "AI slop security reports"; Alpha-Omega-funded; **thought-leader who routes funding** (sethmlarson.dev) | @sethmlarson@fosstodon.org; security@python.org | T1 (amplifier), T4 (grant route) |
| 15 | **curl — Daniel Stenberg** | The archetype; killed then reopened (unpaid) bounty over slop; **marquee reference logo, ~$0 WTP** (daniel.haxx.se/blog/2026/01/26) | security@curl.se; @bagder@mastodon.social | **T1 reference only** (skeptical of AI hype — lead with the bonding mechanic, not "we filter slop") |

---

## Pitch variants (cold outreach)

**Web3 protocol / security team** — *DM (Telegram/X) to security lead or founder:*
> You already pay Cantina/Sherlock/Immunefi for crowd reviews — but the bottleneck isn't finding
> bugs, it's triaging the slop and exposing pre-launch code to a crowd. BlindMarket flips it:
> vetted, pseudonymous researchers submit **bonded** findings against an **E2E-encrypted brief our
> platform never decrypts**. A sealed-inference judge gates escrow — it only releases on a
> machine-verified, schema-conformant submission, so you stop paying to read non-exploitable
> noise. Per-task on-chain reputation follows each researcher. We're signing 3 design partners
> this month for a paid pilot on one upcoming scope. Worth 20 minutes? The encryption tier is a
> separate line item — you'd tell me what it's worth.

**OSS project that cut/killed its bounty** — *email to maintainer / security contact:*
> curl killed its bounty over AI slop; HackerOne's IBB paused payouts and cut rewards ~70%+ —
> because AI dropped submission cost to zero while triage cost stayed brutal. BlindMarket doesn't
> ask you to triage. Researchers post a **refundable bond**, and a machine judge gates payout
> against a deterministic schema / LLM-checkable acceptance rule **you** define — so slop never
> reaches your inbox, and you only ever pay for a finding that already passed the gate. Not asking
> you to switch platforms — just to validate the model on one real scope. 20 minutes? I'll price
> the confidential brief tier separately so you see exactly what you'd pay for.

**Self-hosted operator / boutique shop** — *forum post / warm intro / LinkedIn DM:*
> If you run an audit shop or self-host sensitive infra, your problem with crowd platforms is
> twofold: junior submissions you still validate by hand, and handing proprietary code to a public
> crowd. BlindMarket lets you post an **E2E-encrypted brief the platform never decrypts**, to
> vetted-but-pseudonymous researchers under a **refundable bond**, with escrow released only when a
> machine judge confirms the deliverable meets the schema/criteria you set. You keep the client
> relationship; we kill the validation tax and keep the work confidential. Payouts are
> wallet-screened with a tax-info custodian above threshold — built to pass procurement. Booking 3
> design partners for paid pilots — 20 minutes?

---

## Discovery script (20 min — learn, don't demo)

**Open:** "I'm not here to demo — I want to learn whether a problem we keep hearing is real for
you, and only if it is, whether a pilot makes sense. Push back hard; I'd rather hear it's a
non-issue than waste your quarter." *(Confirm: are you the budget owner / pilot sign-off?)*

**Pain (surface it without leading):**
- Walk me through what happens from a submission landing to someone getting paid — who touches it, how long does it sit?
- Last quarter, roughly what share of submissions were valid vs. noise you had to disprove? Has that ratio moved this year?
- When a report is invalid, who eats the time to prove it — and what would they otherwise be doing?
- Is there work you'd want external researchers on but **can't post anywhere** because the code/context can't go public or to an untrusted crowd? What happens to it today?
- Have you changed reward amounts, scope, or whether you run a program at all in the last 12 months? What drove that?
- If validation disappeared tomorrow — findings arrived already machine-checked against your criteria — what changes for your team and budget?

**Confidentiality probe (Test 2):** "Separate two things you might buy. One: the bonded,
machine-validated flow — you stop paying to read noise. Two: the confidential brief — E2E
encrypted, we literally can't decrypt it. If those were two line items, for the work that can't
go public today, **what would you pay for the confidentiality tier on its own?** Nice-to-have, or
the thing that makes it a yes?" *(Listen for a number AND whether confidentiality unlocks budget
that wouldn't otherwise exist.)*

**Compliance probe (Test 4):** "You'd run this past security + procurement, so let me put the
payout posture on the table and you tell me where it dies. Researchers are vetted but
**pseudonymous-to-you** — persistent on-chain reputation + history, not a legal name. Payout
wallets are sanctions-screened; above a threshold we collect tax info via a custodian (like
Bugcrowd/HackenProof gate withdrawals). Settlement is on-chain escrow. If you took exactly that
to your teams this week — **passes, conditioned, or rejected?** What's the specific clause that
trips it?"

**Pilot ask (Test 1):** "If this maps to a real cost: a scoped **paid pilot** on one real
engagement — you bring a brief, we run it encrypted with a machine-gated payout, and we agree up
front what 'this worked' means (valid-finding rate, hours saved, confidentiality held). Not ready
for budget? A short **LOI** naming scope + success criteria puts you in the design-partner cohort
at pilot pricing. Who else needs to be in the room, and what's the smallest scope we could run in
2–3 weeks?"

**Anti-patterns (do NOT):**
- Never say "anonymous" — say *vetted-but-pseudonymous-to-buyer with persistent on-chain reputation*.
- Don't promise verification of arbitrary work — sealed inference is inference-only; if acceptance needs code execution, say so and scope it out.
- No token / tokenomics / "which token" — settlement is on-chain escrow, full stop.
- Don't lead the witness on confidentiality WTP — get their number before you name a price.
- Don't pitch features before the validation-cost pain is confirmed for THIS buyer; no pain + no confidential work = kill, note it, move on.
- Don't claim you replace HackerOne/Cantina wholesale — you're the confidential, pre-validated wedge for work they can't take.

---

## Objections → honest responses

- **"Why not HackerOne private / Cantina / Sherlock?"** Right tool when the bottleneck is *discovery* and code can go to a vetted crowd. Two gaps: you still pay for triage (HackerOne just paused IBB payouts because validation, not discovery, is the cost center), and even private programs disclose scope to the crowd + platform. We never decrypt your brief; escrow releases only on a machine-verified submission. A wedge, not a wholesale replacement — and we'll tell you when their model fits better.
- **"Who's the worker? I won't pay an anonymous person."** Agreed — anonymous is a non-starter, which is why we don't do it. Vetted-but-pseudonymous: persistent on-chain reputation, history, and a refundable bond they forfeit for bad-faith work; payout wallets sanctions-screened, tax info above a threshold via a custodian. If a scope needs a named individual, we condition it on that.
- **"Which chain? I don't want crypto exposure."** It's a settlement rail for escrow + reputation, not a token play — nothing to hold or trade. Runs on 0G (EVM); escrow holds payment and releases only on machine-verified acceptance, so there's no "trust us to pay out" step. If finance can't touch crypto rails at all, that's a real constraint worth surfacing in the pilot.
- **"Can it really verify MY work?"** Depends on the deliverable, and I won't oversell. The judge is inference-only: it gates LLM-evaluable (meets the rubric?) or deterministic-schema work. It does **not** run your test suite or reproduce a PoC today. Let's look at one real brief and decide honestly — if it needs execution, we scope it out.
- **"What if the judge is wrong?"** Acceptance criteria defined with you up front, deterministic where possible; bond + reputation align the researcher against gaming it. In the pilot we measure the judge's false-accept/false-reject rate against your own review as ground truth — that number is a success criterion.
- **"One more vendor to onboard, no bandwidth."** That's why the pilot is one real scope, not a migration. Bring a brief you already have; if it doesn't beat your current process on a number you chose, there's nothing to roll out.
- **"How do I know the brief is actually private?"** Enforced by crypto, not a promise: briefs are ECIES E2E-encrypted to the recipient's key; the platform stores ciphertext and never holds plaintext or the decryption key. That's why confidentiality is a separate line item — a technically-enforced property your team can verify in the pilot.

---

## Pipeline tracker

One row per conversation. **States:** `IDENTIFIED → CONTACTED → CALL_BOOKED → DISCOVERY_DONE →
ADVANCED_TO_PILOT_TERMS → LOI → PAID_PILOT → WON | LOST`.

**Columns:** account · segment · contact/role · is_budget_owner(Y/N) · channel · first_touch ·
call_date · STATE · validation_pain(none/mild/acute) · confidential_work_exists(Y/N) ·
**test2_encryption_WTP** (their number + nice-to-have vs must-have) · **test4_compliance_verdict**
(passes/conditioned/rejected + blocking clause) · **acceptance_machine_gateable** (Y-schema /
Y-LLM-rubric / N-needs-execution → if N, do NOT pilot now, log as later-TDX) · pilot_scope ·
success_metric_agreed · advanced_to_pilot_terms(Y/N) · LOI(Y/N+date) · paid_pilot(Y/N+amount) ·
next_action · kill_reason.

**Gate rollup (compute weekly, header row):**
- `COUNT(state ≥ ADVANCED_TO_PILOT_TERMS)` → **Day-30: <3 = KILL.**
- `COUNT(LOI) + COUNT(paid_pilot)` → **Day-45: (LOIs ≥3) OR (paid ≥1) = VALIDATE, else KILL.**
- Secondary readouts: % with confidential_work_exists=Y (encryption-tier market size); median
  test2 WTP among must-haves (Test-2 verdict); passes vs rejected on test4 (does the posture clear
  procurement?); COUNT(acceptance_machine_gateable=N) (how much demand is execution-work we can't
  serve until the TDX phase — sizes the wedge vs. the later roadmap).

---

## Honest reads (carry these into every call)

1. **Where the money actually is.** In OSS, the payer is almost never the volunteer maintainer
   (curl/Nextcloud/IBB/Node *de-monetized* rather than spending) — it's the **funder behind them**:
   Sovereign Tech (govt, tenders), Alpha-Omega/OpenSSF (Microsoft/Google/Amazon-backed grants),
   and commercial OSS vendors (Nextcloud GmbH). Chase funders + commercial vendors; use volunteer
   maintainers (curl, Django, FFmpeg) as **logos/LOIs, not revenue**.
2. **Confidentiality (Test 2) is weak in OSS, strong in red-team/eval.** OSS security is
   public-disclosure — the encryption tier barely lands there. Price the confidentiality line item
   where the work is *inherently* confidential: **Gray Swan, HackAPrompt, AI eval shops, private
   audit contests** (Sherlock tier), embargoed/pre-disclosure findings. If Test 2 is the gate you
   most need to move, weight those targets.
3. **The platforms are building their own AI triage** (HackerOne Hai, Cantina, GitHub Models,
   Immunefi Managed Triage at "3× savings"). "We filter slop" is being commoditized. **Lead with
   the defensible trio: bonding (reporter stakes, slashed on slop — shifts cost onto well-funded
   AI-report originators), on-chain escrow released only on machine-verified accept, and per-task
   pseudonymous-but-vetted reputation.** Treat Cantina/Immunefi/HackerOne as *partner-or-watchlist*,
   not core pipeline.
4. **Bonding is already market-validated** — Sherlock's $250 stake-to-submit yields a 52% hit rate,
   the best signal-to-noise in web3 bounties. We generalize a mechanic operators already pay for.
5. **The clock favors the already-open doors.** Slow DAO governance threads (Arbitrum/Optimism/
   Solana) threaten the day-30/45 gates. Prioritize the **open procurements** (Compound SSP RFP,
   Cosmos actively shopping, Sovereign Tech tenders, Nextcloud's stated intent) and **nimble
   operators who can pilot one contest in days** (Gray Swan, HackAPrompt, displaced C4 judges,
   Patchstack) over governance votes.

## Bench / watchlist (not in the 15, revisit by trigger)

- **Cantina, Immunefi** — biggest $ but building their own triage → partner-or-compete, enterprise-slow.
- **ENS, Arbitrum AAP, Optimism Season 9, Solana STRIDE** — real budgets, but mixed-verifiability (execution-heavy headline product; only the *intake/spec-review* fits) and/or slow DAO cycles.
- **Code4rena (as a platform)** — winding down; value is its *displaced people* (#10), not the org.
- **Django, FFmpeg, Node.js, Jazzband, PSF-broad** — vivid pain, ~$0 direct WTP → references/case studies.
- **Konvu, Penligent** — boundary markers: they sell exploit-*reproduction* (the execution layer we
  can't do yet). Future *partner* (we bring bonding+escrow+confidential intake; they bring
  reproduction) or competitor if they add escrow. Defines the edge of our early scope.

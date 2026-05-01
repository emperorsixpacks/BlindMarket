# BlindBounty — The Pitch

## The One-Liner

**BlindBounty is the execution layer where AI agents hire humans for real-world tasks — and nobody sees what's being done or why.**

---

## The Story (Demo Script)

### Scene: You're an AI agent.

You work for a real estate investment firm. Your job is to quietly evaluate properties before your firm makes acquisition offers. Today, you need ground-level photos of a building at 42 Oak Street — the exterior, the signage, the foot traffic.

But here's the problem: **if anyone finds out you're looking at 42 Oak Street, the price goes up.** Competitors monitor public task boards. Freelancer platforms log everything. Even your own platform could sell that data.

You need a human to go there. You need to pay them. You need proof they did it. And **no one — not the worker, not the platform, not any observer — can ever know why.**

### Watch what happens:

**Step 1 — The agent posts a blind bounty.**
You type the instructions: *"Photograph the building at 42 Oak Street. Capture the front entrance, any signage, and the surrounding block."* Before it leaves your browser, those words are encrypted with AES-256. The encrypted blob goes to 0G Storage. The hash goes on-chain. Even BlindBounty's own servers never see the plaintext.

**Step 2 — A worker picks it up.**
A worker with a solid anonymous reputation applies. No name, no email — just a wallet address and a track record. You assign them. At that moment, a cryptographic key exchange happens: the AES key is wrapped to their public key using ECIES. Now only they can decrypt the instructions. They read: *"Photograph the building at 42 Oak Street..."* They go. They shoot. They're done.

**Step 3 — The TEE verifies, the escrow releases.**
The worker encrypts their evidence and uploads it. You trigger verification. The evidence is decrypted *inside a hardware enclave* (Intel TDX + NVIDIA H100 TEE) running 0G Sealed Inference. An AI model evaluates: *"Does this evidence satisfy the requirements?"* It returns a verdict — passed, 0.9 confidence. The enclave signs the result. The escrow releases payment automatically.

**The worker never knew why they were photographing that building. The platform never knew. The blockchain shows a hash, not a task. Your competitor never knew you were looking.**

That's BlindBounty.

---

## Why This Matters Now

AI agents are becoming autonomous. They can research, plan, analyze, and decide. But they **cannot do physical things**. They can't walk into a store, photograph a building, verify a shipment, or check if a restaurant is actually open.

So they need to hire humans. And the moment they do, they expose their reasoning:
- *"Why does this agent need photos of 42 Oak Street?"*
- *"Why is this agent asking for medical records from this clinic?"*
- *"Why is this agent researching this company's supply chain?"*

On every existing platform — Mechanical Turk, Fiverr, Upwork, even crypto bounty boards — **the task itself is public.** The instructions are visible. The platform can read them. Workers discuss them. Competitors scrape them.

BlindBounty makes the task marketplace **architecturally blind.** Not "we promise not to look" blind. The system is built so that **looking is impossible.**

---

## Who Needs This First (Our First 10 Users)

We're not targeting "all AI developers." We know exactly where our first users are:

**1. AI agent builders on 0G (our home turf)**
The 0G developer community (2,000+ builders) is already deploying autonomous agents on 0G Chain. They have wallets, they understand TEE verification, they're building agents that *need real-world data*. They're one integration away from using BlindBounty.

**2. Autonomous agent frameworks (AutoGPT, CrewAI, LangGraph)**
These communities have thousands of developers building agents that hit the same wall: *"My agent is smart enough to plan the task but has no hands to do it."* BlindBounty gives their agents hands — with privacy built in.

**3. Competitive intelligence teams**
Firms that already pay for field research (mystery shopping, location verification, retail audits) but can't use existing platforms because the *task itself reveals the strategy.* These aren't hypothetical — this is a multi-billion dollar industry using Excel spreadsheets and NDAs today.

---

## What Makes Us Different (One Sentence)

> **BlindBounty is the only task marketplace where the platform itself is cryptographically unable to read what's being done — not by policy, but by architecture.**

Every competitor relies on trust: *"We won't read your tasks."* We rely on math:
- **AES-256-GCM encryption** happens in the browser before data touches any server
- **0G Storage** holds encrypted bytes — not plaintext, not metadata, just noise without the key
- **0G Sealed Inference (TEE)** verifies evidence inside a hardware enclave — the data is decrypted in silicon, evaluated by AI, and the result is signed before it leaves. No human in the loop. No server-side logging.
- **ECIES key wrapping** means only the intended recipient can ever decrypt. Not us. Not the other party. Not a subpoena.

This isn't a privacy feature bolted onto a task board. **Privacy is the architecture.** Removing it would mean rewriting every layer.

---

## The Business Model

**15% treasury fee on every completed task.** Paid automatically by the escrow smart contract when the TEE verifies evidence. No invoicing. No payment processing. No chargebacks.

The math is simple:
- Agent posts a 100 USDC bounty
- Worker completes the task, TEE verifies
- Worker receives 85 USDC, treasury receives 15 USDC
- All on-chain, all automatic

**Why 15% works:** The premium isn't for "task matching" (Fiverr charges 20% for that). The premium is for **guaranteed privacy + trustless verification.** When the alternative is leaking your acquisition strategy, 15% is cheap.

**Revenue scales with agent autonomy.** As AI agents get more capable, they delegate more tasks. More tasks = more escrow = more fees. We don't need to find new users — the same agents just do more work.

---

## Why 0G (And Not a Centralized Stack)

This is the question, and we have a specific answer for each layer:

| Layer | Why not centralized? | Why 0G specifically? |
|---|---|---|
| **Storage** | AWS S3 can read your data. Their compliance team can read your data. A breach exposes your data. | 0G Storage holds encrypted blobs with merkle proofs. Censorship-resistant. No single entity can delete or tamper with evidence. |
| **Verification** | OpenAI API sees every prompt. They log it. They train on it. A rogue employee can read it. | 0G Sealed Inference runs in TEE hardware. Data is decrypted in the enclave, evaluated, and signed — never touching a disk or a log. |
| **Payments** | Stripe can freeze funds. PayPal can reverse transactions. Banks can block accounts. | 0G Chain escrow is immutable. Once the TEE says "passed," the smart contract releases. No human can intervene. |

**Removing 0G breaks the product.** Without 0G Storage, we can't store encrypted tasks in a decentralized, tamper-proof way. Without 0G Compute, we can't verify evidence privately. Without 0G Chain, we can't enforce payment guarantees. This isn't a badge — it's the foundation.

---

## Traction (What We've Built and Proven)

This isn't a mockup. Every layer works on 0G testnet:

- **3 smart contracts deployed** — BlindEscrow, TaskRegistry, BlindReputation (103 unit tests, every state transition covered)
- **6 escrow payment strategies** — standard release, retry, cancel + refund, timeout reclaim, dispute arbitration, worker-favored resolution
- **0G Storage round-trip verified** — encrypted blob upload/download with real tx hashes and merkle proofs
- **0G Sealed Inference verified** — live TEE evaluation of task evidence (qwen-2.5-7b-instruct, 7.4s response, 0.9 confidence)
- **Full 10-step lifecycle completed on testnet** — auth, encrypt, upload, create task, apply, assign, submit evidence, TEE verify, escrow release, reputation update
- **Security audited** — JWT algorithm pinning, input validation, double-click prevention, no private key exposure, production-mode fail-hard on verification

---

## The Demo Checklist (Self-Assessment)

| # | Check | Status |
|---|---|---|
| 1 | We can name 3 real users | Competitive intelligence teams, AI agent builders on 0G, autonomous framework devs |
| 2 | User feedback changed our direction | Added A2H/H2A framing after community comparison; strengthened privacy-first narrative |
| 3 | Demo is scenario-driven | Real estate acquisition scenario — follows the agent, not the codebase |
| 4 | We know where first 10 users come from | 0G dev Discord, AutoGPT/CrewAI communities, existing field research firms |
| 5 | On-chain record ready to show | 0G Storage tx hashes, contract deployments, broker deposit txs — all on testnet |
| 6 | Why 0G, not centralized? | Specific answer per layer: storage privacy, TEE verification, payment immutability |
| 7 | 0G integration is load-bearing | Remove any 0G component and the product breaks |
| 8 | What shipped last week | Security audit, sealed inference live, TLS fix, narrative overhaul |
| 9 | Steady commit history | Multi-day commits, not a last-minute dump |
| 10 | One blocker and how we handled it | 0G broker ESM broken (CJS workaround), TLS 1.3 incompatible (forced 1.2), ledger persistence misconception (investigated on-chain state) |
| 11 | Version different from Week 1 | Started with contracts only, now full-stack with 3 live 0G integrations |
| 14 | Specific market thesis | "When AI agents need real-world execution at scale, they need a marketplace where the task itself is secret — because the task reveals the strategy" |
| 15 | Who needs this when space matures | AI agent orchestration platforms delegating physical-world tasks without exposing their reasoning chains |

---

## The Closing Line

Every task marketplace trusts humans not to look.

**BlindBounty makes looking impossible.**

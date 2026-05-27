# CLAUDE.md — BlindMarket project instructions

BlindMarket is a **live product** (deployed on 0G Mainnet): an anonymous,
encrypted task marketplace where AI agents delegate to / hire other agents (and
humans), with on-chain escrow settlement. It is **not** a hackathon project —
do not frame work around the 0G APAC Hackathon, "Track 3", or any submission
deadline. That era is over.

## Working rules

### Verify against source before claiming or coding

The codebase is ground truth — **not** memory, not prior conversation, not these
notes, not the model's recollection. Before you:

- write code that calls an endpoint, function, type, or schema, **or**
- assert how something behaves (a route's path, a request/response field, a
  default, a flow),

…read the **current** source and confirm the actual shape. Route paths,
field names, schemas, and line numbers drift as the code changes — re-check
rather than assume. If a referenced file/route/field can't be found in the
current code, treat the reference as stale and verify, don't invent. If you
cannot verify a claim against the code, say so explicitly instead of stating it
as fact.

> Why this rule exists: memory and prior context are point-in-time snapshots and
> go stale (e.g. files get moved or deleted). Confirming against live source is
> the safeguard against acting on outdated or hallucinated assumptions.

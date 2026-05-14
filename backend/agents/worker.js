/**
 * Agent worker — forked child process per deployed agent.
 *
 * Env vars (set by agentRunner.ts):
 *   AGENT_ID, AGENT_NAME, AGENT_INSTRUCTIONS
 *   AGENT_PROVIDER, AGENT_MODEL, AGENT_API_KEY
 *   AGENT_TOOLS (JSON array of AgentTool)
 *   BACKEND_URL, POLL_INTERVAL_MS
 *
 * Lifecycle:
 *   1. Poll /api/v1/tasks?status=open (filter by capabilities)
 *   2. Apply to task via /api/v1/applications
 *   3. Wait for assignment (poll task status)
 *   4. Decrypt instructions from 0G Storage
 *   5. Call LLM with tools (HTTP, MCP, JS, A2A delegation)
 *   6. Encrypt evidence, upload to 0G Storage
 *   7. Submit evidence hash on-chain
 *   8. Send heartbeat to parent process
 */

import { generateText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';
import { createHash, randomBytes, createECDH, createDecipheriv, hkdfSync } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname as pathDirname, join as pathJoin } from 'path';
import { runInNewContext } from 'vm';
import { ethers } from 'ethers';

// ── ECIES + AES decrypt helpers — byte-compatible with backend/src/services/crypto.ts
// and frontend/src/lib/crypto.ts. Used to unwrap the AES key the poster wrapped
// to our pubkey at task-creation time, then decrypt the brief blob from 0G Storage.
const ECIES_PUBKEY_LENGTH = 65;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ECIES_HKDF_INFO = 'BlindMarket-ECIES-v1';

function aesGcmDecrypt(blob, key) {
  if (blob.length < IV_LENGTH + TAG_LENGTH) throw new Error('AES blob too short');
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = blob.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function eciesDecryptK1(blob, privKeyHex) {
  if (blob.length < ECIES_PUBKEY_LENGTH + IV_LENGTH + TAG_LENGTH) {
    throw new Error('ECIES blob too short');
  }
  const ephPub = blob.subarray(0, ECIES_PUBKEY_LENGTH);
  const aesBlob = blob.subarray(ECIES_PUBKEY_LENGTH);
  const ecdh = createECDH('secp256k1');
  const clean = privKeyHex.startsWith('0x') ? privKeyHex.slice(2) : privKeyHex;
  ecdh.setPrivateKey(Buffer.from(clean, 'hex'));
  const shared = ecdh.computeSecret(ephPub);
  const aesKey = Buffer.from(hkdfSync('sha256', shared, '', ECIES_HKDF_INFO, KEY_LENGTH));
  return aesGcmDecrypt(aesBlob, aesKey);
}

const AGENT_ID = process.env.AGENT_ID ?? 'unknown';
const AGENT_NAME = process.env.AGENT_NAME ?? 'Agent';
const AGENT_INSTRUCTIONS = process.env.AGENT_INSTRUCTIONS ?? '';
const AGENT_PROVIDER = (process.env.AGENT_PROVIDER ?? 'openai').toLowerCase();
const AGENT_MODEL = process.env.AGENT_MODEL ?? 'gpt-4o-mini';
const AGENT_API_KEY = process.env.AGENT_API_KEY ?? '';
const AGENT_PLATFORM_TOKEN = process.env.AGENT_PLATFORM_TOKEN ?? '';
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY ?? '';
// Uncompressed secp256k1 hex (130 chars, leading 04, no 0x prefix). Sent to
// /a2a/register so posters can wrap the AES key to it at task creation. Empty
// string when missing — register schema treats it as optional and the executor
// just won't be able to decrypt new encrypted-flow tasks until reconfigured.
const AGENT_PUBLIC_KEY = process.env.AGENT_PUBLIC_KEY ?? '';
const OG_RPC_URL = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
const OG_CHAIN_ID = Number(process.env.OG_CHAIN_ID ?? 16602);
const AGENT_TOOLS_RAW = process.env.AGENT_TOOLS ?? '[]';
const AGENT_CAPABILITIES_RAW = process.env.AGENT_CAPABILITIES ?? '[]';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30_000);

// Capabilities the parent agentRunner declares for us at deploy time. Used to
// auto-register as an A2A executor on startup (without registration the
// /a2a/tasks/:hash/accept handler refuses our calls with 403 NOT_REGISTERED).
// Default to a single generic capability if none configured, so an agent
// deployed without explicit caps can still pick up the simplest tasks.
let agentCapabilities = [];
try {
  const parsed = JSON.parse(AGENT_CAPABILITIES_RAW);
  if (Array.isArray(parsed) && parsed.length > 0) agentCapabilities = parsed;
} catch {}
if (agentCapabilities.length === 0) agentCapabilities = ['data_processing'];

// Ethers wallet — used to sign + broadcast the unsigned txs the backend builds
let signerWallet = null;
if (AGENT_PRIVATE_KEY) {
  try {
    const provider = new ethers.JsonRpcProvider(OG_RPC_URL, OG_CHAIN_ID);
    signerWallet = new ethers.Wallet(
      AGENT_PRIVATE_KEY.startsWith('0x') ? AGENT_PRIVATE_KEY : `0x${AGENT_PRIVATE_KEY}`,
      provider,
    );
  } catch (e) {
    console.error(`[agent:${(process.env.AGENT_ID ?? '').slice(0, 8)}] failed to init signer: ${e.message}`);
  }
}

// BlindEscrow Interface — used to decode custom-error reverts returned by
// signerWallet.sendTransaction. Without it, ethers prints "unknown custom
// error" because we send raw unsignedSubmitEvidence txs that have no local
// contract instance / ABI attached. Loaded best-effort: if the file moves or
// JSON parse fails, we just fall back to the raw shortMessage in catch blocks.
let escrowIface = null;
try {
  const abiPath = pathJoin(
    pathDirname(fileURLToPath(import.meta.url)),
    '..',
    'src',
    'abi',
    'BlindEscrow.json',
  );
  escrowIface = new ethers.Interface(JSON.parse(readFileSync(abiPath, 'utf-8')));
} catch (e) {
  console.warn(`[agent] could not load BlindEscrow ABI for revert decoding: ${e.message}`);
}

// TaskStatus enum mirror from BlindEscrow.sol. Used to render InvalidStatus
// args as human-readable names instead of raw uint8s. Order must match the
// Solidity enum — if you reorder the contract enum, update this too.
const TASK_STATUS = ['Funded', 'Assigned', 'Submitted', 'Verified', 'Completed', 'Cancelled', 'Disputed'];

/**
 * Try to decode a CALL_EXCEPTION-style error's revert data against the
 * BlindEscrow ABI. Returns { name, args } or null if no match. ethers v6 puts
 * the data on `err.data`, but some provider chains nest it under
 * `err.info.error.data` or `err.error.data`, so we probe all three.
 */
function decodeEscrowRevert(err) {
  if (!escrowIface) return null;
  const data = err?.data ?? err?.info?.error?.data ?? err?.error?.data;
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return null;
  try {
    const parsed = escrowIface.parseError(data);
    if (!parsed) return null;
    return { name: parsed.name, args: parsed.args };
  } catch {
    return null;
  }
}

/**
 * Render a decoded error as a one-line label for the log. For InvalidStatus
 * we expand both enum args (current, required) so the message is actionable
 * without needing to cross-reference the contract.
 */
function formatRevert(err) {
  const decoded = decodeEscrowRevert(err);
  if (!decoded) return err.shortMessage ?? err.message ?? String(err);
  if (decoded.name === 'InvalidStatus') {
    const cur = TASK_STATUS[Number(decoded.args[0])] ?? `enum=${decoded.args[0]}`;
    const req = TASK_STATUS[Number(decoded.args[1])] ?? `enum=${decoded.args[1]}`;
    return `InvalidStatus(current=${cur}, required=${req})`;
  }
  return `${decoded.name}()`;
}

/**
 * NotWorker and InvalidStatus(Funded, Assigned) both indicate the bridge's
 * marketplaceAssign tx hasn't confirmed yet — the contract still has
 * t.worker == address(0) and t.status == Funded. Both clear once the
 * assignment mines, so it's worth a couple of retries before giving up.
 * Everything else (DeadlineReached, EmptyHash, paused, …) is permanent.
 */
function isTransientAssignmentRevert(err) {
  const decoded = decodeEscrowRevert(err);
  if (!decoded) return false;
  if (decoded.name === 'NotWorker') return true;
  if (decoded.name === 'InvalidStatus') {
    const cur = Number(decoded.args[0]);
    return cur === 0; // Funded — assignment not yet recorded on chain
  }
  return false;
}

// Track tasks we've already applied to or are currently working on
const appliedTasks = new Set();

// Track tasks where we've already POSTed /bid after a NEEDS_WRAP. Re-bidding
// is server-side idempotent but pointless — once the poster's frontend sees
// our bid it'll wrap to us, and the next /accept will pass. Cleared only
// when the worker process restarts (rare in normal operation).
const bidPlacedTasks = new Set();

// Exit if parent process disconnects (prevents orphans)
process.on('disconnect', () => {
  log('parent disconnected, exiting');
  process.exit();
});

let agentTools = [];
try {
  agentTools = JSON.parse(AGENT_TOOLS_RAW);
} catch (e) {
  log(`failed to parse AGENT_TOOLS: ${e.message}`);
}

function getModel() {
  switch (AGENT_PROVIDER) {
    case 'anthropic': return createAnthropic({ apiKey: AGENT_API_KEY })(AGENT_MODEL);
    case 'groq':      return createGroq({ apiKey: AGENT_API_KEY })(AGENT_MODEL);
    case 'gemini':    return createGoogleGenerativeAI({ apiKey: AGENT_API_KEY })(AGENT_MODEL);
    default:          return createOpenAI({ apiKey: AGENT_API_KEY })(AGENT_MODEL);
  }
}

log(`started | provider=${AGENT_PROVIDER} model=${AGENT_MODEL} tools=${agentTools.length}`);

// ── Tool builders ────────────────────────────────────────────────────────────

function buildTools() {
  const tools = {};

  // Built-in: A2A delegation
  tools.delegate_to_agent = tool({
    description: 'Delegate a sub-task to another agent on the marketplace. Returns the result when the agent completes it.',
    inputSchema: z.object({
      taskDescription: z.string().describe('What the agent should do'),
      requiredCapabilities: z.array(z.string()).describe('Required agent capabilities (e.g., ["web_research", "summarization"])'),
    }),
    execute: async ({ taskDescription, requiredCapabilities }) => {
      try {
        // Create A2A task
        const createRes = await fetch(`${BACKEND_URL}/api/v1/a2a/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: taskDescription,
            requiredCapabilities,
            verificationMode: 'auto',
            verificationCriteria: { min_length: 10 },
          }),
        });
        if (!createRes.ok) return { error: `Failed to create A2A task: ${createRes.status}` };
        const { data: task } = await createRes.json();

        // Poll until verified or failed (max 2 minutes)
        const maxWait = 120_000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          await sleep(5000);
          const statusRes = await fetch(`${BACKEND_URL}/api/v1/a2a/tasks/${task.taskId}`);
          if (!statusRes.ok) break;
          const { data: state } = await statusRes.json();
          if (state.status === 'verified') {
            return { success: true, result: state.resultData };
          }
          if (state.status === 'failed') {
            return { error: 'Agent failed to complete task', reasons: state.verificationResult?.reasons };
          }
        }
        return { error: 'Timeout waiting for agent' };
      } catch (e) {
        return { error: e.message };
      }
    },
  });

  // Custom tools from AGENT_TOOLS
  for (const t of agentTools) {
    if (t.type === 'http') {
      tools[t.name] = tool({
        description: t.description,
        inputSchema: z.object({ input: z.string() }),
        execute: async ({ input }) => {
          try {
            const url = t.url.replace(/\{(\w+)\}/g, () => encodeURIComponent(input));
            const body = t.bodyTemplate ? t.bodyTemplate.replace(/\{\{(\w+)\}\}/g, () => input) : undefined;
            const res = await fetch(url, {
              method: t.method,
              headers: { 'Content-Type': 'application/json', ...t.headers },
              body: body ? JSON.stringify(JSON.parse(body)) : undefined,
            });
            return { status: res.status, data: await res.text() };
          } catch (e) {
            return { error: e.message };
          }
        },
      });
    } else if (t.type === 'mcp') {
      tools[t.name] = tool({
        description: t.description,
        inputSchema: z.object({ input: z.string() }),
        execute: async ({ input }) => {
          try {
            const res = await fetch(t.endpointUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tool: t.toolName, input }),
            });
            return await res.json();
          } catch (e) {
            return { error: e.message };
          }
        },
      });
    } else if (t.type === 'js') {
      tools[t.name] = tool({
        description: t.description,
        inputSchema: z.object({ input: z.string() }),
        execute: async ({ input }) => {
          try {
            const fn = runInNewContext(`(function(input) { ${t.code} })`, { console }, { timeout: 5000 });
            return { result: fn(input) };
          } catch (e) {
            return { error: e.message };
          }
        },
      });
    }
  }

  return tools;
}

// ── Main loop ────────────────────────────────────────────────────────────────
//
// Flow (against the /a2a endpoints — drives the settlement bridge end-to-end):
//   1. GET  /a2a/tasks                       → browse open agent-targeted tasks
//   2. POST /a2a/tasks/:hash/accept          → bridge fires marketplaceAssign
//   3. Wait briefly for the on-chain assign to confirm (so submit doesn't revert)
//   4. Run the LLM with the task instructions, produce a result object
//   5. POST /a2a/tasks/:hash/submit          → backend returns unsignedSubmitEvidence
//   6. Sign + broadcast submitEvidence with the agent's own wallet
//   7. POST /a2a/tasks/:hash/finalize        → backend auto-verifies (if mode=auto)
//                                              and fires settleVerification, OR returns
//                                              awaitingPosterApproval (mode=manual)
//
// `appliedTasks` (kept from before, just relabeled) is an in-process dedup so
// we don't try the same task twice in a single worker run.

async function pollAndWork() {
  try {
    sendHeartbeat();

    // 1. Browse open A2A-targeted tasks
    const url = `${BACKEND_URL}/api/v1/a2a/tasks`;
    log(`polling ${url}...`);
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AGENT_PLATFORM_TOKEN}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      log(`poll failed: ${res.status} ${errText.slice(0, 80)}`);
      return;
    }

    const json = await res.json();
    const entries = json.data?.tasks;
    if (!Array.isArray(entries)) {
      log(`unexpected /a2a/tasks shape: ${Object.keys(json.data || {}).join(', ')}`);
      return;
    }
    if (entries.length === 0) {
      log('no open A2A tasks');
      return;
    }

    // Each entry is { meta, state }. meta.taskId is the taskHash we use to
    // address subsequent /accept, /submit, /finalize calls. Capability matching
    // against the task's `requiredCapabilities` happens server-side in the
    // /accept handler (a2a.ts:105-110) using the agent's registered capability
    // list — so we don't filter here. Master's client-side capability filter
    // was for the old /tasks-based flow where the agent applied unilaterally.
    const available = entries.filter(e => !appliedTasks.has(e.meta.taskId));
    if (available.length === 0) {
      log(`found ${entries.length} open tasks, but already touched all of them`);
      return;
    }

    // 2. Accept the first one we can. /accept fails with 403/409 if caps don't
    //    match or state changed under us — try the next.
    let acceptedTaskHash = null;
    let acceptedEntry = null;
    // Captured from the accept response. Both may be absent for legacy/test
    // tasks posted before the encrypted-brief pipeline existed — handled
    // below by falling back to a non-decrypted prompt.
    let acceptedRootHash = null;
    let acceptedWrappedKey = null;
    for (const entry of available) {
      const taskHash = entry.meta.taskId;
      log(`accepting task ${taskHash.slice(0, 10)}…`);
      const acceptRes = await fetch(`${BACKEND_URL}/api/v1/a2a/tasks/${taskHash}/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AGENT_PLATFORM_TOKEN}`,
        },
      });
      if (acceptRes.ok) {
        appliedTasks.add(taskHash);
        acceptedTaskHash = taskHash;
        acceptedEntry = entry;
        try {
          const acceptJson = await acceptRes.json();
          acceptedRootHash = acceptJson.data?.rootHash ?? null;
          acceptedWrappedKey = acceptJson.data?.wrappedKey ?? null;
        } catch {
          // Non-JSON response body; treat as no brief available.
        }
        break;
      }
      const err = await acceptRes.json().catch(() => ({}));
      log(`accept failed for ${taskHash.slice(0, 10)}…: ${acceptRes.status} ${err.error?.code || ''}`);

      // NEEDS_WRAP — the task was posted before this agent registered (or
      // posted with no executors). Register intent via /bid; the poster's
      // frontend will ECIES-wrap the AES key to us on its next polling
      // cycle, and a later /accept attempt will succeed. Don't add to
      // appliedTasks so we retry — but track the bid so we don't spam.
      if (acceptRes.status === 403 && err.error?.code === 'NEEDS_WRAP') {
        if (!bidPlacedTasks.has(taskHash)) {
          try {
            const bidRes = await fetch(`${BACKEND_URL}/api/v1/a2a/tasks/${taskHash}/bid`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AGENT_PLATFORM_TOKEN}`,
              },
            });
            if (bidRes.ok) {
              bidPlacedTasks.add(taskHash);
              log(`bid registered on ${taskHash.slice(0, 10)}… — awaiting wrap`);
            } else {
              const bidErr = await bidRes.json().catch(() => ({}));
              log(`bid failed for ${taskHash.slice(0, 10)}…: ${bidRes.status} ${bidErr.error?.code || ''}`);
              // CAPABILITY_MISMATCH / NOT_REGISTERED / NO_PUBKEY from /bid
              // are terminal for us — stop retrying.
              if (bidRes.status === 403 || bidRes.status === 400) {
                appliedTasks.add(taskHash);
              }
            }
          } catch (bidErr) {
            log(`bid network error for ${taskHash.slice(0, 10)}…: ${bidErr.message || bidErr}`);
          }
        }
        continue;
      }

      // Skip-and-continue on other 403/409s; bail on transient (5xx) errors.
      if (acceptRes.status === 403 || acceptRes.status === 409) {
        appliedTasks.add(taskHash);
        continue;
      }
      return;
    }

    if (!acceptedTaskHash) {
      log(`could not accept any of the ${available.length} available tasks`);
      return;
    }

    // 3. Wait briefly for the bridge's marketplaceAssign to confirm on chain.
    //    Without this, submitEvidence broadcasts before the contract status is
    //    Assigned and would revert. 0G blocks are ~6s; 12s gives a comfortable
    //    margin without making the loop too slow.
    log(`waiting for on-chain assignment to confirm for ${acceptedTaskHash.slice(0, 10)}…`);
    await sleep(12_000);

    // 4. Decrypt the brief. The poster ECIES-wrapped the AES key to our
    //    pubkey at task-creation time; the backend stored the encrypted blob
    //    on 0G Storage and just handed us the rootHash + our wrappedKey slice
    //    in the /accept response. We unwrap the AES key with our private
    //    key, fetch the blob, AES-decrypt it, and the plaintext brief is
    //    what we feed to the LLM as the user message.
    let briefPlaintext = null;
    if (acceptedRootHash && acceptedWrappedKey && AGENT_PRIVATE_KEY) {
      try {
        const wrappedBytes = Buffer.from(acceptedWrappedKey, 'hex');
        const aesKey = eciesDecryptK1(wrappedBytes, AGENT_PRIVATE_KEY);
        log(`unwrapped AES key for ${acceptedTaskHash.slice(0, 10)}… (${aesKey.length} bytes)`);

        const dlRes = await fetch(`${BACKEND_URL}/api/v1/storage/${acceptedRootHash}`, {
          headers: { 'Authorization': `Bearer ${AGENT_PLATFORM_TOKEN}` },
        });
        if (!dlRes.ok) {
          throw new Error(`storage download ${dlRes.status}`);
        }
        const dlJson = await dlRes.json();
        const b64 = dlJson.data?.blob;
        if (!b64) throw new Error('storage response missing blob');
        const ciphertext = Buffer.from(b64, 'base64');
        const plaintext = aesGcmDecrypt(ciphertext, aesKey);
        briefPlaintext = plaintext.toString('utf8');
        log(`decrypted brief for ${acceptedTaskHash.slice(0, 10)}… (${briefPlaintext.length} chars)`);
      } catch (e) {
        // Decryption failure means we can't honestly complete the task. Skip
        // rather than fabricate — the contract's claim-timeout path will
        // reclaim the poster's escrow when the deadline passes.
        log(`brief decrypt failed for ${acceptedTaskHash.slice(0, 10)}…: ${e.message}`);
        return;
      }
    } else {
      log(`no encrypted brief on accept (rootHash=${!!acceptedRootHash} wrappedKey=${!!acceptedWrappedKey}); skipping`);
      return;
    }

    // 5. Run the LLM with the decrypted brief as the user prompt. The agent's
    //    AGENT_INSTRUCTIONS stays as the system prompt so role + output-shape
    //    constraints carry across every task. resultData is an object so it
    //    plays well with autoVerify's required_fields / min_length checks.
    log(`working on task ${acceptedTaskHash.slice(0, 10)}…`);
    const { text } = await generateText({
      model: getModel(),
      system: AGENT_INSTRUCTIONS,
      prompt: briefPlaintext,
      tools: buildTools(),
      maxSteps: 5,
    });
    const resultData = { output: text, agent: AGENT_ID };

    // 5. POST /submit — backend persists resultData and returns the unsigned
    //    submitEvidence tx for us to sign.
    log(`submitting task ${acceptedTaskHash.slice(0, 10)}…`);
    const submitRes = await fetch(`${BACKEND_URL}/api/v1/a2a/tasks/${acceptedTaskHash}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGENT_PLATFORM_TOKEN}`,
      },
      body: JSON.stringify({ resultData }),
    });
    if (!submitRes.ok) {
      const errText = await submitRes.text();
      log(`submit failed for ${acceptedTaskHash.slice(0, 10)}…: ${submitRes.status} ${errText.slice(0, 160)}`);
      return;
    }
    const submitJson = await submitRes.json();
    const unsignedSubmitEvidence = submitJson.data?.unsignedSubmitEvidence;
    if (!unsignedSubmitEvidence) {
      log(`submit response missing unsignedSubmitEvidence for ${acceptedTaskHash.slice(0, 10)}…`);
      return;
    }

    // 6. Sign + broadcast submitEvidence with the agent's own wallet (the
    //    contract requires onlyWorker for this call — the marketplace signer
    //    can't do it). Wait for the receipt so finalize has a real Submitted
    //    state to verify against.
    if (!signerWallet) {
      log(`cannot broadcast submitEvidence: signer not initialised (missing AGENT_PRIVATE_KEY)`);
      return;
    }
    // Retry on transient assignment reverts. ethers' sendTransaction does a
    // pre-broadcast eth_call, so a revert surfaces immediately without
    // burning gas — we just sleep one 0G block (~6s) and try again. Cap is
    // small because if marketplaceAssign is genuinely broken (signer out of
    // funds, waitForTaskId timed out), no amount of polling will fix it; the
    // decoded error in the final log line will tell us which.
    const MAX_SUBMIT_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 6_000;
    let broadcastOk = false;
    for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
      try {
        const sent = await signerWallet.sendTransaction(unsignedSubmitEvidence);
        log(`submitEvidence broadcast for ${acceptedTaskHash.slice(0, 10)}…: ${sent.hash}`);
        const receipt = await sent.wait();
        log(`submitEvidence confirmed for ${acceptedTaskHash.slice(0, 10)}…: block=${receipt?.blockNumber} status=${receipt?.status}`);
        broadcastOk = true;
        break;
      } catch (e) {
        const label = formatRevert(e);
        if (isTransientAssignmentRevert(e) && attempt < MAX_SUBMIT_ATTEMPTS) {
          log(`submitEvidence attempt ${attempt}/${MAX_SUBMIT_ATTEMPTS} for ${acceptedTaskHash.slice(0, 10)}…: ${label} — on-chain assignment not confirmed yet, retrying in ${RETRY_DELAY_MS / 1000}s`);
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        log(`submitEvidence broadcast failed for ${acceptedTaskHash.slice(0, 10)}… after ${attempt} attempt(s): ${label}`);
        return;
      }
    }
    if (!broadcastOk) return;

    // 7. Finalize — tells the backend to run autoVerify (auto mode) or hand
    //    off to manual approval (manual mode). For auto, the bridge then fires
    //    completeVerification and the escrow releases automatically.
    log(`finalizing task ${acceptedTaskHash.slice(0, 10)}…`);
    const finalizeRes = await fetch(`${BACKEND_URL}/api/v1/a2a/tasks/${acceptedTaskHash}/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGENT_PLATFORM_TOKEN}`,
      },
    });
    if (!finalizeRes.ok) {
      const errText = await finalizeRes.text();
      log(`finalize failed: ${finalizeRes.status} ${errText.slice(0, 160)}`);
      return;
    }
    const finalizeJson = await finalizeRes.json();
    log(`finalize result for ${acceptedTaskHash.slice(0, 10)}…: ${JSON.stringify(finalizeJson.data)}`);
  } catch (err) {
    log(`error: ${err.message}`);
  }
}

function sendHeartbeat() {
  if (process.send) {
    process.send({ type: 'heartbeat', timestamp: Date.now() });
  }
}

// Pretty timestamp for log lines. ISO-ish but trimmed to the second so the
// UI's monospace column stays narrow — `2026-05-14T10:48:05Z` rather than
// the full millisecond form. We always emit UTC so logs collected from
// different timezones line up.
function nowStamp() {
  return new Date().toISOString().slice(0, 19) + 'Z';
}

// ANSI colors are useful when a developer tails the worker locally, but the
// agent runs as a forked child piping stdout to the parent process, which
// streams it to the browser. Browsers don't interpret terminal escape codes
// — they render `\x1b[2m` as literal `[2m`. Detect "am I attached to a TTY?"
// and skip colors when we're not.
const COLORED = !!process.stdout.isTTY;
const ANSI_DIM   = COLORED ? '\x1b[2m'  : '';
const ANSI_CYAN  = COLORED ? '\x1b[36m' : '';
const ANSI_RESET = COLORED ? '\x1b[0m'  : '';

function log(msg) {
  console.log(
    `${ANSI_DIM}${nowStamp()} [agent:${ANSI_CYAN}${AGENT_ID.slice(0, 8)}${ANSI_RESET}${ANSI_DIM}]${ANSI_RESET} ${msg}`
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Register this agent as an A2A executor so the /accept handler will let it
 * claim tasks. Without this we get 403 NOT_REGISTERED on every /a2a/accept.
 * Idempotent on the backend (registerAgent overwrites existing rows), so
 * safe to call on every worker start.
 */
async function ensureRegisteredAsA2AExecutor() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/a2a/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGENT_PLATFORM_TOKEN}`,
      },
      body: JSON.stringify({
        displayName: AGENT_NAME,
        capabilities: agentCapabilities,
        // Only include publicKey if we actually have one — empty strings would
        // fail the strict regex on the backend (and break older worker images
        // that haven't been redeployed yet).
        ...(AGENT_PUBLIC_KEY ? { publicKey: AGENT_PUBLIC_KEY } : {}),
      }),
    });
    if (res.ok) {
      log(`registered as A2A executor (caps=${agentCapabilities.join(',')})`);
    } else {
      const errText = await res.text();
      log(`a2a register failed: ${res.status} ${errText.slice(0, 120)}`);
    }
  } catch (e) {
    log(`a2a register error: ${e.message}`);
  }
}

// Bootstrap: register first (so the very first poll cycle can accept), then
// start the loop. Both calls are non-blocking — register failure just means
// the first /accept will 403 and we'll retry on the next tick.
(async () => {
  await ensureRegisteredAsA2AExecutor();
  setInterval(pollAndWork, POLL_INTERVAL_MS);
  pollAndWork();
})();

import type { Request } from 'express';

/** Authenticated user attached by auth middleware */
export interface AuthUser {
  address: string;
}

/** Express request with authenticated user */
export interface AuthRequest extends Request {
  user?: AuthUser;
}

/** Standard API success response */
export interface ApiResponse<T = unknown> {
  success: true;
  data: T;
}

/** Standard API error response */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

/** On-chain task status enum (mirrors BlindEscrow.TaskStatus) */
export enum TaskStatus {
  Funded = 0,
  Assigned = 1,
  Submitted = 2,
  Verified = 3,
  Completed = 4,
  Cancelled = 5,
  Disputed = 6,
}

/** On-chain task struct (mirrors BlindEscrow.Task) */
export interface OnChainTask {
  agent: string;
  worker: string;
  token: string;
  amount: bigint;
  taskHash: string;
  evidenceHash: string;
  status: TaskStatus;
  createdAt: bigint;
  deadline: bigint;
  submissionAttempts: number;
}

/** Task metadata from TaskRegistry */
export interface TaskMeta {
  taskId: bigint;
  agent: string;
  category: string;
  locationZone: string;
  reward: bigint;
  createdAt: bigint;
  isOpen: boolean;
}

/** Reputation from BlindReputation */
export interface Reputation {
  tasksCompleted: bigint;
  totalScore: bigint;
  disputes: bigint;
}

/** In-memory application record */
export interface Application {
  id: string;
  taskId: string;
  applicant: string;
  message?: string;
  createdAt: string;
}

// ── A2A (Agent-to-Agent) types ──────────────────────────────────────

export type ExecutorType = 'human' | 'agent';
export type VerificationMode = 'manual' | 'auto' | 'oracle';

export const AGENT_CAPABILITIES = [
  'data_processing', 'web_research', 'code_execution', 'content_generation',
  'api_integration', 'text_analysis', 'translation', 'summarization',
  'image_analysis', 'document_processing', 'math_computation', 'data_extraction',
  'report_generation', 'code_review', 'testing', 'scheduling',
  'email_drafting', 'social_media', 'market_research', 'competitive_analysis',
] as const;

export type AgentCapability = typeof AGENT_CAPABILITIES[number];

export interface AgentExecutor {
  address: string;
  displayName: string;
  capabilities: AgentCapability[];
  // secp256k1 uncompressed hex (130 chars, leading `04`, no 0x prefix). Used by
  // posters at task-creation time to ECIES-wrap the AES key so only this
  // executor can decrypt the brief. Optional for back-compat with executors
  // registered before this field existed — they can't accept encrypted tasks
  // until they re-register.
  publicKey?: string;
  agentCardUrl?: string;
  mcpEndpointUrl?: string;
  reputation: number; // 0-100
  tasksCompleted: number;
  // Sum of worker payouts in smallest token unit (e.g. USDC micro-units; 6
  // decimals). Stored as a decimal string because BigInt doesn't survive
  // JSON.stringify. Optional for back-compat with rows written before this
  // field existed — readers must default to "0".
  totalEarnedRaw?: string;
  registeredAt: string;
}

export interface A2ATaskMeta {
  taskId: string;
  targetExecutorType: ExecutorType;
  verificationMode: VerificationMode;
  verificationCriteria?: VerificationCriteria;
  requiredCapabilities: AgentCapability[];
  // Address of the EOA that posted the task (authenticated at POST /api/v1/tasks
  // time). Indexed in a2aStore so a poster can query their own pending-review
  // inbox without scanning all tasks.
  posterAddress?: string;
  // 0G Storage root hash of the AES-encrypted brief. The executor downloads
  // this and AES-decrypts with the unwrapped AES key (see wrappedKeys).
  // Optional for back-compat with H2H tasks and pre-pivot test data.
  rootHash?: string;
  // ECIES-wrapped AES key, one entry per eligible executor. Keys are
  // lowercased EOA addresses; values are hex-encoded ECIES blobs. At /accept
  // time the backend returns wrappedKeys[lowercased(caller_address)] so only
  // the accepting executor receives a slice they can decrypt with their
  // own private key. Posters wrap browser-side — backend never sees the AES
  // key in plaintext, preserving the "architecturally blind" invariant.
  wrappedKeys?: Record<string, string>;
  // Key custody (docs/TEE-REWRAP-SPEC.md): the brief AES key ECIES-sealed to
  // the platform's custody key, so a late-joining agent — one not in the
  // post-time wrappedKeys snapshot — can be served a re-wrapped slice on
  // /accept with no poster present. `keyId` binds the blob to the exact custody
  // key that can unwrap it (enables rotation + the operator→enclave migration);
  // `blob` is a hex ECIES blob (no 0x), same format as wrappedKeys values. The
  // re-wrap happens only AFTER a winning /accept CAS (winner-only — CAS losers
  // never see it). Present only when KEY_CUSTODY_ENABLED at post time.
  keyCustodyBlob?: { keyId: string; blob: string };
}

export type A2ATaskStateStatus =
  | 'open'
  | 'accepted'
  | 'in_progress'
  | 'submitted'
  | 'verified'
  | 'completed'
  | 'failed';

export interface A2ATaskState {
  taskId: string;
  status: A2ATaskStateStatus;
  executorAddress?: string;
  acceptedAt?: string;
  submittedAt?: string;
  resultData?: Record<string, unknown>;
  verificationResult?: { passed: boolean; reasons: string[]; score?: number; breakdown?: Array<{ name: string; score: number; weight: number; reason: string; error?: string }>; errors?: Record<string, string> };
  // Settlement-bridge bookkeeping. Existence of these hashes means the
  // corresponding on-chain call has at least been broadcast; absence means
  // the bridge hasn't run yet (or the broadcast failed and was logged).
  assignTxHash?: string;
  verifyTxHash?: string;
  // Persisted error from the most recent fire-and-forget bridge call. If
  // set, the bridge attempt blew up before the on-chain state could move —
  // /submit-result and /finalize use these to short-circuit with a clear
  // BRIDGE_FAILED code instead of looping on NOT_ASSIGNED_YET forever.
  assignError?: string;
  verifyError?: string;
}

export interface VerificationCriteria {
  // Legacy (backward-compatible)
  required_fields?: string[];
  min_length?: number;
  contains_keywords?: string[];

  // New rubric fields
  max_length?: number;
  expected_answer?: string;            // exact or fuzzy expected output
  forbidden_phrases?: string[];        // output must NOT contain these
  regex_pattern?: string;              // regex the output must match
  expected_schema?: {
    type?: string;
    required?: string[];
    properties?: Record<string, { type?: string }>;
  };
  rubric?: Array<{                     // custom per-criterion scoring
    criterion: string;                 // human-readable label
    keywords?: string[];               // keywords to check for
    min_mentions?: number;             // minimum keyword occurrences
    weight?: number;                   // weight (default 1)
  }>;
  pass_threshold?: number;             // 0-100, default 60. Score must meet this to pass.
}

// ---- Forensic Evidence Verification ----

export interface ExifData {
  make?: string;
  model?: string;
  dateTime?: string;
  dateTimeOriginal?: string;
  gpsLat?: number;
  gpsLng?: number;
  software?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export type PhotoSource = 'camera' | 'gallery' | 'screenshot' | 'edited' | 'unknown';

export interface DeviceFingerprint {
  screenWidth: number;
  screenHeight: number;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  webglRenderer: string;
  userAgent: string;
  platform: string;
}

export interface FreshnessResult {
  photoAgeMs: number | null;
  submissionTimestamp: number;
  isFresh: boolean;
  maxAgeMs: number;
}

export interface ForensicReport {
  version: 1;
  taskId: string;
  workerAddress: string;
  timestamp: number;
  exif: ExifData;
  photoSource: PhotoSource;
  phash: string;
  deviceFingerprint: DeviceFingerprint;
  freshness: FreshnessResult;
  tamperingSignals: string[];
  reportHash: string;
}

export interface SignedForensicReport {
  report: ForensicReport;
  signature: string;
}

export interface ForensicCheck {
  name: string;
  passed: boolean;
  severity: 'critical' | 'warning' | 'info';
  detail: string;
}

export interface ForensicValidation {
  overallScore: number;
  passed: boolean;
  checks: ForensicCheck[];
  flags: string[];
}

export type TaskForensicCategory = 'physical_presence' | 'location_based' | 'creative' | 'general';

// ── Agent Tool types ─────────────────────────────────────────────────────────

/** HTTP tool — agent calls an external REST endpoint */
export interface HttpAgentTool {
  type: 'http';
  name: string;           // tool name exposed to the LLM
  description: string;
  url: string;            // endpoint URL (may include {param} placeholders)
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: string;  // JSON template with {{param}} substitutions
}

/** MCP tool — agent connects to a Model Context Protocol server */
export interface McpAgentTool {
  type: 'mcp';
  name: string;
  description: string;
  endpointUrl: string;    // MCP server URL
  toolName: string;       // specific tool on the MCP server to invoke
}

/** JS eval tool — agent runs a sandboxed JS snippet (Node vm module) */
export interface JsAgentTool {
  type: 'js';
  name: string;
  description: string;
  code: string;           // JS function body: receives (input: string) => string
}

export type AgentTool = HttpAgentTool | McpAgentTool | JsAgentTool;

// ── Deployed Agent types ─────────────────────────────────────────────────────

export type AgentStatus = 'stopped' | 'running' | 'paused';
export type LLMProvider = 'openai' | 'anthropic' | 'groq' | 'gemini';

export const LLM_PROVIDER_MODELS: Record<LLMProvider, string[]> = {
  openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-3-haiku-20240307'],
  groq:      ['llama-3.3-70b-versatile', 'llama3-8b-8192', 'mixtral-8x7b-32768'],
  gemini:    ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
};

export interface DeployedAgent {
  id: string;
  ownerAddress: string;
  name: string;
  instructions: string;
  provider: LLMProvider;
  model: string;
  apiKey: string;           // ECIES-encrypted at rest; plaintext only in worker env
  encryptedApiKey: string;  // ECIES blob encrypted to owner pubkey
  capabilities: AgentCapability[];
  tools: AgentTool[];       // custom tools the agent can call
  status: AgentStatus;
  deployedAt: string;
  lastActiveAt?: string;    // updated on each heartbeat from worker
  storageRef?: string;
  platformToken?: string;   // HS256 JWT for backend auth
  // On-chain identity — generated at deploy time
  walletAddress: string;
  publicKey: string;
  encryptedPrivateKey: string;
  // Server-custodial copy of the raw signing key. Lets the worker autonomously
  // sign on-chain calls (e.g. submitEvidence) without owner involvement. Demo-
  // grade custody — production would replace this with an EIP-712 owner-signed
  // delegation that the contract verifies, so the backend never holds the key.
  rawPrivateKey?: string;
  inftTokenId?: number;
}

export interface TaskForensicRequirement {
  requireFreshPhoto: boolean;
  maxPhotoAgeMs: number;
  requireGps: boolean;
  gpsCenter?: { lat: number; lng: number };
  gpsRadiusMeters?: number;
  requireCameraSource: boolean;
  category: TaskForensicCategory;
}

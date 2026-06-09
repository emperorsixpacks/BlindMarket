export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type TaskId = bigint;
export type RootHash = Hex;

export type TokenSymbol = 'USDC' | 'A0GI' | string;

export interface TokenRef {
  address: Address;
  symbol?: TokenSymbol;
  decimals?: number;
}

export interface Reward {
  token: Address | TokenSymbol;
  amount: bigint;
}

export type TaskStatus =
  | 'funded'
  | 'assigned'
  | 'submitted'
  | 'verified'
  | 'completed'
  | 'cancelled';

export interface TaskMetadata {
  category: string;
  locationZone: string;
  reward: Reward;
  deadline?: Date;
  extra?: Record<string, string>;
}

export interface TaskRecord extends TaskMetadata {
  taskId: TaskId;
  agent: Address;
  worker?: Address;
  taskHash: RootHash;
  evidenceHash?: RootHash;
  status: TaskStatus;
  createdAt: Date;
}

export interface TaskKey {
  /** AES-256 symmetric key (32 bytes) used to encrypt task content. */
  aesKey: Uint8Array;
  createdAt: Date;
}

export interface TaskKeyRef {
  taskId: TaskId;
  createdAt: Date;
}

export interface UploadResult {
  rootHash: RootHash;
  txHash?: Hex;
  size: number;
}

export interface VerificationResult {
  passed: boolean;
  confidence: number;
  model: string;
  attestation?: Hex;
  completedAt: Date;
}

export interface TxReceiptLike {
  hash: Hex;
  blockNumber: number;
  gasUsed: bigint;
}

export type Awaitable<T> = T | Promise<T>;

// ── REST API types ──────────────────────────────────────────────────────────

export interface HealthStatus {
  status: string;
  timestamp: string;
}

export interface PlatformStats {
  openTasks: number;
  activeAgents: number;
  activeValidators: number;
  totalAgents: number;
  registeredUsers: number;
  completedTasks: number;
  activeWorkers: number;
}

export interface OpenTask {
  id: number;
  agent: Address;
  worker?: Address;
  amount: string;
  token: Address;
  category: string;
  locationZone: string;
  deadline: number;
  status: number;
  taskHash?: Hex;
}

export interface CreateTaskTx {
  unsignedTx: {
    to: Address;
    data: Hex;
    value?: string;
  };
}

export interface TaskDetail extends OpenTask {
  metadata?: Record<string, unknown>;
  a2aState?: A2ATaskState;
}

export interface A2ATaskState {
  taskId: string;
  status: string;
  executorAddress?: string;
  acceptedAt?: string;
  submittedAt?: string;
  resultData?: Record<string, unknown> | null;
  verificationResult?: {
    passed: boolean;
    reasons: string[];
    score?: number;
    breakdown?: Array<{ name: string; score: number; weight: number; reason: string; error?: string }>;
  };
  assignTxHash?: Hex;
  verifyTxHash?: Hex;
  wrappedKeys?: Record<string, string>;
}

export interface ExecutorProfile {
  address: Address;
  displayName: string;
  capabilities: string[];
  publicKey: string;
  reputation: number;
  tasksCompleted: number;
  totalEarnedRaw: string;
  minReward?: string;
  preferredCapabilities?: string[];
  registeredAt: string;
  decayedScore?: number;
  disputeRatio?: number;
  avgRating?: number;
}

export interface RegisterExecutorInput {
  address: Address;
  displayName: string;
  capabilities: string[];
  publicKey: string;
  agentCardUrl?: string;
  mcpEndpointUrl?: string;
  minReward?: string;
  preferredCapabilities?: string[];
}

export interface DeployedAgentInfo {
  id: string;
  name: string;
  ownerAddress: Address;
  walletAddress: Address;
  publicKey: string;
  status: string;
  provider: string;
  model: string;
  capabilities: string[];
  inftTokenId?: number;
  deployedAt: string;
  lastActiveAt?: string;
  minReward?: string;
}

export interface AgentWalletInfo {
  walletAddress: Address;
  publicKey: string;
}

export interface ReputationInfo {
  address: Address;
  onChainScore: number;
  decayedScore: number;
  totalTasks: number;
  disputesLost: number;
  disputeRatio: number;
}

export interface LeaderboardEntry extends ReputationInfo {
  rank: number;
  displayName?: string;
}

export interface StorageUploadResult {
  rootHash: RootHash;
  size: number;
}

export interface Message {
  id: number;
  taskId: string;
  fromAddress: Address;
  toAddress: Address;
  content: string;
  read: boolean;
  createdAt: string;
}

export interface AgentSearchResult {
  address: Address;
  displayName: string;
  capabilities: string[];
  avgRating: number;
  reviewCount: number;
  badgeCount: number;
  reputation: number;
}

export interface TaskTemplate {
  id: number;
  title: string;
  description: string;
  category: string;
  instructions: string;
  verificationCriteria: Record<string, unknown>;
  requiredCapabilities?: string[];
  estimatedReward?: string;
}

export interface VerifyTaskInput {
  taskId: number;
  taskCategory: string;
  taskRequirements: string;
  evidenceSummary: string;
}

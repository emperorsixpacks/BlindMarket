import 'dotenv/config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

const IS_PROD = process.env.NODE_ENV === 'production';

export const config = {
  port: parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  // Verification fails CLOSED: with 0G Compute unconfigured the sealed
  // verifier refuses to verify instead of auto-passing. Only an explicit
  // opt-in (or the vitest 'test' env) re-enables the local auto-pass stub,
  // and production ignores the flag entirely. See services/verification.ts.
  allowInsecureLocalVerify: optional('ALLOW_INSECURE_LOCAL_VERIFY', 'false').toLowerCase() === 'true',

  // 0G Chain
  chainType: optional('CHAIN_TYPE', 'evm') as 'evm' | 'sui',
  ogRpcUrl: optional('OG_RPC_URL', IS_PROD ? 'https://evmrpc.0g.ai' : 'https://evmrpc-testnet.0g.ai'),
  ogChainId: parseInt(optional('OG_CHAIN_ID', IS_PROD ? '16661' : '16602'), 10),

  // Sui Chain
  suiRpcUrl: optional('SUI_RPC_URL', 'https://fullnode.testnet.sui.io:443'),
  suiNetworkId: optional('SUI_NETWORK_ID', 'testnet') as 'mainnet' | 'testnet' | 'devnet' | 'local',
  suiPackageId: optional('SUI_PACKAGE_ID', '0x0'),
  suiBlindEscrowObjectId: optional('SUI_BLIND_ESCROW_OBJECT_ID', '0x0'),
  suiTaskRegistryObjectId: optional('SUI_TASK_REGISTRY_OBJECT_ID', '0x0'),
  suiBlindReputationObjectId: optional('SUI_BLIND_REPUTATION_OBJECT_ID', '0x0'),
  suiAdminCapId: optional('SUI_ADMIN_CAP_ID', '0x0'),
  suiAgentPrivateKey: process.env.SUI_AGENT_PRIVATE_KEY || '',

  // Contracts
  blindEscrowAddress: optional('BLIND_ESCROW_ADDRESS', IS_PROD ? '0x3d0374963DaaD43e31d42373eb11156A8e8ce2Ff' : '0x7B420523E2b5d6C0f0e5deF75b1D9a901167f041'),
  taskRegistryAddress: optional('TASK_REGISTRY_ADDRESS', IS_PROD ? '0x9CCF9c196006B573FaA9C9c9CebDd1296dbd5cE0' : '0xF6AaCce326fD7f25860f383f18A771E5d089ea8c'),
  blindReputationAddress: optional('BLIND_REPUTATION_ADDRESS', IS_PROD ? '0x3af9232009C5da30AdA366B6E09849A040162A1a' : '0xFEAFe4ab073FfB47aBb5AD458622b3F9B10C81dD'),
  inftAddress: optional('INFT_ADDRESS', IS_PROD ? '0xfE70a007AFD022A4824d1975A1facFA266F66E28' : '0xff29617270b3B6f565e1eC206C0A69F8966aBd2b'),

  // Auth — Privy is the sole identity provider; agent API key for service callers
  agentApiKey: process.env.AGENT_API_KEY || '',
  privyAppId: required('PRIVY_APP_ID').trim(),
  // Used only by registration.ts to mint long-lived agent CLI tokens.
  // No longer accepted by requireAuth — that path is Privy-only.
  jwtSecret: process.env.JWT_SECRET || '',

  // Database (Neon PostgreSQL)
  databaseUrl: process.env.DATABASE_URL || '',

  // CORS
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173').split(',').map(s => s.trim()),

  // 0G Storage (Phase 3)
  ogStorageIndexerRpc: process.env.OG_STORAGE_INDEXER_RPC || '',
  ogStoragePrivateKey: process.env.OG_STORAGE_PRIVATE_KEY || '',

  // Marketplace signer — holds the verifier role on BlindEscrow. Used by the
  // A2A settlement bridge (services/a2aSettlement.ts) to call marketplaceAssign
  // and completeVerification on agent-targeted tasks. Generated and rotated
  // via contracts/scripts/generate-marketplace-signer.ts + rotate-verifier.ts.
  marketplaceSignerPrivateKey: process.env.MARKETPLACE_SIGNER_PRIVATE_KEY || '',

  // Forensic verification
  forensicMaxPhotoAgeMs: parseInt(optional('FORENSIC_MAX_PHOTO_AGE_MS', '1800000'), 10),  // 30 min
  forensicPhashThreshold: parseInt(optional('FORENSIC_PHASH_THRESHOLD', '10'), 10),

  // 0G Compute / Sealed Inference (Phase 4)
  // Private key for the broker wallet (pays for inference requests)
  ogComputePrivateKey: process.env.OG_COMPUTE_PRIVATE_KEY || '',
  // Optional: preferred provider address (if empty, auto-selects from available services)
  ogComputeProviderAddress: process.env.OG_COMPUTE_PROVIDER_ADDRESS || '',
  // RPC for compute network (defaults to testnet)
  ogComputeRpcUrl: optional('OG_COMPUTE_RPC_URL', 'https://evmrpc-testnet.0g.ai'),

  // Key custody / late-joiner re-wrap (docs/TEE-REWRAP-SPEC.md). DEFAULT OFF.
  // When enabled, posters seal the brief AES key to a platform-held custody key
  // so an agent that registers AFTER a task was posted can be served a
  // re-wrapped slice on /accept, with no poster present. With backend=local the
  // operator CAN read every sealed brief key — keyCustodyService.ts logs a loud
  // warning at boot, and this posture must be disclosed (spec §9). tdx/zg-oracle
  // are not implemented yet. KEY_CUSTODY_PRIVATE_KEY is a crown-jewel secret.
  keyCustody: {
    enabled: optional('KEY_CUSTODY_ENABLED', 'false') === 'true',
    backend: optional('KEY_CUSTODY_BACKEND', 'local') as 'local' | 'tdx' | 'zg-oracle',
    privateKey: process.env.KEY_CUSTODY_PRIVATE_KEY || '',
  },
} as const;

// Mainnet chain id — kept in sync with the production default above.
const MAINNET_CHAIN_ID = 16661;

/**
 * Fail-fast boot assertions. Call once at startup (before the server binds) so a
 * misconfigured production deploy dies loudly with an actionable message instead
 * of failing deep at runtime (an agent that can't mint a token, a bridge that
 * silently can't settle, a prod backend pointed at testnet contracts).
 *
 * Deliberately conservative — this guards a LIVE product, so it only HARD-FAILS
 * on misconfigurations that are never legitimate in production, and otherwise
 * warns. The chain-id assert has an ALLOW_NONMAINNET_PROD escape hatch for the
 * rare intentional prod-on-testnet (staging) deploy.
 */
export function assertBootConfig(): void {
  const isProd = config.nodeEnv === 'production';
  const fatals: string[] = [];
  const warnings: string[] = [];

  if (isProd) {
    // JWT_SECRET signs the 365d agent platform tokens (agentRunner). Empty in
    // prod means agents can't start and any token path is unsigned — never valid.
    if (!config.jwtSecret) {
      fatals.push('JWT_SECRET is empty in production — deployed agents cannot mint platform tokens and will fail to start.');
    }

    // A prod backend on the testnet chain id is the cross-chain poaching footgun
    // (it would act on mainnet task ids against testnet escrow). Refuse, unless
    // the operator explicitly opts into a non-mainnet prod deploy.
    const allowNonMainnet = process.env.ALLOW_NONMAINNET_PROD === 'true';
    if (config.chainType === 'evm' && config.ogChainId !== MAINNET_CHAIN_ID && !allowNonMainnet) {
      fatals.push(`OG_CHAIN_ID=${config.ogChainId} in production — expected mainnet ${MAINNET_CHAIN_ID}. Refusing to boot a production backend against a non-mainnet chain (set ALLOW_NONMAINNET_PROD=true to override for staging).`);
    }
    if (config.chainType === 'sui' && config.suiNetworkId === 'testnet' && !allowNonMainnet) {
      fatals.push(`SUI_NETWORK_ID=${config.suiNetworkId} in production — refusing to boot production backend against Sui testnet (set ALLOW_NONMAINNET_PROD=true to override).`);
    }

    // Degraded-but-not-fatal: the bridge being optional is an existing design
    // choice, and persistence may be SQLite-only in some deploys.
    if (!config.marketplaceSignerPrivateKey) {
      warnings.push('MARKETPLACE_SIGNER_PRIVATE_KEY is empty — the A2A settlement bridge is DISABLED; agent tasks will accept/submit off-chain but never settle on-chain.');
    }
    if (!config.databaseUrl) {
      warnings.push('DATABASE_URL is empty in production — Neon-backed persistence is unavailable.');
    }
  }

  for (const w of warnings) console.warn(`[config] ⚠ ${w}`);

  if (fatals.length > 0) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(`[config] ⛔ ${fatals.length} fatal boot-config problem(s) — refusing to start:`);
    for (const f of fatals) console.error(`    • ${f}`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    throw new Error(`Invalid boot config: ${fatals.length} fatal problem(s) — see logs above.`);
  }
}

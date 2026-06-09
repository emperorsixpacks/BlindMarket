import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { AppError } from './errorHandler.js';
import type { AuthRequest } from '../types.js';
import { lookupApiKey } from '../services/apiKeyStore.js';

/** Constant-time string comparison to prevent timing attacks on API keys */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Check if a string is the configured legacy agent API key (timing-safe) */
function isLegacyAgentApiKey(candidate: string): boolean {
  return !!(config.agentApiKey && safeCompare(candidate, config.agentApiKey));
}

// Jose-based JWKS set
let remoteJWKSet: ReturnType<typeof createRemoteJWKSet> | null = null;

async function getJWKS() {
  if (!config.privyAppId) return null;
  if (remoteJWKSet) return remoteJWKSet;

  const app_id = config.privyAppId;
  const urls = [
    `https://auth.privy.io/api/v1/apps/${app_id}/jwks.json`,
    `https://auth.privy.io/api/v1/apps/${app_id}/jwks`,
    `https://auth.privy.io/api/v1/apps/${app_id}/.well-known/jwks.json`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`[Auth] JWKS found at: ${url}`);
        remoteJWKSet = createRemoteJWKSet(new URL(url));
        return remoteJWKSet;
      }
      console.warn(`[Auth] JWKS not found at ${url} (Status: ${res.status})`);
    } catch (err: any) {
      console.warn(`[Auth] Failed to reach ${url}: ${err.message}`);
    }
  }

  // Diagnostic: check if the app exists at all
  try {
    const appRes = await fetch(`https://auth.privy.io/api/v1/apps/${app_id}`);
    console.warn(`[Auth] Diagnostic base app check (${app_id}): ${appRes.status} ${appRes.statusText}`);
  } catch (e: any) {
    console.warn(`[Auth] Diagnostic base app check failed: ${e.message}`);
  }

  // Fallback to the first one even if it failed, so jose can try its own internal fetch/retry
  remoteJWKSet = createRemoteJWKSet(new URL(urls[0]));
  return remoteJWKSet;
}

/** Verify a Privy JWT using jose */
async function verifyPrivyToken(token: string): Promise<{ address: string; addresses?: string[] }> {
  const JWKS = await getJWKS();
  if (!JWKS) throw new Error('Privy not configured (missing PRIVY_APP_ID)');

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      audience: config.privyAppId,
    });

    const allAddresses = extractAllWalletAddresses(payload as any);
    const primary = allAddresses.find(a => a.startsWith('0x')) || null;
    if (!primary) {
      console.warn(`[Auth] No wallet found in token. Available keys: ${Object.keys(payload).join(', ')}`);
      throw new Error('No wallet address in Privy token');
    }

    return { address: primary, addresses: allAddresses };
  } catch (err: any) {
    throw err;
  }
}

/** Extract all wallet addresses from Privy JWT claims */
function extractAllWalletAddresses(payload: any): string[] {
  const addresses: string[] = [];

  // 1. Check for the preferred 'wallet_address' claim
  if (typeof payload.wallet_address === 'string') addresses.push(payload.wallet_address);

  // 2. Check linked_accounts array
  let accounts = payload.linked_accounts;
  if (typeof accounts === 'string') {
    try {
      accounts = JSON.parse(accounts);
    } catch { /* ignore */ }
  }
  if (Array.isArray(accounts)) {
    for (const a of accounts) {
      if (a.type === 'wallet' && typeof a.address === 'string' && a.address.startsWith('0x')) {
        if (!addresses.includes(a.address)) addresses.push(a.address);
      }
    }
  }

  // 3. Last resort: check sub if it's an address
  if (typeof payload.sub === 'string' && payload.sub.startsWith('0x')) {
    if (!addresses.includes(payload.sub)) addresses.push(payload.sub);
  }

  return addresses;
}

/**
 * Verify a registration-minted JWT (HS256, signed with JWT_SECRET in
 * routes/registration.ts). Identified by carrying both `address` and
 * `ownerAddress` claims — generic HS256 tokens without those are rejected,
 * so this isn't a re-introduction of the old SIWE end-user auth.
 */
function verifyRegistrationToken(token: string): { address: string; ownerAddress?: string } | null {
  if (!config.jwtSecret) {
    console.warn('[Auth] Registration token rejected: JWT_SECRET not configured');
    return null;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !payload) {
      console.warn('[Auth] Registration token rejected: Invalid payload type');
      return null;
    }
    const claims = payload as Record<string, unknown>;
    if (typeof claims.address !== 'string' || typeof claims.ownerAddress !== 'string') {
      console.warn('[Auth] Registration token rejected: Missing address or ownerAddress claims', Object.keys(claims));
      return null;
    }
    return { address: claims.address, ownerAddress: claims.ownerAddress as string };
  } catch (err: any) {
    console.warn('[Auth] Registration token verification failed:', err.message);
    return null;
  }
}

/**
 * Auth middleware: accepts Privy JWT, registration-minted JWT, DB-backed API key,
 * or legacy X-API-Key (AGENT_API_KEY env var).
 * Attaches `req.user = { address }` on success.
 */
export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  // 1. Check X-API-Key header (for SDK agents)
  const apiKey = req.headers['x-api-key'] as string | undefined;

  // 2. Check Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  const candidate = apiKey || token;
  if (!candidate) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  // Check DB-backed API key (async)
  lookupApiKey(candidate).then((key) => {
    if (key) {
      req.user = { address: key.ownerAddress, addresses: [key.ownerAddress] };
      next();
      return;
    }

    // Fall through to legacy / JWT checks
    if (isLegacyAgentApiKey(candidate)) {
      req.user = { address: 'agent' };
      next();
      return;
    }

    // Registration-minted JWT (CLI/SDK agents)
    if (token) {
      const regUser = verifyRegistrationToken(token);
      if (regUser) {
        req.user = regUser;
        next();
        return;
      }

      // Privy JWT (browser users)
      verifyPrivyToken(token)
        .then((user) => {
          req.user = user;
          next();
        })
        .catch((err) => {
          console.error('[Auth] Privy verification failed:', err.message);
          next(new AppError(401, 'INVALID_TOKEN', `Invalid or expired token: ${err.message}`));
        });
      return;
    }

    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }).catch((err) => {
    next(new AppError(500, 'AUTH_ERROR', err.message));
  });
}

/**
 * Founder gate. Run AFTER requireAuth — checks req.user.address against
 * the FOUNDER_ADDRESSES env var (comma-separated, case-insensitive).
 * Treats absence of FOUNDER_ADDRESSES as "no one is a founder" so production
 * deploys never accidentally expose admin views.
 */
export function requireFounder(req: AuthRequest, _res: Response, next: NextFunction): void {
  const raw = process.env.FOUNDER_ADDRESSES || '';
  const founders = new Set(
    raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  );

  const address = req.user?.address?.toLowerCase();
  if (!address || !founders.has(address)) {
    next(new AppError(403, 'FORBIDDEN', 'Founder access required'));
    return;
  }
  next();
}

/**
 * Optional auth — attaches user if a valid Privy / registration-JWT /
 * DB-backed API key / legacy API key token is present, continues regardless.
 */
export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const candidate = apiKey || token;
  if (!candidate) {
    next();
    return;
  }

  // Try DB-backed API key
  lookupApiKey(candidate).then((key) => {
    if (key) {
      req.user = { address: key.ownerAddress, addresses: [key.ownerAddress] };
      next();
      return;
    }

    if (!token) {
      next();
      return;
    }

    // Legacy API key
    if (isLegacyAgentApiKey(token)) {
      req.user = { address: 'agent' };
      next();
      return;
    }

    // Registration-minted JWT
    const regUser = verifyRegistrationToken(token);
    if (regUser) {
      req.user = regUser;
      next();
      return;
    }

    // Privy JWT
    verifyPrivyToken(token)
      .then((user) => {
        req.user = user;
        next();
      })
      .catch(() => next());
  }).catch(() => next());
}

import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { AppError } from './errorHandler.js';
import type { AuthRequest } from '../types.js';

/** Constant-time string comparison to prevent timing attacks on API keys */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Check if a string is the configured agent API key (timing-safe) */
function isAgentApiKey(candidate: string): boolean {
  return !!(config.agentApiKey && safeCompare(candidate, config.agentApiKey));
}

// Privy JWKS client (lazily initialized)
let jwksClient: jwksRsa.JwksClient | null = null;

function getJwksClient(): jwksRsa.JwksClient | null {
  if (!config.privyAppId) return null;
  if (!jwksClient) {
    jwksClient = jwksRsa({
      jwksUri: `https://auth.privy.io/api/v1/apps/${config.privyAppId}/jwks`,
      cache: true,
      cacheMaxAge: 3600000, // 1 hour
      rateLimit: true,
    });
  }
  return jwksClient;
}

/** Verify a Privy JWT using JWKS */
async function verifyPrivyToken(token: string): Promise<{ address: string }> {
  const client = getJwksClient();
  if (!client) throw new Error('Privy not configured');

  // Decode header to get kid
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
    throw new Error('Invalid token header');
  }

  const key = await client.getSigningKey(decoded.header.kid);
  const signingKey = key.getPublicKey();

  const payload = jwt.verify(token, signingKey, {
    algorithms: ['RS256'],
    issuer: 'privy.io',
    audience: config.privyAppId,
  }) as jwt.JwtPayload;

  // Extract wallet address from Privy token claims
  // Privy stores linked accounts in the token
  const walletAddress = extractWalletAddress(payload);
  if (!walletAddress) {
    throw new Error('No wallet address in Privy token');
  }

  return { address: walletAddress };
}

/** Extract wallet address from Privy JWT claims */
function extractWalletAddress(payload: jwt.JwtPayload): string | null {
  // Privy stores linked accounts in custom claims
  // The wallet address may be in linked_accounts or directly in the sub
  const linkedAccounts = (payload as Record<string, unknown>).linked_accounts;
  if (Array.isArray(linkedAccounts)) {
    const walletAccount = linkedAccounts.find(
      (a: Record<string, unknown>) => a.type === 'wallet' && typeof a.address === 'string'
    );
    if (walletAccount) return (walletAccount as Record<string, string>).address;
  }

  // Fallback: check if wallet_address is directly in claims
  if (typeof (payload as Record<string, unknown>).wallet_address === 'string') {
    return (payload as Record<string, string>).wallet_address;
  }

  // Last resort: use sub (Privy user ID) as identifier
  if (payload.sub) return payload.sub;

  return null;
}

/** Try legacy HS256 JWT verification (backwards compat) */
function verifyLegacyToken(token: string): { address: string } | null {
  if (!config.jwtSecret) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !payload || typeof (payload as Record<string, unknown>).address !== 'string') {
      return null;
    }
    return { address: (payload as Record<string, string>).address };
  } catch {
    return null;
  }
}

/**
 * Auth middleware: accepts Privy JWT, legacy JWT, or X-API-Key.
 * Attaches `req.user = { address }` on success.
 */
export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  // 1. Check X-API-Key header (for agent operations)
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey && isAgentApiKey(apiKey)) {
    req.user = { address: 'agent' };
    next();
    return;
  }

  // 2. Check Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const token = authHeader.slice(7);

  // Check if it's the API key passed as Bearer
  if (isAgentApiKey(token)) {
    req.user = { address: 'agent' };
    next();
    return;
  }

  // Try Privy JWKS verification (async), then fall back to legacy
  verifyPrivyToken(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => {
      // Fall back to legacy HS256 JWT
      const legacyUser = verifyLegacyToken(token);
      if (legacyUser) {
        req.user = legacyUser;
        next();
        return;
      }
      next(new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token'));
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
 * Optional auth — attaches user if token present, continues regardless.
 */
export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);

  // API key check
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if ((apiKey && isAgentApiKey(apiKey)) || isAgentApiKey(token)) {
    req.user = { address: 'agent' };
    next();
    return;
  }

  // Try Privy, then legacy, then continue without auth
  verifyPrivyToken(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => {
      const legacyUser = verifyLegacyToken(token);
      if (legacyUser) {
        req.user = legacyUser;
      }
      next();
    });
}

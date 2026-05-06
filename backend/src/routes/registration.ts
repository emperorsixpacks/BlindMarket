import { Router } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { ApiResponse } from '../types.js';

export const registrationRouter = Router();

interface RegSession {
  token: string;
  agentName: string;
  agentWallet: string;
  agentPublicKey: string;
  status: 'pending' | 'confirmed' | 'expired';
  ownerAddress?: string;
  apiKey?: string;
  createdAt: number;
}

// In-memory store — sessions expire after 10 minutes
const sessions = new Map<string, RegSession>();
const SESSION_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(k);
  }
}, 60_000);

/**
 * POST /api/v1/registration/session
 * CLI calls this to start a device-flow registration.
 * Returns a token + magic link URL for the user to open.
 */
registrationRouter.post('/session', (req, res) => {
  const { agentName, agentWallet, agentPublicKey } = req.body as {
    agentName?: string;
    agentWallet?: string;
    agentPublicKey?: string;
  };

  if (!agentName || !agentWallet || !agentPublicKey) {
    res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'agentName, agentWallet, agentPublicKey required' } });
    return;
  }

  const token = randomBytes(24).toString('hex');
  sessions.set(token, {
    token,
    agentName,
    agentWallet,
    agentPublicKey,
    status: 'pending',
    createdAt: Date.now(),
  });

  const frontendUrl = process.env.FRONTEND_URL ?? config.corsOrigin[0] ?? 'https://www.blindmarket.xyz';
  const url = `${frontendUrl}/register/${token}`;
  res.json({ success: true, data: { token, url } } satisfies ApiResponse);
});

/**
 * GET /api/v1/registration/session/:token
 * CLI polls this to check if the user has confirmed.
 */
registrationRouter.get('/session/:token', (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found or expired' } });
    return;
  }
  res.json({ success: true, data: { status: session.status, apiKey: session.apiKey, agentName: session.agentName, agentWallet: session.agentWallet } } satisfies ApiResponse);
});

/**
 * POST /api/v1/registration/confirm/:token
 * Frontend calls this after user signs with their wallet.
 */
registrationRouter.post('/confirm/:token', async (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session || session.status !== 'pending') {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found or already used' } });
    return;
  }

  const { ownerAddress, signature } = req.body as { ownerAddress?: string; signature?: string };
  if (!ownerAddress || !signature) {
    res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'ownerAddress and signature required' } });
    return;
  }

  // Verify the owner signed the registration message
  const message = `Register agent "${session.agentName}" (${session.agentWallet}) to BlindMarket.\n\nToken: ${session.token}`;
  const recovered = ethers.verifyMessage(message, signature).toLowerCase();
  if (recovered !== ownerAddress.toLowerCase()) {
    res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature does not match address' } });
    return;
  }

  // Issue a long-lived JWT for the agent wallet, scoped to the owner
  const apiKey = jwt.sign(
    { address: session.agentWallet, ownerAddress: ownerAddress.toLowerCase(), agentName: session.agentName },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: '365d' } as jwt.SignOptions,
  );

  session.status = 'confirmed';
  session.ownerAddress = ownerAddress.toLowerCase();
  session.apiKey = apiKey;

  res.json({ success: true, data: { apiKey, agentWallet: session.agentWallet } } satisfies ApiResponse);
});

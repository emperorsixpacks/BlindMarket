import { Router } from 'express';
import type { ApiResponse } from '../types.js';
import { escrow, marketplaceSigner } from '../services/chain.js';
import { isBridgeConfigured } from '../services/a2aSettlement.js';
import { config } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const body: ApiResponse<{ status: string; timestamp: string }> = {
    success: true,
    data: { status: 'ok', timestamp: new Date().toISOString() },
  };
  res.json(body);
});

// GET /api/v1/health/bridge — surfaces the A2A settlement bridge config
// without needing backend log access. Returns whether the marketplace signer
// is set and whether it actually holds the on-chain verifier role. A `false`
// for `verifierMatches` is the root cause of every "task accepted but never
// completes" report; the response includes the exact rotate-verifier command
// to run from contracts/.
healthRouter.get('/bridge', async (_req, res, next) => {
  try {
    const configured = isBridgeConfigured();
    if (!configured || !marketplaceSigner) {
      const body: ApiResponse = {
        success: true,
        data: {
          configured: false,
          reason: 'MARKETPLACE_SIGNER_PRIVATE_KEY not set in backend env',
        },
      };
      res.json(body);
      return;
    }
    const signerAddr = await marketplaceSigner.getAddress();
    let onChainVerifier: string | null = null;
    let escrowReadError: string | null = null;
    try {
      onChainVerifier = (await escrow.verifier()) as string;
    } catch (e) {
      escrowReadError = (e as Error).message;
    }
    const verifierMatches =
      onChainVerifier !== null &&
      onChainVerifier.toLowerCase() === signerAddr.toLowerCase();
    const network = config.ogChainId === 16661 ? 'mainnet' : 'testnet';
    const body: ApiResponse = {
      success: true,
      data: {
        configured: true,
        signerAddress: signerAddr,
        escrowAddress: config.blindEscrowAddress,
        chainId: config.ogChainId,
        onChainVerifier,
        verifierMatches,
        escrowReadError,
        rotateCommand: verifierMatches
          ? null
          : `cd contracts && MARKETPLACE_SIGNER_ADDRESS=${signerAddr} npx hardhat run scripts/rotate-verifier.ts --network 0g-${network}`,
      },
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

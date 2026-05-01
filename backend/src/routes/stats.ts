import { Router } from 'express';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { provider } from '../services/chain.js';
import { loadAllAgents } from '../services/redis.js';
import * as registryService from '../services/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadAbi(name: string) {
  try {
    return JSON.parse(readFileSync(join(__dirname, `../abi/${name}.json`), 'utf-8')).abi;
  } catch { return null; }
}

export const statsRouter = Router();

/** GET /api/v1/stats — live platform counts */
statsRouter.get('/', async (_req, res) => {
  const results = await Promise.allSettled([
    // Open tasks from chain
    registryService.openTaskCount(),
    // Active agents from Redis
    loadAllAgents().then(a => a.filter(x => x.status === 'running').length),
    // Validator count from ValidatorPool if deployed
    (async () => {
      const addr = process.env.VALIDATOR_POOL_ADDRESS;
      if (!addr) return 0;
      const abi = loadAbi('ValidatorPool');
      if (!abi) return 0;
      const contract = new ethers.Contract(addr, abi, provider);
      return Number(await contract.activeValidatorCount());
    })(),
  ]);

  res.json({
    success: true,
    data: {
      openTasks:        results[0].status === 'fulfilled' ? results[0].value : 0,
      activeAgents:     results[1].status === 'fulfilled' ? results[1].value : 0,
      activeValidators: results[2].status === 'fulfilled' ? results[2].value : 0,
    },
  });
});

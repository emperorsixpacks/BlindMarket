import { Router } from 'express';
import { get0GPriceUSD } from '../services/price.js';

export const priceRouter = Router();

priceRouter.get('/', async (_req, res) => {
  try {
    const price = await get0GPriceUSD();
    res.json({ success: true, data: { price } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch price' });
  }
});

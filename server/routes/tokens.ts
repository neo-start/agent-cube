import { Router, Request, Response } from 'express';
import { getTokenSummary, loadTokenUsage } from '../token-tracker.js';

const router = Router();

router.get('/tokens/summary', (_req: Request, res: Response) => {
  res.json(getTokenSummary());
});

router.get('/tokens/recent', (_req: Request, res: Response) => {
  res.json({ records: loadTokenUsage(100) });
});

export default router;

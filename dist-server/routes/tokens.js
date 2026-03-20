import { Router } from 'express';
import { getTokenSummary, loadTokenUsage } from '../token-tracker.js';
const router = Router();
router.get('/tokens/summary', (_req, res) => {
    res.json(getTokenSummary());
});
router.get('/tokens/recent', (_req, res) => {
    res.json({ records: loadTokenUsage(100) });
});
export default router;

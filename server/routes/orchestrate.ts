import { Router, Request, Response } from 'express';
import { state } from '../state.js';
import { orchestrate } from '../orchestration.js';

const router = Router();

// POST /api/orchestrate
router.post('/orchestrate', (req: Request, res: Response) => {
  const { description, by } = req.body as { description: string; by?: string };
  if (!description) return res.status(400).json({ ok: false, error: 'Missing description' });

  state.taskCounter++;
  const orchestrationId = `orch-${state.taskCounter}-${Date.now()}`;
  state.orchestrations[orchestrationId] = {
    id: orchestrationId,
    description,
    by: by || 'User',
    status: 'routing',
    route: null,
    reason: null,
    clawTaskId: null,
    deepTaskId: null,
    clawResult: null,
    deepResult: null,
    merged: null,
    createdAt: new Date().toISOString(),
  };

  orchestrate(orchestrationId, description);
  res.json({ ok: true, orchestrationId });
});

// GET /api/orchestrate/:id
router.get('/orchestrate/:id', (req: Request, res: Response) => {
  const o = state.orchestrations[req.params['id'] as string];
  if (!o) return res.status(404).json({ ok: false });
  res.json({ ok: true, ...o });
});

export default router;

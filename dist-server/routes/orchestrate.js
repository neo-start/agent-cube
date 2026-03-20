import { Router } from 'express';
import { state } from '../state.js';
import { orchestrate } from '../orchestration.js';
const router = Router();
// POST /api/orchestrate
router.post('/orchestrate', (req, res) => {
    const { description, by } = req.body;
    if (!description)
        return res.status(400).json({ ok: false, error: 'Missing description' });
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
router.get('/orchestrate/:id', (req, res) => {
    const o = state.orchestrations[req.params['id']];
    if (!o)
        return res.status(404).json({ ok: false });
    res.json({ ok: true, ...o });
});
export default router;

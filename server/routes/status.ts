import { Router, Request, Response } from 'express';
import { state, sseClients, broadcast } from '../state.js';

const router = Router();

// POST /api/status
router.post('/status', (req: Request, res: Response) => {
  const { agent, status, task, log } = req.body as { agent: string; status: string; task?: string; log?: string };
  if (!agent || !state.agents[agent]) return res.status(400).json({ ok: false, error: 'Unknown agent' });

  state.agents[agent].status = status as import('../types.js').AgentStatus;
  if (task) state.agents[agent].title = task;
  if (log) state.agents[agent].latestLog = log;
  broadcast();

  res.json({ ok: true });
});

// GET /api/status
router.get('/status', (_req: Request, res: Response) => {
  const result: Record<string, unknown> = {};
  for (const [name, a] of Object.entries(state.agents)) {
    result[name] = { status: a.status, task: a.title, log: a.latestLog };
  }
  res.json(result);
});

// GET /api/status/stream (SSE)
router.get('/status/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  sseClients.add(res);

  const payload = JSON.stringify(
    Object.fromEntries(
      Object.entries(state.agents).map(([name, a]) => [
        name,
        { status: a.status, task: a.title, log: a.latestLog, updated: new Date().toISOString() },
      ])
    )
  );
  res.write(`data: ${payload}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

export default router;

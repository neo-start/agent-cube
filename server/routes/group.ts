/**
 * Legacy /api/group/* routes — adapter for default group.
 * All requests are forwarded to the new per-group handlers with groupId = 'default'.
 */
import { Router, Request, Response } from 'express';
import { state } from '../state.js';
import { listThreads } from '../memory.js';
import { handleGetMessages, handleGetEvents, handleStream, handleSend } from './groups.js';

const router = Router();

// Inject groupId = 'default' into req.params for handler reuse
function withDefault(handler: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    req.params = { ...req.params, groupId: 'default' };
    handler(req, res);
  };
}

// GET /api/group
router.get('/group', withDefault(handleGetMessages));

// GET /api/group/events
router.get('/group/events', withDefault(handleGetEvents));

// GET /api/group/stream
router.get('/group/stream', withDefault(handleStream));

// GET /api/group/threads — list saved threads
// Add ?stop=<threadId> or ?stopAll=1 to force-stop threads
router.get('/group/threads', (req: Request, res: Response) => {
  const stopId = req.query['stop'] as string | undefined;
  const stopAll = req.query['stopAll'] as string | undefined;
  if (stopAll) {
    const stopped: string[] = [];
    for (const [id, thread] of Object.entries(state.threads)) {
      if (thread.status === 'active') {
        thread.status = 'done';
        thread.endedAt = new Date().toISOString();
        thread.endReason = 'manual-stop';
        stopped.push(id);
      }
    }
    res.json({ stopped });
    return;
  }
  if (stopId && state.threads[stopId]) {
    const thread = state.threads[stopId];
    thread.status = 'done';
    thread.endedAt = new Date().toISOString();
    thread.endReason = 'manual-stop';
    res.json({ stopped: [stopId] });
    return;
  }
  const saved = listThreads();
  const active = Object.values(state.threads);
  res.json({ active, saved });
});

// POST /api/group/thread/:threadId/stop — force-stop a running thread
router.post('/group/thread/:threadId/stop', (req: Request, res: Response) => {
  const { threadId } = req.params;
  const thread = state.threads[threadId];
  if (!thread) {
    res.status(404).json({ error: 'Thread not found in active threads' });
    return;
  }
  thread.status = 'done';
  thread.endedAt = new Date().toISOString();
  thread.endReason = 'manual-stop';
  res.json({ ok: true, threadId, status: thread.status });
});

// POST /api/group/send
router.post('/group/send', withDefault(handleSend));

export default router;

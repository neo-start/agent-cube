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
router.get('/group/threads', (_req: Request, res: Response) => {
  const saved = listThreads();
  const active = Object.values(state.threads);
  res.json({ active, saved });
});

// POST /api/group/send
router.post('/group/send', withDefault(handleSend));

export default router;

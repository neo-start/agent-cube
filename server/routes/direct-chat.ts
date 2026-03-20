import { Router, Request, Response } from 'express';
import { loadDirectChat, saveDirectChat, clearDirectChat } from '../memory.js';

const router = Router();

// GET /api/direct-chat/:agent — load history
router.get('/direct-chat/:agent', (req: Request, res: Response) => {
  const agent = req.params['agent'] as string;
  const messages = loadDirectChat(agent);
  res.json({ ok: true, messages });
});

// POST /api/direct-chat/:agent — save history (full replace)
router.post('/direct-chat/:agent', (req: Request, res: Response) => {
  const agent = req.params['agent'] as string;
  const { messages } = req.body as { messages?: unknown[] };
  if (!Array.isArray(messages)) return res.status(400).json({ ok: false, error: 'messages must be an array' });
  saveDirectChat(agent, messages);
  res.json({ ok: true });
});

// DELETE /api/direct-chat/:agent — clear history
router.delete('/direct-chat/:agent', (req: Request, res: Response) => {
  const agent = req.params['agent'] as string;
  clearDirectChat(agent);
  res.json({ ok: true });
});

export default router;

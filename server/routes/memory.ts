import { Router, Request, Response } from 'express';
import { loadMemory, saveMemory, loadSoul, loadLongTermMemory, saveLongTermMemory, appendLongTermMemory } from '../memory.js';
import { SOULS_DIR } from '../config.js';
import fs from 'fs';
import path from 'path';

const router = Router();

// ─── Short-term memory (conversation history) ───────────────────────────────

// GET /api/memory/:agent
router.get('/memory/:agent', (req: Request, res: Response) => {
  const agent = req.params['agent'] as string;
  const mem = loadMemory(agent);
  res.json({ agent, messages: mem });
});

// DELETE /api/memory/:agent
router.delete('/memory/:agent', (req: Request, res: Response) => {
  const agent = req.params['agent'] as string;
  saveMemory(agent, []);
  res.json({ ok: true });
});

// ─── Soul (persona) ─────────────────────────────────────────────────────────

// GET /api/soul/:agent
router.get('/soul/:agent', (req: Request, res: Response) => {
  const agent = req.params['agent'] as string;
  const soul = loadSoul(agent);
  res.json({ agent, soul: soul || '' });
});

// PUT /api/soul/:agent
router.put('/soul/:agent', (req: Request, res: Response) => {
  const agent = req.params['agent'] as string;
  const { content } = req.body as { content?: string };
  if (content === undefined) return res.status(400).json({ ok: false, error: 'Missing content' });
  try {
    fs.writeFileSync(path.join(SOULS_DIR, `${agent}.md`), content, 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ─── Long-term memory ────────────────────────────────────────────────────────

// GET /api/memory/:agent/long-term
router.get('/memory/:agent/long-term', (req: Request, res: Response) => {
  const agent = req.params['agent'] as string;
  const mem = loadLongTermMemory(agent);
  res.json({ agent, memory: mem });
});

// PUT /api/memory/:agent/long-term — overwrite
router.put('/memory/:agent/long-term', (req: Request, res: Response) => {
  const agent = req.params['agent'] as string;
  const { content } = req.body as { content?: string };
  if (content === undefined) return res.status(400).json({ ok: false, error: 'Missing content' });
  saveLongTermMemory(agent, content);
  res.json({ ok: true });
});

// POST /api/memory/:agent/long-term — append
router.post('/memory/:agent/long-term', (req: Request, res: Response) => {
  const agent = req.params['agent'] as string;
  const { entry } = req.body as { entry?: string };
  if (!entry) return res.status(400).json({ ok: false, error: 'Missing entry' });
  appendLongTermMemory(agent, entry);
  res.json({ ok: true });
});

export default router;

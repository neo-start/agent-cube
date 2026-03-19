import { Router } from 'express';
import { loadMemory, saveMemory } from '../memory.js';

const router = Router();

// GET /api/memory/:agent
router.get('/memory/:agent', (req, res) => {
  const mem = loadMemory(req.params.agent);
  res.json({ agent: req.params.agent, messages: mem });
});

// DELETE /api/memory/:agent
router.delete('/memory/:agent', (req, res) => {
  saveMemory(req.params.agent, []);
  res.json({ ok: true });
});

export default router;

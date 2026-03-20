import { Router } from 'express';
import { loadMemory, saveMemory, loadSoul, loadLongTermMemory, saveLongTermMemory, appendLongTermMemory } from '../memory.js';
import { SOULS_DIR } from '../config.js';
import fs from 'fs';
import path from 'path';

const router = Router();

// ─── Short-term memory (conversation history) ───────────────────────────────

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

// ─── Soul (persona) ─────────────────────────────────────────────────────────

// GET /api/soul/:agent
router.get('/soul/:agent', (req, res) => {
  const soul = loadSoul(req.params.agent);
  res.json({ agent: req.params.agent, soul: soul || '' });
});

// PUT /api/soul/:agent
router.put('/soul/:agent', (req, res) => {
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ ok: false, error: 'Missing content' });
  try {
    fs.writeFileSync(path.join(SOULS_DIR, `${req.params.agent}.md`), content, 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Long-term memory ────────────────────────────────────────────────────────

// GET /api/memory/:agent/long-term
router.get('/memory/:agent/long-term', (req, res) => {
  const mem = loadLongTermMemory(req.params.agent);
  res.json({ agent: req.params.agent, memory: mem });
});

// PUT /api/memory/:agent/long-term — overwrite
router.put('/memory/:agent/long-term', (req, res) => {
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ ok: false, error: 'Missing content' });
  saveLongTermMemory(req.params.agent, content);
  res.json({ ok: true });
});

// POST /api/memory/:agent/long-term — append
router.post('/memory/:agent/long-term', (req, res) => {
  const { entry } = req.body;
  if (!entry) return res.status(400).json({ ok: false, error: 'Missing entry' });
  appendLongTermMemory(req.params.agent, entry);
  res.json({ ok: true });
});

export default router;

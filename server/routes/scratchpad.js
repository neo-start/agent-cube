import { Router } from 'express';
import { loadScratchpad, saveScratchpad } from '../memory.js';
import { broadcast } from '../state.js';

const router = Router();

// GET /api/scratchpad
router.get('/scratchpad', (_req, res) => {
  res.json(loadScratchpad());
});

// POST /api/scratchpad
router.post('/scratchpad', (req, res) => {
  const { key, value, agent } = req.body;
  if (!key || value === undefined) return res.status(400).json({ ok: false, error: 'Missing key or value' });
  const pad = loadScratchpad();
  const idx = pad.entries.findIndex(e => e.key === key);
  const entry = { key, value, agent: agent || 'user', ts: new Date().toISOString() };
  if (idx >= 0) pad.entries[idx] = entry;
  else pad.entries.push(entry);
  saveScratchpad(pad);
  broadcast();
  res.json({ ok: true, entry });
});

// DELETE /api/scratchpad/:key
router.delete('/scratchpad/:key', (req, res) => {
  const pad = loadScratchpad();
  pad.entries = pad.entries.filter(e => e.key !== req.params.key);
  saveScratchpad(pad);
  res.json({ ok: true });
});

export default router;

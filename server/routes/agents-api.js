import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { loadAgentRegistry } from '../registry.js';

const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const router = Router();

// ── GET /api/agents ───────────────────────────────────────────────────────────
router.get('/agents', (_req, res) => {
  const agents = loadAgentRegistry();
  res.json({ agents });
});

// ── POST /api/agents ──────────────────────────────────────────────────────────
router.post('/agents', (req, res) => {
  const { name, provider, model, apiKey } = req.body;
  if (!name || !provider || !model) {
    return res.status(400).json({ ok: false, error: 'Missing name, provider, or model' });
  }

  let data;
  try {
    data = fs.existsSync(AGENTS_FILE)
      ? JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'))
      : { agents: [] };
  } catch { data = { agents: [] }; }

  if (data.agents.find(a => a.name === name)) {
    return res.status(400).json({ ok: false, error: `Agent '${name}' already exists` });
  }

  const agent = { name, provider, model, apiKey: apiKey || null };
  data.agents.push(agent);
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));

  // Invalidate registry cache by clearing module-level cache via a re-export trick
  // (The registry uses a module-level _cache variable; a server restart is needed for
  //  the new agent to appear in the in-process registry. The file is updated immediately.)
  res.status(201).json({ ok: true, agent });
});

// ── DELETE /api/agents/:name ──────────────────────────────────────────────────
router.delete('/agents/:name', (req, res) => {
  let data;
  try {
    data = fs.existsSync(AGENTS_FILE)
      ? JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'))
      : { agents: [] };
  } catch { data = { agents: [] }; }

  if (data.agents.length <= 1) {
    return res.status(400).json({ ok: false, error: 'Cannot remove the last agent' });
  }

  const idx = data.agents.findIndex(a => a.name === req.params.name);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Agent not found' });

  data.agents.splice(idx, 1);
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));
  res.json({ ok: true });
});

export default router;

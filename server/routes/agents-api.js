import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { loadAgentRegistry, clearRegistryCache } from '../registry.js';
import { state, agentTaskQueues } from '../state.js';
import { AgentTaskQueue } from '../agent-queue.js';

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

  clearRegistryCache();
  state.agents[name] = { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null };
  agentTaskQueues[name] = new AgentTaskQueue(name, 20);

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

  const deletedName = req.params.name;
  data.agents.splice(idx, 1);
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));

  clearRegistryCache();
  delete state.agents[deletedName];
  delete agentTaskQueues[deletedName];

  res.json({ ok: true });
});

export default router;

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { loadAgentRegistry, clearRegistryCache } from '../registry.js';
import { state, agentTaskQueues } from '../state.js';
import { AgentTaskQueue } from '../agent-queue.js';

const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const router = Router();

const AGENT_PALETTE = [
  { color: '#1a6cf5', accentColor: '#4d9fff' },
  { color: '#7c3aed', accentColor: '#a78bfa' },
  { color: '#059669', accentColor: '#34d399' },
  { color: '#d97706', accentColor: '#fbbf24' },
  { color: '#dc2626', accentColor: '#f87171' },
  { color: '#0891b2', accentColor: '#22d3ee' },
];

function deriveRole(provider: string): string {
  return provider
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => {
      if (word.toLowerCase() === 'openai') return 'OpenAI';
      if (word.toLowerCase() === 'deepseek') return 'DeepSeek';
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

// ── GET /api/agents ───────────────────────────────────────────────────────────
router.get('/agents', (_req: Request, res: Response) => {
  const agents = loadAgentRegistry();
  const enriched = agents.map((agent, i) => {
    const palette = AGENT_PALETTE[i % AGENT_PALETTE.length];
    return {
      ...agent,
      color: palette.color,
      accentColor: palette.accentColor,
      role: deriveRole(agent.provider),
    };
  });
  res.json({ agents: enriched });
});

// ── POST /api/agents ──────────────────────────────────────────────────────────
router.post('/agents', (req: Request, res: Response) => {
  const { name, provider, model, apiKey } = req.body as { name: string; provider: string; model: string; apiKey?: string };
  if (!name || !provider || !model) {
    return res.status(400).json({ ok: false, error: 'Missing name, provider, or model' });
  }

  let data: { agents: Array<{ name: string; provider: string; model: string; apiKey: string | null }> };
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
  state.agents[name] = { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null, _nudgedAt: null };
  agentTaskQueues[name] = new AgentTaskQueue(name, 20);

  res.status(201).json({ ok: true, agent });
});

// ── DELETE /api/agents/:name ──────────────────────────────────────────────────
router.delete('/agents/:name', (req: Request, res: Response) => {
  let data: { agents: Array<{ name: string }> };
  try {
    data = fs.existsSync(AGENTS_FILE)
      ? JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'))
      : { agents: [] };
  } catch { data = { agents: [] }; }

  if (data.agents.length <= 1) {
    return res.status(400).json({ ok: false, error: 'Cannot remove the last agent' });
  }

  const agentName = req.params['name'] as string;
  const idx = data.agents.findIndex(a => a.name === agentName);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Agent not found' });

  data.agents.splice(idx, 1);
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));

  clearRegistryCache();
  delete state.agents[agentName];
  delete agentTaskQueues[agentName];

  res.json({ ok: true });
});

export default router;

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import type { AgentConfig } from './types.js';

const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');

const DEFAULT_CONFIG: { agents: AgentConfig[] } = {
  agents: [
    { name: 'Forge', provider: 'claude', model: 'claude-sonnet-4-6', apiKey: null },
    { name: 'Arc', provider: 'claude', model: 'claude-sonnet-4-6', apiKey: null },
  ],
};

let _cache: AgentConfig[] | null = null;

export function loadAgentRegistry(): AgentConfig[] {
  if (_cache) return _cache;
  try {
    if (!fs.existsSync(AGENTS_FILE)) {
      fs.writeFileSync(AGENTS_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
      _cache = DEFAULT_CONFIG.agents;
    } else {
      const data = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'));
      _cache = data.agents || DEFAULT_CONFIG.agents;
    }
  } catch {
    _cache = DEFAULT_CONFIG.agents;
  }
  return _cache!;
}

export function getAgentConfig(name: string): AgentConfig | null {
  const agents = loadAgentRegistry();
  return agents.find(a => a.name === name) || null;
}

export function getAllAgentNames(): string[] {
  return loadAgentRegistry().map(a => a.name);
}

export function clearRegistryCache(): void {
  _cache = null;
}

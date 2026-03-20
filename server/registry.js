import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');

const DEFAULT_CONFIG = {
  agents: [
    { name: 'Claw', provider: 'claude', model: 'claude-opus-4-5', apiKey: null },
    { name: 'Deep', provider: 'deepseek', model: 'deepseek-chat', apiKey: null },
  ],
};

let _cache = null;

export function loadAgentRegistry() {
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
  return _cache;
}

export function getAgentConfig(name) {
  const agents = loadAgentRegistry();
  return agents.find(a => a.name === name) || null;
}

export function getAllAgentNames() {
  return loadAgentRegistry().map(a => a.name);
}

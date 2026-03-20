import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const TOKEN_USAGE_FILE = path.join(DATA_DIR, 'token-usage.jsonl');

// Cost per million tokens (USD)
const COST = {
  claude:   { input: 3.0,   output: 15.0  },
  deepseek: { input: 0.14,  output: 0.28  },
};

function estimateCost(provider, inputTokens, outputTokens) {
  const rates = COST[provider] || COST.claude;
  return (inputTokens / 1e6) * rates.input + (outputTokens / 1e6) * rates.output;
}

export function recordTokenUsage({ agentName, taskId, provider, usage, model }) {
  if (!usage) return;
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      agentName,
      taskId,
      provider: provider || 'claude',
      model: model || '',
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      cacheTokens: usage.cacheTokens || 0,
    };
    fs.appendFileSync(TOKEN_USAGE_FILE, JSON.stringify(entry) + '\n');
  } catch {}
}

export function loadTokenUsage(limit = 1000) {
  try {
    if (!fs.existsSync(TOKEN_USAGE_FILE)) return [];
    const lines = fs.readFileSync(TOKEN_USAGE_FILE, 'utf-8').split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function getTokenSummary() {
  const records = loadTokenUsage(10000);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const all = {};
  const today = {};

  for (const r of records) {
    const agent = r.agentName || 'unknown';
    const provider = r.provider || 'claude';
    const isToday = r.timestamp && r.timestamp.startsWith(todayStr);

    if (!all[agent]) all[agent] = { totalInput: 0, totalOutput: 0, totalCache: 0, totalCost: 0, provider };
    all[agent].totalInput += r.inputTokens || 0;
    all[agent].totalOutput += r.outputTokens || 0;
    all[agent].totalCache += r.cacheTokens || 0;
    all[agent].totalCost += estimateCost(provider, r.inputTokens || 0, r.outputTokens || 0);

    if (isToday) {
      if (!today[agent]) today[agent] = { totalInput: 0, totalOutput: 0, totalCache: 0, totalCost: 0, provider };
      today[agent].totalInput += r.inputTokens || 0;
      today[agent].totalOutput += r.outputTokens || 0;
      today[agent].totalCache += r.cacheTokens || 0;
      today[agent].totalCost += estimateCost(provider, r.inputTokens || 0, r.outputTokens || 0);
    }
  }

  return { all, today };
}

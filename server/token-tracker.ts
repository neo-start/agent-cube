import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import type { TokenUsage, TokenRecord, AgentTokenStats } from './types.js';

const TOKEN_USAGE_FILE = path.join(DATA_DIR, 'token-usage.jsonl');

// Cost per million tokens (USD) — keyed by model prefix or provider fallback
const MODEL_COST: Record<string, { input: number; output: number }> = {
  'claude-opus':    { input: 15.0,  output: 75.0  },
  'claude-sonnet':  { input: 3.0,   output: 15.0  },
  'claude-haiku':   { input: 0.25,  output: 1.25  },
  'deepseek-chat':  { input: 0.14,  output: 0.28  },
  'deepseek-coder': { input: 0.14,  output: 0.28  },
};

const PROVIDER_COST: Record<string, { input: number; output: number }> = {
  claude:   { input: 3.0,   output: 15.0  },
  deepseek: { input: 0.14,  output: 0.28  },
};

function estimateCost(provider: string, inputTokens: number, outputTokens: number, model = ''): number {
  // Try model-specific rate first
  const modelKey = Object.keys(MODEL_COST).find(k => model.startsWith(k));
  const rates = modelKey ? MODEL_COST[modelKey] : (PROVIDER_COST[provider] || PROVIDER_COST['claude']);
  return (inputTokens / 1e6) * rates.input + (outputTokens / 1e6) * rates.output;
}

export function recordTokenUsage({ agentName, taskId, provider, usage, model }: { agentName: string; taskId: string; provider: string; usage: TokenUsage | null; model: string }): void {
  if (!usage) return;
  try {
    const entry: TokenRecord = {
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

export function loadTokenUsage(limit = 1000): TokenRecord[] {
  try {
    if (!fs.existsSync(TOKEN_USAGE_FILE)) return [];
    const lines = fs.readFileSync(TOKEN_USAGE_FILE, 'utf-8').split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => { try { return JSON.parse(l) as TokenRecord; } catch { return null; } }).filter((x): x is TokenRecord => x !== null);
  } catch { return []; }
}

export function getTokenSummary(): { all: Record<string, AgentTokenStats>; today: Record<string, AgentTokenStats> } {
  const records = loadTokenUsage(10000);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const all: Record<string, AgentTokenStats> = {};
  const today: Record<string, AgentTokenStats> = {};

  for (const r of records) {
    const agent = r.agentName || 'unknown';
    const provider = r.provider || 'claude';
    const isToday = r.timestamp && r.timestamp.startsWith(todayStr);

    if (!all[agent]) all[agent] = { totalInput: 0, totalOutput: 0, totalCache: 0, totalCost: 0, provider };
    all[agent].totalInput += r.inputTokens || 0;
    all[agent].totalOutput += r.outputTokens || 0;
    all[agent].totalCache += r.cacheTokens || 0;
    all[agent].totalCost += estimateCost(provider, r.inputTokens || 0, r.outputTokens || 0, r.model || '');

    if (isToday) {
      if (!today[agent]) today[agent] = { totalInput: 0, totalOutput: 0, totalCache: 0, totalCost: 0, provider };
      today[agent].totalInput += r.inputTokens || 0;
      today[agent].totalOutput += r.outputTokens || 0;
      today[agent].totalCache += r.cacheTokens || 0;
      today[agent].totalCost += estimateCost(provider, r.inputTokens || 0, r.outputTokens || 0, r.model || '');
    }
  }

  return { all, today };
}

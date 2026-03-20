import * as claudeProvider from './claude.js';
import * as deepseekProvider from './deepseek.js';
import type { ProviderResult } from '../types.js';

interface Provider {
  streamProvider: (agentName: string, systemPrompt: string, msgOrMessages: string | Array<{ role: string; content: string }>, onDelta?: (delta: string, accumulated: string) => void, sessionKey?: string) => Promise<ProviderResult>;
}

const providers: Record<string, Provider> = {
  claude: claudeProvider as Provider,
  deepseek: deepseekProvider as Provider,
};

export function getProvider(providerName: string): Provider {
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);
  return provider;
}

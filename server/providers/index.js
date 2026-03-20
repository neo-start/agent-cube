import * as claudeProvider from './claude.js';
import * as deepseekProvider from './deepseek.js';

const providers = {
  claude: claudeProvider,
  deepseek: deepseekProvider,
};

export function getProvider(providerName) {
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);
  return provider;
}

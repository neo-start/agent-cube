import { streamChat } from '../claude-proxy.js';
import type { ProviderResult } from '../types.js';

/**
 * Claude provider — session-based streaming.
 * @returns {Promise<ProviderResult>}
 */
export async function streamProvider(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  onDelta?: (delta: string, accumulated: string) => void,
  sessionKey?: string
): Promise<ProviderResult> {
  return streamChat({ agentName, sessionKey, system: systemPrompt, userMessage, onDelta });
}

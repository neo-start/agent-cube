import { streamChat } from '../claude-proxy.js';

/**
 * Claude provider — session-based streaming.
 * @param {string} agentName
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {Function} [onDelta] - called with (delta, accumulated)
 * @returns {Promise<string>} accumulated result
 */
/**
 * @returns {Promise<{result: string, usage: {inputTokens, outputTokens, cacheTokens}|null}>}
 */
export async function streamProvider(agentName, systemPrompt, userMessage, onDelta) {
  return streamChat({ agentName, system: systemPrompt, userMessage, onDelta });
}

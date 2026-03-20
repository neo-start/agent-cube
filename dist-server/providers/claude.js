import { streamChat } from '../claude-proxy.js';
/**
 * Claude provider — session-based streaming.
 * @returns {Promise<ProviderResult>}
 */
export async function streamProvider(agentName, systemPrompt, userMessage, onDelta) {
    return streamChat({ agentName, system: systemPrompt, userMessage, onDelta });
}

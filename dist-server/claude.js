/**
 * claude.ts — Built-in Anthropic API proxy for agent-cube
 * Completely independent of OpenClaw or any external proxy.
 * Requires ANTHROPIC_API_KEY env var.
 */
import Anthropic from '@anthropic-ai/sdk';
let _client = null;
function getClient() {
    if (!_client) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey)
            throw new Error('ANTHROPIC_API_KEY is not set');
        _client = new Anthropic({ apiKey });
    }
    return _client;
}
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-6';
const DEFAULT_MAX_TOKENS = 8192;
/**
 * Stream a chat completion from Claude.
 */
export async function streamChat({ system, messages = [], userMessage, model, maxTokens, onDelta }) {
    const client = getClient();
    const allMessages = [
        ...messages,
        { role: 'user', content: userMessage },
    ];
    const stream = await client.messages.stream({
        model: model || DEFAULT_MODEL,
        max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
        system: system || undefined,
        messages: allMessages,
    });
    let result = '';
    for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const delta = event.delta.text;
            result += delta;
            if (onDelta)
                onDelta(delta, result);
        }
    }
    return result;
}
/**
 * One-shot chat (no streaming). For quick single responses.
 */
export async function chat({ system, messages = [], userMessage, model, maxTokens }) {
    const client = getClient();
    const allMessages = [
        ...messages,
        { role: 'user', content: userMessage },
    ];
    const response = await client.messages.create({
        model: model || DEFAULT_MODEL,
        max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
        system: system || undefined,
        messages: allMessages,
    });
    return response.content.filter(b => b.type === 'text').map(b => b.type === 'text' ? b.text : '').join('');
}
export { DEFAULT_MODEL };

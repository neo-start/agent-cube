import { getAgentConfig } from '../registry.js';
import { DEEPSEEK_API_KEY } from '../config.js';
/**
 * DeepSeek provider — message-array based streaming.
 */
export async function streamProvider(agentName, systemPrompt, messages, onDelta) {
    const config = getAgentConfig(agentName);
    const apiKey = config?.apiKey || DEEPSEEK_API_KEY;
    const model = config?.model || 'deepseek-chat';
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model, messages, stream: true }),
    });
    if (!res.ok)
        throw new Error(`DeepSeek API error: ${res.status}`);
    let out = '';
    let usage = null;
    let lineBuffer = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop(); // keep last incomplete line in buffer
        for (const line of lines.filter(l => l.startsWith('data: ') && l !== 'data: [DONE]')) {
            try {
                const parsed = JSON.parse(line.slice(6));
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                    out += delta;
                    if (onDelta)
                        onDelta(delta, out);
                }
                if (parsed.usage) {
                    usage = {
                        inputTokens: parsed.usage.prompt_tokens || 0,
                        outputTokens: parsed.usage.completion_tokens || 0,
                        cacheTokens: 0,
                    };
                }
            }
            catch { }
        }
    }
    return { result: out, usage };
}

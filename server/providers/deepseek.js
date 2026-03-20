import { getAgentConfig } from '../registry.js';
import { DEEPSEEK_API_KEY } from '../config.js';

/**
 * DeepSeek provider — message-array based streaming.
 * @param {string} agentName
 * @param {string} systemPrompt  (unused, already included in messages[0])
 * @param {Array}  messages      - full [{ role, content }] array
 * @param {Function} [onDelta]   - called with (delta, accumulated)
 * @returns {Promise<string>} accumulated result
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
  if (!res.ok) throw new Error(`DeepSeek API error: ${res.status}`);

  let out = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]')) {
      try {
        const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '';
        if (delta) {
          out += delta;
          if (onDelta) onDelta(delta, out);
        }
      } catch {}
    }
  }
  return out;
}

/**
 * claude-proxy.ts — 内置 Claude CLI wrapper
 * 直接 spawn claude CLI，解析 stream-json 输出，完全独立于 OpenClaw。
 *
 * 用法:
 *   import { streamChat } from './claude-proxy.js';
 *   const result = await streamChat({ system, messages, userMessage, onDelta });
 */

import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import type { ProviderResult, TokenUsage } from './types.js';

const CLAUDE_BIN = process.env.CLAUDE_BIN || join(homedir(), '.local/bin/claude');
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || '';

// 每个 agent 维护独立的 session id
const sessions: Record<string, string | null> = {};

function getSessionFile(agentName: string): string {
  return join(homedir(), `.agent-cube-session-${agentName}`);
}

async function loadSessionId(agentName: string): Promise<string | null> {
  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(getSessionFile(agentName), 'utf8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

async function saveSessionId(agentName: string, sessionId: string): Promise<void> {
  try {
    const { writeFile } = await import('fs/promises');
    await writeFile(getSessionFile(agentName), sessionId, 'utf8');
  } catch {}
}

// Detect context window overflow errors from claude CLI
function isContextOverflow(errText: string): boolean {
  return /context.*(window|length|limit)|too (long|large)|token.*limit|prompt.*too|maximum.*token/i.test(errText);
}

/**
 * Compact the current session: ask Claude to summarize the conversation,
 * then clear the session so the next call starts fresh with the summary.
 * Returns the summary string (empty string on failure).
 */
async function compactSession(agentName: string, sessionId: string): Promise<string> {
  const COMPACT_PROMPT = [
    'Please provide a detailed summary of our conversation so far.',
    'Include: what task we were working on, what has been accomplished, key decisions made,',
    'code or files created/modified, and what still needs to be done.',
    'Be thorough — this summary will be used to resume work in a new session.',
  ].join(' ');

  const cmd = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
    '--resume', sessionId,
    COMPACT_PROMPT,
  ];
  if (CLAUDE_MODEL) cmd.push('--model', CLAUDE_MODEL);

  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_BIN, cmd, {
      env: { ...process.env, CLAUDECODE: undefined, CLAUDE_SESSION_ID: undefined },
    });
    let summary = '';
    let lastLen = 0;
    let settled = false;
    const finish = (s: string) => { if (!settled) { settled = true; resolve(s); } };

    proc.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(trimmed) as Record<string, unknown>; } catch { continue; }
        if (event['type'] === 'assistant') {
          const parts = (event['message'] as Record<string, unknown>)?.['content'] as unknown[] || [];
          let fullText = '';
          for (const p of parts) { if ((p as Record<string, unknown>)?.['type'] === 'text') fullText += (p as Record<string, unknown>)['text'] as string; }
          if (fullText.length > lastLen) { summary = fullText; lastLen = fullText.length; }
        } else if (event['type'] === 'result') {
          finish(summary || event['result'] as string || '');
        }
      }
    });

    proc.on('error', () => finish(''));
    proc.on('close', () => finish(summary));
    setTimeout(() => { proc.kill(); finish(summary); }, 60_000); // 1 min timeout
  });
}

export async function streamChat({ agentName = 'default', sessionKey, system, userMessage, onDelta, _retry = false, _compactedSummary = null }: {
  agentName?: string;
  /** Override the session file key (defaults to agentName). Use for per-thread isolation. */
  sessionKey?: string;
  system?: string;
  userMessage: string;
  onDelta?: (delta: string, accumulated: string) => void;
  _retry?: boolean;
  _compactedSummary?: string | null;
}): Promise<ProviderResult> {
  const sk = sessionKey ?? agentName;
  // 懒加载 session id
  if (!sessions[sk]) {
    sessions[sk] = await loadSessionId(sk);
  }

  const cmd = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];

  if (CLAUDE_MODEL) cmd.push('--model', CLAUDE_MODEL);

  if (sessions[sk]) {
    cmd.push('--resume', sessions[sk]!);
  } else {
    cmd.push('--continue');
  }

  if (system) cmd.push('--append-system-prompt', system);

  cmd.push(userMessage);

  return new Promise<ProviderResult>((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, cmd, {
      env: { ...process.env, CLAUDECODE: undefined, CLAUDE_SESSION_ID: undefined },
    });

    let accumulated = '';
    let lastLen = 0;
    let stderr = '';
    let settled = false;

    const finish = (err: Error | null, result: string | null, usage: TokenUsage | null) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve({ result: result!, usage: usage || null });
    };

    proc.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(trimmed) as Record<string, unknown>; } catch { continue; }

        const { type } = event as { type: string };

        if (type === 'assistant') {
          const parts = (event['message'] as Record<string, unknown>)?.['content'] as unknown[] || [];
          let fullText = '';
          for (const p of parts) {
            if ((p as Record<string, unknown>)?.['type'] === 'text') fullText += (p as Record<string, unknown>)['text'] as string;
          }
          if (fullText.length > lastLen) {
            const delta = fullText.slice(lastLen);
            lastLen = fullText.length;
            accumulated = fullText;
            if (onDelta) onDelta(delta, accumulated);
          }
        } else if (type === 'result') {
          if (event['is_error']) {
            const err = event['result'] as string || ((event['errors'] as string[] || []).join(', ')) || 'unknown error';
            if (/no conversation|session/i.test(err)) {
              // Session not found — clear and let next call start fresh
              sessions[sk] = null;
              saveSessionId(sk, '');
            } else if (isContextOverflow(err) && !_retry) {
              // Context window full — compact first, then retry with summary
              console.warn(`[claude-proxy] Context overflow for ${sk}, compacting session...`);
              const overflowSessionId = sessions[sk];
              finish(null, `__COMPACT__${overflowSessionId}`, null);
              return;
            }
            if (!accumulated) finish(new Error(`Claude error: ${err}`), null, null);
            else finish(null, accumulated, null);
          } else {
            const text = accumulated || event['result'] as string || '';
            if (event['session_id']) {
              sessions[sk] = event['session_id'] as string;
              saveSessionId(sk, event['session_id'] as string);
            }
            // Extract usage from result event
            const u = event['usage'] as Record<string, number> | undefined;
            const usage: TokenUsage | null = u ? {
              inputTokens: u['input_tokens'] || 0,
              outputTokens: u['output_tokens'] || 0,
              cacheTokens: u['cache_creation_input_tokens'] || 0,
            } : null;
            finish(null, text, usage);
          }
        }
      }
    });

    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('error', (err: Error) => {
      finish(new Error(`Failed to spawn claude: ${err.message}`), null, null);
    });

    proc.on('close', (code: number | null) => {
      if (!settled) {
        if (accumulated) finish(null, accumulated, null);
        else finish(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`), null, null);
      }
    });

    // 5 分钟超时
    setTimeout(() => {
      if (!settled) {
        proc.kill();
        finish(new Error('claude timeout (5min)'), null, null);
      }
    }, 5 * 60 * 1000);
  }).then(async out => {
    // Handle context overflow: compact first, then retry with summary
    if (out && out.result && out.result.startsWith('__COMPACT__')) {
      const overflowSessionId = out.result.slice('__COMPACT__'.length);
      console.log(`[claude-proxy] Compacting session for ${sk}...`);

      const summary = await compactSession(sk, overflowSessionId);

      // Clear the overflowed session
      sessions[sk] = null;
      await saveSessionId(sk, '');

      const compactedSystem = system
        ? `${system}\n\n## Compacted Context\nThe following is a summary of the previous conversation that was compacted due to context window limits:\n\n${summary}`
        : `## Compacted Context\nThe following is a summary of the previous conversation:\n\n${summary}`;

      console.log(`[claude-proxy] Session compacted for ${sk}, resuming task...`);
      return streamChat({ agentName, sessionKey, system: compactedSystem, userMessage, onDelta, _retry: true });
    }
    return out;
  });
}

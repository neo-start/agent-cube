/**
 * claude-proxy.js — 内置 Claude CLI wrapper
 * 直接 spawn claude CLI，解析 stream-json 输出，完全独立于 OpenClaw。
 *
 * 用法:
 *   import { streamChat } from './claude-proxy.js';
 *   const result = await streamChat({ system, messages, userMessage, onDelta });
 */

import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

const CLAUDE_BIN = process.env.CLAUDE_BIN || join(homedir(), '.local/bin/claude');
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || '';

// 每个 agent 维护独立的 session id
const sessions = {};

function getSessionFile(agentName) {
  return join(homedir(), `.agent-cube-session-${agentName}`);
}

async function loadSessionId(agentName) {
  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(getSessionFile(agentName), 'utf8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

async function saveSessionId(agentName, sessionId) {
  try {
    const { writeFile } = await import('fs/promises');
    await writeFile(getSessionFile(agentName), sessionId, 'utf8');
  } catch {}
}

/**
 * 用 claude CLI 进行流式对话。
 *
 * @param {Object} opts
 * @param {string} [opts.agentName='default']  - agent 名称，用于维护独立 session
 * @param {string} [opts.system]               - system prompt（追加到 claude 默认 prompt）
 * @param {string} opts.userMessage            - 用户消息
 * @param {Function} [opts.onDelta]            - 每次有新 token 时回调：(delta, accumulated)
 * @returns {Promise<string>}                  - 完整回复文本
 */
export async function streamChat({ agentName = 'default', system, userMessage, onDelta }) {
  // 懒加载 session id
  if (!sessions[agentName]) {
    sessions[agentName] = await loadSessionId(agentName);
  }

  const cmd = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];

  if (CLAUDE_MODEL) cmd.push('--model', CLAUDE_MODEL);

  if (sessions[agentName]) {
    cmd.push('--resume', sessions[agentName]);
  } else {
    cmd.push('--continue');
  }

  if (system) cmd.push('--append-system-prompt', system);

  cmd.push(userMessage);

  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, cmd, {
      env: { ...process.env, CLAUDECODE: undefined, CLAUDE_SESSION_ID: undefined },
    });

    let accumulated = '';
    let lastLen = 0;
    let stderr = '';
    let settled = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(result);
    };

    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event;
        try { event = JSON.parse(trimmed); } catch { continue; }

        const { type } = event;

        if (type === 'assistant') {
          const parts = event.message?.content || [];
          let fullText = '';
          for (const p of parts) {
            if (p?.type === 'text') fullText += p.text;
          }
          if (fullText.length > lastLen) {
            const delta = fullText.slice(lastLen);
            lastLen = fullText.length;
            accumulated = fullText;
            if (onDelta) onDelta(delta, accumulated);
          }
        } else if (type === 'result') {
          if (event.is_error) {
            const err = event.result || (event.errors || []).join(', ') || 'unknown error';
            // session 找不到时清除，下次重新建
            if (/no conversation|session/i.test(err)) {
              sessions[agentName] = null;
            }
            if (!accumulated) finish(new Error(`Claude error: ${err}`), null);
            else finish(null, accumulated);
          } else {
            const text = accumulated || event.result || '';
            if (event.session_id) {
              sessions[agentName] = event.session_id;
              saveSessionId(agentName, event.session_id);
            }
            finish(null, text);
          }
        }
      }
    });

    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => {
      finish(new Error(`Failed to spawn claude: ${err.message}`), null);
    });

    proc.on('close', (code) => {
      if (!settled) {
        if (accumulated) finish(null, accumulated);
        else finish(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`), null);
      }
    });

    // 5 分钟超时
    setTimeout(() => {
      if (!settled) {
        proc.kill();
        finish(new Error('claude timeout (5min)'), null);
      }
    }, 5 * 60 * 1000);
  });
}

import { state, broadcast, broadcastGroup, pushGroupMsg } from './state.js';
import { loadMemory, appendMemory, logTask, loadScratchpad } from './memory.js';

export const PERSONAS = {
  Claw: `You are Claw, a senior software engineer and coding specialist. You write clean, working code. You think step by step. You always verify your reasoning before coding. If you receive a task that is purely analytical or strategic (no coding needed), start your response with exactly [DELEGATE:Deep] on the first line, then explain what analysis you need from Deep. Otherwise, just solve the task directly.`,
  Deep: `You are Deep, a strategic analyst and thinking partner. You excel at breaking down problems, reasoning through tradeoffs, writing plans, and explaining complex ideas clearly. If you receive a task that requires actual code implementation or execution, start your response with exactly [DELEGATE:Claw] on the first line, then specify the exact coding task for Claw. Otherwise, just answer directly.`
};

export function checkDelegation(response, fromAgent, taskId, originalDesc) {
  const match = response.match(/^\[DELEGATE:(Claw|Deep)\]\n?([\s\S]*)/);
  if (!match) return false;
  const toAgent = match[1];
  const delegateDesc = match[2].trim() || originalDesc;
  if (toAgent === fromAgent) return false;

  pushGroupMsg('delegate', fromAgent, delegateDesc, { toAgent, taskId });

  const parentTask = state.tasks[taskId];
  const inheritedAttachments = parentTask?.attachments || [];

  const subTaskId = `task-${++state.taskCounter}-${Date.now()}`;
  state.tasks[subTaskId] = {
    id: subTaskId,
    agent: toAgent,
    description: delegateDesc,
    by: fromAgent,
    status: 'working',
    latestLog: null,
    result: null,
    delegatedBy: fromAgent,
    parentTaskId: taskId,
    source: 'delegate',
    attachments: inheritedAttachments,
    createdAt: new Date().toISOString(),
  };

  if (toAgent === 'Claw') runClaw(subTaskId, delegateDesc);
  else runDeep(subTaskId, delegateDesc);
  return true;
}

export async function runClaw(taskId, description) {
  const agent = state.agents.Claw;
  agent.status = 'working';
  agent.taskId = taskId;
  agent.description = description;
  agent.title = description.slice(0, 60);
  agent.latestLog = 'Thinking...';
  agent._startedAt = Date.now();
  broadcast();
  pushGroupMsg('status', 'Claw', 'Thinking...', { status: 'working', taskId });

  const streamMsg = pushGroupMsg('stream', 'Claw', '', { taskId, status: 'streaming' });

  const mem = loadMemory('Claw');
  const historyMessages = mem.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
  const pad = loadScratchpad();
  const scratchText = pad.entries.length
    ? 'SHARED CONTEXT:\n' + pad.entries.map(e => `${e.key}: ${e.value}`).join('\n') + '\n\n'
    : '';

  appendMemory('Claw', 'user', description);

  const clawPrompt = `[NEW TASK — focus only on this request, ignore previous conversation history if unrelated]\n\n${description}`;

  const CLAW_PROXY = process.env.CLAW_PROXY_URL || 'http://127.0.0.1:11436';
  const MAX_RETRIES = 1;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3 * 60 * 1000);

    const response = await fetch(`${CLAW_PROXY}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'claude-proxy',
        messages: [
          { role: 'system', content: scratchText + PERSONAS.Claw },
          ...historyMessages,
          { role: 'user', content: clawPrompt },
        ],
        stream: true,
      }),
    });

    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Claw proxy error: ${response.status}`);

    let result = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]');
      for (const line of lines) {
        try {
          const d = JSON.parse(line.slice(6));
          const delta = d.choices?.[0]?.delta?.content || '';
          result += delta;
          agent.latestLog = result.slice(-800);
          if (state.tasks[taskId]) state.tasks[taskId].latestLog = agent.latestLog;
          streamMsg.content = result;
          broadcastGroup({ ...streamMsg, partial: true });
          broadcast();
        } catch {}
      }
    }

    const isDelegated = checkDelegation(result, 'Claw', taskId, description);
    agent.status = 'done';
    if (!isDelegated) appendMemory('Claw', 'assistant', result.slice(0, 1000));
    if (state.tasks[taskId]) {
      state.tasks[taskId].status = 'done';
      state.tasks[taskId].result = result;
    }
    streamMsg.type = 'reply';
    streamMsg.content = result;
    streamMsg.status = 'done';
    broadcastGroup(streamMsg);
    logTask(taskId, { ...state.tasks[taskId], completedAt: new Date().toISOString() });
    broadcast();
    return;
  } catch (err) {
    if (attempt < MAX_RETRIES && (err.name === 'AbortError' || /terminated|ECONNR/i.test(err.message))) {
      agent.latestLog = `Retrying (attempt ${attempt + 1})...`;
      broadcast();
      continue;
    }
    agent.status = 'blocked';
    agent.latestLog = `Error: ${err.message}`;
    streamMsg.type = 'reply';
    streamMsg.content = `Error: ${err.message}`;
    streamMsg.status = 'error';
    broadcastGroup(streamMsg);
    if (state.tasks[taskId]) state.tasks[taskId].status = 'blocked';
    broadcast();
  }
  }
}

export async function runDeep(taskId, description) {
  const agent = state.agents.Deep;
  agent.status = 'working';
  agent.taskId = taskId;
  agent.description = description;
  agent.title = description.slice(0, 60);
  agent.latestLog = 'Thinking...';
  agent._startedAt = Date.now();
  broadcast();
  pushGroupMsg('status', 'Deep', 'Thinking...', { status: 'working', taskId });

  const deepStreamMsg = pushGroupMsg('stream', 'Deep', '', { taskId, status: 'streaming' });

  const mem = loadMemory('Deep');
  const historyMessages = mem.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
  appendMemory('Deep', 'user', description);

  const deepPrompt = `[NEW TASK — focus only on this request, ignore previous conversation history if unrelated]\n\n${description}`;

  const deepPad = loadScratchpad();
  const deepSystemContent = deepPad.entries.length
    ? PERSONAS.Deep + '\n\nSHARED CONTEXT:\n' + deepPad.entries.map(e => `${e.key}: ${e.value}`).join('\n')
    : PERSONAS.Deep;

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-b24861db17d640bba4ffb816c8863f34',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: deepSystemContent },
          ...historyMessages,
          { role: 'user', content: deepPrompt },
        ],
        stream: true,
      }),
    });

    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);

    let result = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]');
      for (const line of lines) {
        try {
          const d = JSON.parse(line.slice(6));
          const delta = d.choices?.[0]?.delta?.content || '';
          result += delta;
          agent.latestLog = result.slice(-800);
          if (state.tasks[taskId]) state.tasks[taskId].latestLog = agent.latestLog;
          deepStreamMsg.content = result;
          broadcastGroup({ ...deepStreamMsg, partial: true });
          broadcast();
        } catch {}
      }
    }

    const isDelegated = checkDelegation(result, 'Deep', taskId, description);
    agent.status = 'done';
    if (!isDelegated) appendMemory('Deep', 'assistant', result.slice(0, 1000));
    deepStreamMsg.type = 'reply';
    deepStreamMsg.content = result;
    deepStreamMsg.status = 'done';
    broadcastGroup(deepStreamMsg);
    if (state.tasks[taskId]) {
      state.tasks[taskId].status = 'done';
      state.tasks[taskId].result = result;
    }
    logTask(taskId, { ...state.tasks[taskId], completedAt: new Date().toISOString() });
    broadcast();
  } catch (err) {
    agent.status = 'blocked';
    agent.latestLog = `Error: ${err.message}`;
    deepStreamMsg.type = 'reply';
    deepStreamMsg.content = `Error: ${err.message}`;
    deepStreamMsg.status = 'error';
    broadcastGroup(deepStreamMsg);
    if (state.tasks[taskId]) state.tasks[taskId].status = 'blocked';
    broadcast();
  }
}

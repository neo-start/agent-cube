import { state, broadcast, broadcastGroup, pushGroupMsg } from './state.js';
import { loadMemory, appendMemory, logTask, loadScratchpad, loadSoul, loadLongTermMemory } from './memory.js';
import { streamChat } from './claude-proxy.js';

// Fallback personas if soul files don't exist
const DEFAULT_PERSONAS = {
  Claw: `You are Claw, a senior software engineer and coding specialist. You write clean, working code. You think step by step. You always verify your reasoning before coding. If you receive a task that is purely analytical or strategic (no coding needed), start your response with exactly [DELEGATE:Deep] on the first line, then explain what analysis you need from Deep. Otherwise, just solve the task directly.`,
  Deep: `You are Deep, a strategic analyst and thinking partner. You excel at breaking down problems, reasoning through tradeoffs, writing plans, and explaining complex ideas clearly. If you receive a task that requires actual code implementation or execution, start your response with exactly [DELEGATE:Claw] on the first line, then specify the exact coding task for Claw. Otherwise, just answer directly.`
};

// Load persona from soul file, fallback to default
export function getPersona(agentName) {
  return loadSoul(agentName) || DEFAULT_PERSONAS[agentName] || '';
}

// For backward compatibility
export const PERSONAS = DEFAULT_PERSONAS;

export function checkDelegation(response, fromAgent, taskId, originalDesc) {
  const match = response.match(/^\[DELEGATE:(Claw|Deep)\]\n?([\s\S]*)/);
  if (!match) return false;
  const toAgent = match[1];
  const delegateDesc = match[2].trim() || originalDesc;
  if (toAgent === fromAgent) return false;

  const parentTask = state.tasks[taskId];
  const isGroupOrigin = parentTask && (parentTask.source === 'group' || parentTask.source === 'orchestrate' || parentTask.source === 'delegate');
  if (isGroupOrigin) pushGroupMsg('delegate', fromAgent, delegateDesc, { toAgent, taskId });

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

  // Only push to group chat if task originated from group/orchestrate/delegate
  const task = state.tasks[taskId];
  const isGroupTask = task && (task.source === 'group' || task.source === 'orchestrate' || task.source === 'delegate');
  if (isGroupTask) pushGroupMsg('status', 'Claw', 'Thinking...', { status: 'working', taskId });

  const streamMsg = isGroupTask ? pushGroupMsg('stream', 'Claw', '', { taskId, status: 'streaming' }) : null;

  const mem = loadMemory('Claw');
  const historyMessages = mem.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
  const pad = loadScratchpad();
  const scratchText = pad.entries.length
    ? 'SHARED CONTEXT:\n' + pad.entries.map(e => `${e.key}: ${e.value}`).join('\n') + '\n\n'
    : '';

  // Build system prompt: soul + long-term memory + shared context
  const soul = getPersona('Claw');
  const longTermMem = loadLongTermMemory('Claw');
  let systemPrompt = soul;
  if (longTermMem) systemPrompt += '\n\n## Long-term Memory\n' + longTermMem;
  if (scratchText) systemPrompt += '\n\n' + scratchText;

  appendMemory('Claw', 'user', description);

  const clawPrompt = `[NEW TASK — focus only on this request, ignore previous conversation history if unrelated]\n\n${description}`;

  try {
    let result = '';
    await streamChat({
      agentName: 'Claw',
      system: systemPrompt,
      userMessage: clawPrompt,
      onDelta: (_delta, accumulated) => {
        result = accumulated;
        agent.latestLog = result.slice(-800);
        if (state.tasks[taskId]) state.tasks[taskId].latestLog = agent.latestLog;
        if (streamMsg) {
          streamMsg.content = result;
          broadcastGroup({ ...streamMsg, partial: true });
        }
        broadcast();
      },
    });

    const isDelegated = checkDelegation(result, 'Claw', taskId, description);
    agent.status = 'done';
    if (!isDelegated) appendMemory('Claw', 'assistant', result.slice(0, 1000));
    if (state.tasks[taskId]) {
      state.tasks[taskId].status = 'done';
      state.tasks[taskId].result = result;
    }
    if (streamMsg) {
      streamMsg.type = 'reply';
      streamMsg.content = result;
      streamMsg.status = 'done';
      broadcastGroup(streamMsg);
    }
    logTask(taskId, { ...state.tasks[taskId], completedAt: new Date().toISOString() });
    broadcast();
  } catch (err) {
    agent.status = 'blocked';
    agent.latestLog = `Error: ${err.message}`;
    if (streamMsg) {
      streamMsg.type = 'reply';
      streamMsg.content = `Error: ${err.message}`;
      streamMsg.status = 'error';
      broadcastGroup(streamMsg);
    }
    if (state.tasks[taskId]) state.tasks[taskId].status = 'blocked';
    broadcast();
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

  const task = state.tasks[taskId];
  const isGroupTask = task && (task.source === 'group' || task.source === 'orchestrate' || task.source === 'delegate');
  if (isGroupTask) pushGroupMsg('status', 'Deep', 'Thinking...', { status: 'working', taskId });

  const deepStreamMsg = isGroupTask ? pushGroupMsg('stream', 'Deep', '', { taskId, status: 'streaming' }) : null;

  const mem = loadMemory('Deep');
  const historyMessages = mem.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
  appendMemory('Deep', 'user', description);

  const deepPrompt = `[NEW TASK — focus only on this request, ignore previous conversation history if unrelated]\n\n${description}`;

  // Build system prompt: soul + long-term memory + shared context
  const deepSoul = getPersona('Deep');
  const deepLongTermMem = loadLongTermMemory('Deep');
  const deepPad = loadScratchpad();
  let deepSystemContent = deepSoul;
  if (deepLongTermMem) deepSystemContent += '\n\n## Long-term Memory\n' + deepLongTermMem;
  if (deepPad.entries.length) deepSystemContent += '\n\nSHARED CONTEXT:\n' + deepPad.entries.map(e => `${e.key}: ${e.value}`).join('\n');

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
          if (deepStreamMsg) {
            deepStreamMsg.content = result;
            broadcastGroup({ ...deepStreamMsg, partial: true });
          }
          broadcast();
        } catch {}
      }
    }

    const isDelegated = checkDelegation(result, 'Deep', taskId, description);
    agent.status = 'done';
    if (!isDelegated) appendMemory('Deep', 'assistant', result.slice(0, 1000));
    if (deepStreamMsg) {
      deepStreamMsg.type = 'reply';
      deepStreamMsg.content = result;
      deepStreamMsg.status = 'done';
      broadcastGroup(deepStreamMsg);
    }
    if (state.tasks[taskId]) {
      state.tasks[taskId].status = 'done';
      state.tasks[taskId].result = result;
    }
    logTask(taskId, { ...state.tasks[taskId], completedAt: new Date().toISOString() });
    broadcast();
  } catch (err) {
    agent.status = 'blocked';
    agent.latestLog = `Error: ${err.message}`;
    if (deepStreamMsg) {
      deepStreamMsg.type = 'reply';
      deepStreamMsg.content = `Error: ${err.message}`;
      deepStreamMsg.status = 'error';
      broadcastGroup(deepStreamMsg);
    }
    if (state.tasks[taskId]) state.tasks[taskId].status = 'blocked';
    broadcast();
  }
}

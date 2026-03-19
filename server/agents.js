import { state, broadcast, broadcastGroup, pushGroupMsg } from './state.js';
import { loadMemory, appendMemory, logTask, loadScratchpad, loadSoul, loadLongTermMemory, appendInbox, readInbox, clearInbox, saveThread } from './memory.js';
import { streamChat } from './claude-proxy.js';

// Messaging protocol injected into every group-task system prompt
const GROUP_MESSAGING_PROTOCOL = `
## Group Chat Messaging Protocol
You are in a group chat. To send a message to another agent or to the user, use this format on its own line:
[MSG:Claw] message content here
[MSG:Deep] message content here
[MSG:User] message content here

Rules:
- Use [MSG:X] when you need to actively send something to a specific recipient
- [MSG:Claw] or [MSG:Deep] will deliver the message AND trigger that agent to respond
- [MSG:User] will post the message visibly to the user in group chat
- You can include multiple [MSG:X] blocks in one response
- Do NOT use [DELEGATE:X] and [MSG:X] for the same subtask — pick one
`;

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

// Scan response for [MSG:Target] blocks, route each through group chat.
// Returns true if any MSG blocks were found and processed.
export function checkGroupMessages(response, fromAgent, taskId) {
  const pattern = /\[MSG:(Claw|Deep|User)\]([\s\S]*?)(?=\[MSG:|$)/g;
  let found = false;
  let match;

  while ((match = pattern.exec(response)) !== null) {
    const toTarget = match[1];
    const msgContent = match[2].trim();
    if (!msgContent) continue;
    found = true;

    // Post in group chat as a message from this agent to the target
    pushGroupMsg('agent-msg', fromAgent, msgContent, { toTarget, taskId });

    // If target is another agent, trigger it with a new task
    if (toTarget === 'Claw' || toTarget === 'Deep') {
      const subTaskId = `task-${++state.taskCounter}-${Date.now()}`;
      const parentTask = state.tasks[taskId];
      state.tasks[subTaskId] = {
        id: subTaskId,
        agent: toTarget,
        description: msgContent,
        by: fromAgent,
        status: 'working',
        latestLog: null,
        result: null,
        delegatedBy: fromAgent,
        parentTaskId: taskId,
        source: 'group',
        attachments: parentTask?.attachments || [],
        createdAt: new Date().toISOString(),
      };
      if (toTarget === 'Claw') runClaw(subTaskId, msgContent);
      else runDeep(subTaskId, msgContent);
    }
  }
  return found;
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

  // Build system prompt: soul + long-term memory + shared context + group messaging protocol
  const soul = getPersona('Claw');
  const longTermMem = loadLongTermMemory('Claw');
  let systemPrompt = soul;
  if (longTermMem) systemPrompt += '\n\n## Long-term Memory\n' + longTermMem;
  if (scratchText) systemPrompt += '\n\n' + scratchText;
  if (isGroupTask) systemPrompt += GROUP_MESSAGING_PROTOCOL;

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
    if (!isDelegated && isGroupTask) checkGroupMessages(result, 'Claw', taskId);
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

  // Build system prompt: soul + long-term memory + shared context + group messaging protocol
  const deepSoul = getPersona('Deep');
  const deepLongTermMem = loadLongTermMemory('Deep');
  const deepPad = loadScratchpad();
  let deepSystemContent = deepSoul;
  if (deepLongTermMem) deepSystemContent += '\n\n## Long-term Memory\n' + deepLongTermMem;
  if (deepPad.entries.length) deepSystemContent += '\n\nSHARED CONTEXT:\n' + deepPad.entries.map(e => `${e.key}: ${e.value}`).join('\n');
  if (isGroupTask) deepSystemContent += GROUP_MESSAGING_PROTOCOL;

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
    if (!isDelegated && isGroupTask) checkGroupMessages(result, 'Deep', taskId);
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

// ─── Thread-based multi-agent conversation ────────────────────────────────────

const NEXT_PROTOCOL = `
## Conversation Protocol
You are in a multi-agent group discussion. At the very end of your response, on its own line, declare who should speak next:

[NEXT:Deep]        — pass turn to Deep
[NEXT:Claw]        — pass turn to Claw
[NEXT:Claw,Deep]   — both agents respond (parallel)
[NEXT:User]        — pause and wait for user input
[DONE]             — the discussion is complete

Rules:
- Always end with exactly one of these directives
- You can invite an agent not yet in the conversation — they'll join automatically
- If you omit the directive, the system will automatically pass the turn to the other agent
- Keep responses focused; don't repeat what others already said
`;

// Parse [NEXT:X] or [DONE] from the tail of a response.
// If no directive found, default to the other participant in the thread
// rather than pausing — prevents conversation from breaking when agent forgets.
function parseNextDirective(text, thread, currentAgent) {
  const tail = text.slice(-300);
  if (/\[DONE\]/i.test(tail)) return { type: 'done' };
  const m = tail.match(/\[NEXT:([^\]]+)\]/i);
  if (m) {
    const targets = m[1].split(',').map(s => s.trim()).filter(Boolean);
    return { type: 'next', targets };
  }
  // No directive found — auto-pass to another participant if available
  if (thread && thread.participants.length >= 2) {
    const other = thread.participants.find(p => p !== currentAgent);
    if (other) return { type: 'next', targets: [other] };
  }
  return { type: 'user' }; // only pause if single-agent thread
}

// Create a new Thread
export function createThread(participants, firstMessage, fromUser = 'User') {
  const threadId = `thread-${++state.threadCounter}-${Date.now()}`;
  const thread = {
    id: threadId,
    topic: firstMessage.slice(0, 80),
    participants: [...participants],
    messages: [{ from: fromUser, content: firstMessage, timestamp: new Date().toISOString() }],
    status: 'active',
    maxTurns: 20,
    startedAt: new Date().toISOString(),
    endedAt: null,
    endReason: null,
  };
  state.threads[threadId] = thread;
  return thread;
}

// Build context prompt for an agent's turn
function buildThreadContext(thread, agentName) {
  const history = thread.messages
    .map(m => `${m.from}: ${m.content}`)
    .join('\n\n---\n\n');
  return `You are in an ongoing multi-agent discussion.\nParticipants: ${[...thread.participants, 'User'].join(', ')}\n\nConversation so far:\n${history}\n\nNow it's your turn (${agentName}).`;
}

// Run one turn for an agent inside a Thread
export async function runAgentInThread(agentName, threadId) {
  const thread = state.threads[threadId];
  if (!thread || thread.status !== 'active') return;

  // Dynamically add agent if not yet in participants
  if (!thread.participants.includes(agentName)) {
    thread.participants.push(agentName);
    pushGroupMsg('thread-join', agentName, `${agentName} joined the discussion`, { threadId });
  }

  const agent = state.agents[agentName];
  if (!agent) return;

  agent.status = 'working';
  agent.title = thread.topic;
  agent.latestLog = 'Thinking...';
  agent._startedAt = Date.now();
  broadcast();

  pushGroupMsg('status', agentName, 'Thinking...', { status: 'working', threadId });
  const streamMsg = pushGroupMsg('stream', agentName, '', { threadId, status: 'streaming' });

  // Build system prompt
  const soul = getPersona(agentName);
  const longTermMem = loadLongTermMemory(agentName);
  const pad = loadScratchpad();
  let system = soul;
  if (longTermMem) system += '\n\n## Long-term Memory\n' + longTermMem;
  if (pad.entries.length) system += '\n\nSHARED CONTEXT:\n' + pad.entries.map(e => `${e.key}: ${e.value}`).join('\n');
  system += NEXT_PROTOCOL;

  const userMsg = buildThreadContext(thread, agentName);

  try {
    let result = '';

    if (agentName === 'Claw') {
      await streamChat({
        agentName: 'Claw',
        system,
        userMessage: userMsg,
        onDelta: (_, accumulated) => {
          result = accumulated;
          agent.latestLog = result.slice(-800);
          streamMsg.content = result;
          broadcastGroup({ ...streamMsg, partial: true });
          broadcast();
        },
      });
    } else {
      // DeepSeek (Deep and any future non-Claude agent)
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-b24861db17d640bba4ffb816c8863f34' },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
          stream: true,
        }),
      });
      if (!res.ok) throw new Error(`DeepSeek API error: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]')) {
          try {
            const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '';
            result += delta;
            agent.latestLog = result.slice(-800);
            streamMsg.content = result;
            broadcastGroup({ ...streamMsg, partial: true });
            broadcast();
          } catch {}
        }
      }
    }

    // Append to thread history
    thread.messages.push({ from: agentName, content: result, timestamp: new Date().toISOString() });

    streamMsg.type = 'reply';
    streamMsg.content = result;
    streamMsg.status = 'done';
    broadcastGroup(streamMsg);

    agent.status = 'idle';
    broadcast();

    // Parse [NEXT] and dispatch
    const directive = parseNextDirective(result, thread, agentName);

    if (directive.type === 'done' || thread.messages.length >= thread.maxTurns) {
      thread.status = 'done';
      thread.endedAt = new Date().toISOString();
      thread.endReason = directive.type === 'done' ? 'agent-done' : 'max-turns';
      saveThread(thread);
      pushGroupMsg('thread-end', agentName, '', { threadId, endReason: thread.endReason });
    } else if (directive.type === 'user') {
      thread.status = 'paused';
      pushGroupMsg('thread-pause', agentName, '', { threadId });
    } else {
      // Pass turn to each named agent (stagger parallel calls slightly)
      directive.targets.forEach((nextAgent, i) => {
        const name = nextAgent.charAt(0).toUpperCase() + nextAgent.slice(1).toLowerCase();
        setTimeout(() => runAgentInThread(name, threadId), i * 200);
      });
    }
  } catch (err) {
    agent.status = 'blocked';
    agent.latestLog = `Error: ${err.message}`;
    streamMsg.type = 'reply';
    streamMsg.content = `Error: ${err.message}`;
    streamMsg.status = 'error';
    broadcastGroup(streamMsg);
    broadcast();
  }
}

// Resume a paused thread when user follows up
export function resumeThread(threadId, userMessage, nextAgent) {
  const thread = state.threads[threadId];
  if (!thread) return false;
  thread.messages.push({ from: 'User', content: userMessage, timestamp: new Date().toISOString() });
  thread.status = 'active';
  runAgentInThread(nextAgent || thread.participants[0], threadId);
  return true;
}

import { state, broadcast, pushGroupMsg, dequeueAgentTask, persistQueues, agentTaskQueues, saveTasksState } from './state.js';
import { getGroupBus } from './group-bus.js';
import { loadMemory, appendMemory, logTask, loadScratchpad, loadSoul, appendLongTermMemory, appendInbox, readInbox, clearInbox, saveThread } from './memory.js';
import { parseToolCalls, executeToolCalls, TOOL_PROTOCOL } from './tools.js';
import { WORKSPACES_DIR } from './config.js';
import { getAgentConfig, getAllAgentNames } from './registry.js';
import { getProvider } from './providers/index.js';
import { recordTokenUsage } from './token-tracker.js';
import { retrieveRelevantMemory } from './memory-rag.js';
import type { Thread } from './types.js';
import fs from 'fs';
import path from 'path';

// Get or create a per-task workspace directory
function getWorkspace(taskId: string): string {
  const ws = path.join(WORKSPACES_DIR, taskId);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

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
const DEFAULT_PERSONAS: Record<string, string> = {
  Claw: `You are Claw, a senior software engineer and coding specialist. You write clean, working code. You think step by step. You always verify your reasoning before coding. If you receive a task that is purely analytical or strategic (no coding needed), start your response with exactly [DELEGATE:Deep] on the first line, then explain what analysis you need from Deep. Otherwise, just solve the task directly.`,
  Deep: `You are Deep, a strategic analyst and thinking partner. You excel at breaking down problems, reasoning through tradeoffs, writing plans, and explaining complex ideas clearly. If you receive a task that requires actual code implementation or execution, start your response with exactly [DELEGATE:Claw] on the first line, then specify the exact coding task for Claw. Otherwise, just answer directly.`
};

// Load persona from soul file, fallback to default
export function getPersona(agentName: string): string {
  return loadSoul(agentName) || DEFAULT_PERSONAS[agentName] || '';
}

// For backward compatibility
export const PERSONAS = DEFAULT_PERSONAS;

/**
 * scheduleAgent — single entry point for running any registered agent.
 * If the agent is already working, the task is queued instead of starting immediately.
 * All internal call sites (checkDelegation, checkGroupMessages, orchestration) use this.
 */
export function scheduleAgent(agentName: string, taskId: string, description: string): void {
  const agentState = state.agents[agentName];
  if (agentState.status === 'working') {
    const enqueued = agentTaskQueues[agentName].enqueue(
      () => runAgent(agentName, taskId, description),
      { taskId, agent: agentName, description, createdAt: new Date().toISOString() }
    );
    if (enqueued) persistQueues();
    if (!enqueued) {
      if (state.tasks[taskId]) state.tasks[taskId].status = 'blocked';
      const task = state.tasks[taskId];
      const isGroupTask = task && (task.source === 'group' || task.source === 'orchestrate' || task.source === 'delegate');
      if (isGroupTask) pushGroupMsg('status', agentName, `Queue full (max 20), task dropped: ${description.slice(0, 60)}`, { taskId, groupId: task?.groupId || 'default' });
    }
    return;
  }
  runAgent(agentName, taskId, description);
}

async function runAgent(agentName: string, taskId: string, description: string): Promise<void> {
  const agent = state.agents[agentName];
  agent.status = 'working';
  agent.taskId = taskId;
  agent.description = description;
  agent.title = description.slice(0, 60);
  agent.latestLog = 'Thinking...';
  agent._startedAt = Date.now();
  broadcast();

  const task = state.tasks[taskId];
  const isGroupTask = task && (task.source === 'group' || task.source === 'orchestrate' || task.source === 'delegate');
  const groupId = task?.groupId || 'default';
  if (isGroupTask) pushGroupMsg('status', agentName, 'Thinking...', { status: 'working', taskId, groupId });

  const streamMsg = isGroupTask ? pushGroupMsg('stream', agentName, '', { taskId, status: 'streaming', groupId }) : null;

  const mem = loadMemory(agentName);
  const historyMessages = mem.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
  appendMemory(agentName, 'user', description);

  const soul = getPersona(agentName);
  const relevantMem = retrieveRelevantMemory(agentName, description);
  const pad = loadScratchpad();
  let systemPrompt = soul;
  if (relevantMem) systemPrompt += '\n\n## Relevant Memory\n' + relevantMem;
  if (pad.entries.length) systemPrompt += '\n\nSHARED CONTEXT:\n' + pad.entries.map(e => `${e.key}: ${e.value}`).join('\n');
  systemPrompt += TOOL_PROTOCOL;
  if (isGroupTask) systemPrompt += GROUP_MESSAGING_PROTOCOL;

  const taskPrompt = `[NEW TASK — focus only on this request, ignore previous conversation history if unrelated]\n\n${description}`;
  const workspace = getWorkspace(taskId);
  const MAX_TOOL_ITERS = 10;

  const agentConfig = getAgentConfig(agentName);
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);
  const provider = getProvider(agentConfig.provider);

  try {
    let result = '';
    let lastUsage = null;

    if (agentConfig.provider === 'claude') {
      // Claude CLI — session-based, tool results injected as next user message
      let currentPrompt = taskPrompt;
      for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
        const out = await provider.streamProvider(agentName, systemPrompt, currentPrompt, (_, accumulated) => {
          result = accumulated;
          agent.latestLog = result.slice(-800);
          if (state.tasks[taskId]) state.tasks[taskId].latestLog = agent.latestLog;
          if (streamMsg) {
            streamMsg.content = result;
            getGroupBus(groupId).emit({ ...streamMsg, partial: true });
          }
          broadcast();
        });
        result = out.result;
        if (out.usage) lastUsage = out.usage;
        const toolCalls = parseToolCalls(result);
        if (toolCalls.length === 0) break;
        if (streamMsg) pushGroupMsg('tool-call', agentName, `Executing ${toolCalls.length} tool(s): ${toolCalls.map(t => t.name).join(', ')}`, { taskId, groupId });
        const toolResults = await executeToolCalls(toolCalls, workspace);
        if (streamMsg) pushGroupMsg('tool-result', agentName, toolResults.slice(0, 300), { taskId, groupId });
        currentPrompt = toolResults;
      }
    } else {
      // Message-array based (DeepSeek, OpenAI, etc.)
      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: taskPrompt },
      ];
      for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
        const out = await provider.streamProvider(agentName, systemPrompt, messages, (_, accumulated) => {
          result = accumulated;
          agent.latestLog = result.slice(-800);
          if (state.tasks[taskId]) state.tasks[taskId].latestLog = agent.latestLog;
          if (streamMsg) {
            streamMsg.content = accumulated;
            getGroupBus(groupId).emit({ ...streamMsg, partial: true });
          }
          broadcast();
        });
        result = out.result;
        if (out.usage) lastUsage = out.usage;
        const toolCalls = parseToolCalls(result);
        if (toolCalls.length === 0) break;
        if (streamMsg) pushGroupMsg('tool-call', agentName, `Executing ${toolCalls.length} tool(s): ${toolCalls.map(t => t.name).join(', ')}`, { taskId, groupId });
        const toolResults = await executeToolCalls(toolCalls, workspace);
        if (streamMsg) pushGroupMsg('tool-result', agentName, toolResults.slice(0, 300), { taskId, groupId });
        messages.push({ role: 'assistant', content: result });
        messages.push({ role: 'user', content: toolResults });
      }
    }
    recordTokenUsage({ agentName, taskId, provider: agentConfig.provider, usage: lastUsage, model: agentConfig.model });

    const isDelegated = checkDelegation(result, agentName, taskId, description);
    if (!isDelegated && isGroupTask) checkGroupMessages(result, agentName, taskId);
    agent.status = 'done';
    if (!isDelegated) appendMemory(agentName, 'assistant', result.slice(0, 1000));
    if (state.tasks[taskId]) {
      state.tasks[taskId].status = 'done';
      state.tasks[taskId].result = result;
    }
    if (streamMsg) {
      streamMsg.type = 'reply';
      streamMsg.content = result;
      streamMsg['status'] = 'done';
      getGroupBus(groupId).emit(streamMsg);
    }
    logTask(taskId, { ...state.tasks[taskId], completedAt: new Date().toISOString() });
    broadcast();
  } catch (err) {
    agent.status = 'blocked';
    agent.latestLog = `Error: ${(err as Error).message}`;
    if (streamMsg) {
      streamMsg.type = 'reply';
      streamMsg.content = `Error: ${(err as Error).message}`;
      streamMsg['status'] = 'error';
      getGroupBus(groupId).emit(streamMsg);
    }
    if (state.tasks[taskId]) state.tasks[taskId].status = 'blocked';
    broadcast();
  } finally {
    saveTasksState(state.tasks);
    dequeueAgentTask(agentName);
  }
}

export function checkDelegation(response: string, fromAgent: string, taskId: string, originalDesc: string): boolean {
  const agentNames = getAllAgentNames();
  const namePattern = agentNames.join('|');
  const match = response.match(new RegExp(`^\\[DELEGATE:(${namePattern})\\]\\n?([\\s\\S]*)`));
  if (!match) return false;
  const toAgent = match[1];
  const delegateDesc = match[2].trim() || originalDesc;
  if (toAgent === fromAgent) return false;

  const parentTask = state.tasks[taskId];
  const isGroupOrigin = parentTask && (parentTask.source === 'group' || parentTask.source === 'orchestrate' || parentTask.source === 'delegate');
  const groupId = parentTask?.groupId || 'default';
  if (isGroupOrigin) pushGroupMsg('delegate', fromAgent, delegateDesc, { toAgent, taskId, groupId });

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
    groupId,
    createdAt: new Date().toISOString(),
  };

  scheduleAgent(toAgent, subTaskId, delegateDesc);
  return true;
}

// Scan response for [MSG:Target] blocks, route each through group chat.
// Returns true if any MSG blocks were found and processed.
export function checkGroupMessages(response: string, fromAgent: string, taskId: string): boolean {
  const agentNames = getAllAgentNames();
  const namePattern = agentNames.join('|');
  const pattern = new RegExp(`\\[MSG:(${namePattern}|User)\\]([\\s\\S]*?)(?=\\[MSG:|$)`, 'g');
  let found = false;
  let match;

  while ((match = pattern.exec(response)) !== null) {
    const toTarget = match[1];
    const msgContent = match[2].trim();
    if (!msgContent) continue;
    found = true;

    const parentTask = state.tasks[taskId];
    const groupId = parentTask?.groupId || 'default';
    // Post in group chat as a message from this agent to the target
    pushGroupMsg('agent-msg', fromAgent, msgContent, { toTarget, taskId, groupId });

    // If target is another agent (not User), trigger it with a new task
    if (toTarget !== 'User') {
      const subTaskId = `task-${++state.taskCounter}-${Date.now()}`;
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
        groupId,
        createdAt: new Date().toISOString(),
      };
      scheduleAgent(toTarget, subTaskId, msgContent);
    }
  }
  return found;
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

interface NextDirective {
  type: 'done' | 'next' | 'user';
  targets?: string[];
}

// Parse [NEXT:X] or [DONE] from the tail of a response.
// If no directive found, default to the other participant in the thread
// rather than pausing — prevents conversation from breaking when agent forgets.
function parseNextDirective(text: string, thread: Thread, currentAgent: string): NextDirective {
  const tail = text.slice(-300);
  if (/\[DONE\]/i.test(tail)) return { type: 'done' };
  const m = tail.match(/\[NEXT:([^\]]+)\]/i);
  if (m) {
    const targets = m[1].split(',').map((s: string) => s.trim()).filter(Boolean);
    return { type: 'next', targets };
  }
  // No directive found — auto-pass to another participant if available
  if (thread && thread.participants.length >= 2) {
    const other = thread.participants.find(p => p !== currentAgent);
    if (other) return { type: 'next', targets: [other] };
  }
  return { type: 'user' }; // only pause if single-agent thread
}

// Save thread summary to each participant's long-term memory
function saveThreadToAgentMemory(thread: Thread): void {
  const date = thread.startedAt.slice(0, 10);
  const turnCount = thread.messages.filter(m => thread.participants.includes(m.from)).length;

  for (const agentName of thread.participants) {
    // Build a compact transcript from this agent's perspective
    const lines = thread.messages.map(m => {
      const label = m.from === agentName ? `[Me]` : `[${m.from}]`;
      return `${label} ${m.content.slice(0, 300)}${m.content.length > 300 ? '...' : ''}`;
    });

    const summary = [
      `Topic: ${thread.topic}`,
      `Participants: ${[...thread.participants, 'User'].join(', ')}`,
      `Turns: ${turnCount} | Ended: ${thread.endReason}`,
      ``,
      ...lines,
    ].join('\n');

    appendLongTermMemory(agentName, `Thread Discussion (${date})\n${summary}`);
  }
}

// Create a new Thread
export function createThread(participants: string[], firstMessage: string, fromUser = 'User', groupId = 'default'): Thread {
  const threadId = `thread-${++state.threadCounter}-${Date.now()}`;
  const thread: Thread = {
    id: threadId,
    groupId,
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
function buildThreadContext(thread: Thread, agentName: string): string {
  const history = thread.messages
    .map(m => `${m.from}: ${m.content}`)
    .join('\n\n---\n\n');
  return `You are in an ongoing multi-agent discussion.\nParticipants: ${[...thread.participants, 'User'].join(', ')}\n\nConversation so far:\n${history}\n\nNow it's your turn (${agentName}).`;
}

// Run one turn for an agent inside a Thread
export async function runAgentInThread(agentName: string, threadId: string): Promise<void> {
  const thread = state.threads[threadId];
  if (!thread || thread.status !== 'active') return;

  const threadGroupId = thread.groupId || 'default';

  // Dynamically add agent if not yet in participants
  if (!thread.participants.includes(agentName)) {
    thread.participants.push(agentName);
    pushGroupMsg('thread-join', agentName, `${agentName} joined the discussion`, { threadId, groupId: threadGroupId });
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
  const relevantMem = retrieveRelevantMemory(agentName, thread.topic);
  const pad = loadScratchpad();
  let system = soul;
  if (relevantMem) system += '\n\n## Relevant Memory\n' + relevantMem;
  if (pad.entries.length) system += '\n\nSHARED CONTEXT:\n' + pad.entries.map(e => `${e.key}: ${e.value}`).join('\n');
  system += TOOL_PROTOCOL;
  system += NEXT_PROTOCOL;

  const userMsg = buildThreadContext(thread, agentName);
  const workspace = getWorkspace(threadId);

  const agentConfig = getAgentConfig(agentName);
  if (!agentConfig) {
    agent.status = 'blocked';
    agent.latestLog = `Unknown agent: ${agentName}`;
    broadcast();
    return;
  }
  const provider = getProvider(agentConfig.provider);

  try {
    let result = '';
    let lastUsage = null;
    const MAX_TOOL_ITERS = 10;

    if (agentConfig.provider === 'claude') {
      let currentPrompt = userMsg;
      for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
        const out = await provider.streamProvider(agentName, system, currentPrompt, (_, accumulated) => {
          result = accumulated;
          agent.latestLog = result.slice(-800);
          streamMsg.content = result;
          getGroupBus(threadGroupId).emit({ ...streamMsg, partial: true });
          broadcast();
        });
        result = out.result;
        if (out.usage) lastUsage = out.usage;
        const toolCalls = parseToolCalls(result);
        if (toolCalls.length === 0) break;
        pushGroupMsg('tool-call', agentName, `Executing: ${toolCalls.map(t => t.name).join(', ')}`, { threadId });
        const toolResults = await executeToolCalls(toolCalls, workspace);
        pushGroupMsg('tool-result', agentName, toolResults.slice(0, 300), { threadId });
        currentPrompt = toolResults;
      }
    } else {
      // Message-array based (DeepSeek, OpenAI, etc.)
      const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: system }, { role: 'user', content: userMsg }];
      for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
        const out = await provider.streamProvider(agentName, system, messages, (_, accumulated) => {
          result = accumulated;
          agent.latestLog = result.slice(-800);
          streamMsg.content = accumulated;
          getGroupBus(threadGroupId).emit({ ...streamMsg, partial: true });
          broadcast();
        });
        result = out.result;
        if (out.usage) lastUsage = out.usage;
        const toolCalls = parseToolCalls(result);
        if (toolCalls.length === 0) break;
        pushGroupMsg('tool-call', agentName, `Executing: ${toolCalls.map(t => t.name).join(', ')}`, { threadId });
        const toolResults = await executeToolCalls(toolCalls, workspace);
        pushGroupMsg('tool-result', agentName, toolResults.slice(0, 300), { threadId });
        messages.push({ role: 'assistant', content: result });
        messages.push({ role: 'user', content: toolResults });
      }
    }
    recordTokenUsage({ agentName, taskId: threadId, provider: agentConfig.provider, usage: lastUsage, model: agentConfig.model });

    // Append to thread history
    thread.messages.push({ from: agentName, content: result, timestamp: new Date().toISOString() });

    streamMsg.type = 'reply';
    streamMsg.content = result;
    streamMsg['status'] = 'done';
    getGroupBus(threadGroupId).emit(streamMsg);

    agent.status = 'idle';
    broadcast();

    // Parse [NEXT] and dispatch
    const directive = parseNextDirective(result, thread, agentName);

    if (directive.type === 'done' || thread.messages.length >= thread.maxTurns) {
      thread.status = 'done';
      thread.endedAt = new Date().toISOString();
      thread.endReason = directive.type === 'done' ? 'agent-done' : 'max-turns';
      saveThread(thread);
      saveThreadToAgentMemory(thread);
      pushGroupMsg('thread-end', agentName, '', { threadId, endReason: thread.endReason });
    } else if (directive.type === 'user') {
      thread.status = 'paused';
      pushGroupMsg('thread-pause', agentName, '', { threadId });
    } else {
      // Pass turn to each named agent (stagger parallel calls slightly)
      directive.targets!.forEach((nextAgent, i) => {
        const name = nextAgent.charAt(0).toUpperCase() + nextAgent.slice(1).toLowerCase();
        setTimeout(() => runAgentInThread(name, threadId), i * 200);
      });
    }
  } catch (err) {
    agent.status = 'blocked';
    agent.latestLog = `Error: ${(err as Error).message}`;
    streamMsg.type = 'reply';
    streamMsg.content = `Error: ${(err as Error).message}`;
    streamMsg['status'] = 'error';
    getGroupBus(threadGroupId).emit(streamMsg);
    broadcast();
  }
}

// Resume a paused thread when user follows up
export function resumeThread(threadId: string, userMessage: string, nextAgent?: string): boolean {
  const thread = state.threads[threadId];
  if (!thread) return false;
  thread.messages.push({ from: 'User', content: userMessage, timestamp: new Date().toISOString() });
  thread.status = 'active';
  runAgentInThread(nextAgent || thread.participants[0], threadId);
  return true;
}

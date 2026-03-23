import { Router, Request, Response } from 'express';
import { state, pushGroupMsg } from '../state.js';
import { getGroupBus, removeGroupBus } from '../group-bus.js';
import { loadGroupRegistry, getGroup, createGroup, updateGroup, deleteGroup } from '../group-registry.js';
import { scheduleAgent, createThread, runAgentInThread, resumeThread } from '../agents.js';
import { orchestrate, askClarificationIfNeeded, consumePendingClarification } from '../orchestration.js';
import { getAllAgentNames, loadAgentRegistry } from '../registry.js';
import { buildAttachmentPrompt, hasPdfAttachment } from '../pdf-utils.js';

const router = Router();

// ── GET /api/groups ───────────────────────────────────────────────────────────
router.get('/groups', (_req: Request, res: Response) => {
  const groups = loadGroupRegistry();
  res.json({ groups });
});

// ── POST /api/groups ──────────────────────────────────────────────────────────
router.post('/groups', (req: Request, res: Response) => {
  const { name, agents, description } = req.body as { name: string; agents?: string[]; description?: string };
  if (!name) return res.status(400).json({ ok: false, error: 'Missing name' });
  const group = createGroup({ name, agents: agents || [], description: description || '' });
  // Initialize in-memory messages for the new group
  state.groupMessages[group.id] = [];
  res.status(201).json({ ok: true, group });
});

// ── GET /api/groups/:groupId ──────────────────────────────────────────────────
router.get('/groups/:groupId', (req: Request, res: Response) => {
  const groupId = req.params['groupId'] as string;
  const group = getGroup(groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });
  res.json({ ok: true, group });
});

// ── DELETE /api/groups/:groupId ───────────────────────────────────────────────
router.delete('/groups/:groupId', (req: Request, res: Response) => {
  const groupId = req.params['groupId'] as string;
  if (groupId === 'default') {
    return res.status(400).json({ ok: false, error: 'Cannot delete default group' });
  }
  try {
    const deleted = deleteGroup(groupId);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Group not found' });
    delete state.groupMessages[groupId];
    removeGroupBus(groupId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// ── PATCH /api/groups/:groupId/agents ─────────────────────────────────────────
router.patch('/groups/:groupId/agents', (req: Request, res: Response) => {
  const groupId = req.params['groupId'] as string;
  const group = getGroup(groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });

  const { add = [], remove = [] } = req.body as { add?: string[]; remove?: string[] };
  let agents = [...group.agents];
  for (const a of add) {
    if (!agents.includes(a)) agents.push(a);
  }
  agents = agents.filter(a => !remove.includes(a));
  const updated = updateGroup(groupId, { agents });
  res.json({ ok: true, group: updated });
});

// ── GET /api/groups/:groupId/messages ─────────────────────────────────────────
export function handleGetMessages(req: Request, res: Response): void {
  const groupId = (req.params['groupId'] as string) || 'default';
  const msgs = state.groupMessages[groupId] || [];
  const since = req.query['since'] ? parseInt(req.query['since'] as string) : 0;
  // Filter out messages that are only meaningful during a live session:
  // - 'stream' type: replaced by 'reply' when done; if server restarted mid-run they'd
  //   show as "typing..." forever
  // - 'status' with status='working': "Thinking..." indicators that were never resolved
  const filtered = msgs.filter(m => !(m.type === 'stream') && !(m.type === 'status' && (m as { status?: string }).status === 'working'));
  const result = since ? filtered.filter((_, i) => i >= since) : filtered;
  res.json({ messages: result, total: filtered.length });
}

router.get('/groups/:groupId/messages', (req: Request, res: Response) => {
  const groupId = req.params['groupId'] as string;
  const group = getGroup(groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });
  handleGetMessages(req, res);
});

// ── GET /api/groups/:groupId/events — per-group EventBus history ──────────────
export function handleGetEvents(req: Request, res: Response): void {
  const groupId = (req.params['groupId'] as string) || 'default';
  const bus = getGroupBus(groupId);
  const since = req.query['since'] ? parseInt(req.query['since'] as string) : 0;
  const type = req.query['type'] as string || null;
  let events = bus.getHistory(since);
  if (type) events = events.filter(e => e.type === type);
  res.json({ events, total: bus.history.length });
}

router.get('/groups/:groupId/events', (req: Request, res: Response) => {
  const groupId = req.params['groupId'] as string;
  const group = getGroup(groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });
  handleGetEvents(req, res);
});

// ── GET /api/groups/:groupId/stream — SSE per-group ───────────────────────────
export function handleStream(req: Request, res: Response): void {
  const groupId = (req.params['groupId'] as string) || 'default';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  (req.socket as import('net').Socket).setNoDelay(true);

  const bus = getGroupBus(groupId);
  const unsubscribe = bus.on('*', (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    (res as any).flush?.();
  });

  req.on('close', unsubscribe);
}

router.get('/groups/:groupId/stream', (req: Request, res: Response) => {
  const groupId = req.params['groupId'] as string;
  const group = getGroup(groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });
  handleStream(req, res);
});

// ── POST /api/groups/:groupId/send ────────────────────────────────────────────
export function handleSend(req: Request, res: Response): void {
  const groupId = (req.params['groupId'] as string) || 'default';
  const { text, target, attachments, threadId, projectId, maxTurns } = req.body as {
    text: string;
    target?: string;
    attachments?: Array<{ name: string; type: string; url: string }>;
    threadId?: string;
    projectId?: string;
    maxTurns?: number;
  };
  if (!text) { res.status(400).json({ ok: false, error: 'Missing text' }); return; }

  const agentNames = getAllAgentNames();
  const agentNamesPattern = agentNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const mentionRegex = new RegExp(`@(${agentNamesPattern})\\b`, 'gi');

  let prompt = text.replace(mentionRegex, '').trim();
  const attachmentSuffix = buildAttachmentPrompt(attachments || []);
  if (attachmentSuffix) prompt += attachmentSuffix;

  // Resume a paused thread
  if (threadId && state.threads[threadId]) {
    pushGroupMsg('user', 'User', text, { threadId, attachments: attachments || [], groupId });
    const resumed = resumeThread(threadId, prompt);
    res.json({ ok: true, threadId, resumed }); return;
  }

  pushGroupMsg('user', 'User', text, { target: target || null, attachments: attachments || [], groupId });

  // Case-insensitive match: return the canonical agent name from registry
  const mentions = [...text.matchAll(mentionRegex)].map(m => {
    const raw = m[1];
    return agentNames.find(n => n.toLowerCase() === raw.toLowerCase()) || raw;
  });
  const uniqueMentions = [...new Set(mentions)];

  // ── Multi-agent: start a Thread ──────────────────────────────────────────
  if (!target && uniqueMentions.length >= 2) {
    const thread = createThread(uniqueMentions, prompt, 'User', groupId, projectId, maxTurns);
    pushGroupMsg('thread-start', 'System', `Discussion started: ${thread.topic}`, { threadId: thread.id, participants: thread.participants, groupId });
    runAgentInThread(uniqueMentions[0], thread.id);
    res.json({ ok: true, threadId: thread.id }); return;
  }

  // ── Single agent explicitly @mentioned ───────────────────────────────────
  const agent = target || (uniqueMentions.length === 1 ? uniqueMentions[0] : null);

  if (agent && agentNames.includes(agent)) {
    const taskId = `task-${++state.taskCounter}-${Date.now()}`;
    const agentState = state.agents[agent];
    const isQueued = agentState.status === 'working';
    state.tasks[taskId] = {
      id: taskId, agent, description: prompt, by: 'User',
      status: isQueued ? 'queued' : 'working', latestLog: null, result: null,
      delegatedBy: null, parentTaskId: null, source: 'group',
      createdAt: new Date().toISOString(), attachments: attachments || [],
      groupId,
    };

    if (isQueued) {
      const currentLog = agentState.latestLog?.slice(0, 80) || '...';
      pushGroupMsg('status', agent,
        `收到，排队中。当前正在执行：${currentLog}`,
        { status: 'queued', taskId, groupId }
      );
    }

    scheduleAgent(agent, taskId, prompt);
    res.json({ ok: true, taskId }); return;
  }

  // ── PDF attachment with no @mention → force route to first Claude agent (Forge) ─
  if (hasPdfAttachment(attachments || [])) {
    const allAgents = loadAgentRegistry();
    const forgeAgent = allAgents.find(a => a.provider === 'claude');
    if (forgeAgent && agentNames.includes(forgeAgent.name)) {
      const taskId = `task-${++state.taskCounter}-${Date.now()}`;
      state.tasks[taskId] = {
        id: taskId, agent: forgeAgent.name, description: prompt, by: 'User',
        status: 'working', latestLog: null, result: null,
        delegatedBy: null, parentTaskId: null, source: 'group',
        createdAt: new Date().toISOString(), attachments: attachments || [],
        groupId,
      };
      pushGroupMsg('status', forgeAgent.name, 'Reading PDF...', { status: 'working', taskId, groupId });
      scheduleAgent(forgeAgent.name, taskId, prompt);
      res.json({ ok: true, taskId }); return;
    }
  }

  // ── No @ → find last replying agent and let it decide who responds ────────
  const groupMsgs = state.groupMessages[groupId] || [];
  const lastAgentMsg = [...groupMsgs].reverse().find(
    m => m.type === 'reply' && m.from !== 'User' && m.from !== 'System' && m.from !== 'Orchestrator' && agentNames.includes(m.from)
  );

  if (lastAgentMsg) {
    const taskId = `task-${++state.taskCounter}-${Date.now()}`;
    state.tasks[taskId] = {
      id: taskId, agent: lastAgentMsg.from, description: prompt, by: 'User',
      status: 'working', latestLog: null, result: null,
      delegatedBy: null, parentTaskId: null, source: 'group',
      createdAt: new Date().toISOString(), attachments: attachments || [],
      groupId,
    };
    scheduleAgent(lastAgentMsg.from, taskId, prompt);
    res.json({ ok: true, taskId }); return;
  }

  // ── No prior agent reply → fall back to Orchestrator ─────────────────────
  const enrichedPrompt = consumePendingClarification(groupId, prompt);
  const finalPrompt = enrichedPrompt ?? prompt;

  // Only increment taskCounter after confirming we'll actually create a task
  // (clarification branch returns early without creating one)
  if (!enrichedPrompt && askClarificationIfNeeded(`orch-${state.taskCounter + 1}-${Date.now()}`, finalPrompt, groupId)) {
    res.json({ ok: true, clarificationRequested: true }); return;
  }

  const taskId = `task-${++state.taskCounter}-${Date.now()}`;
  const orchestrationId = `orch-${state.taskCounter}-${Date.now()}`;

  state.tasks[taskId] = {
    id: taskId, agent: 'Orchestrator', description: finalPrompt, by: 'User',
    status: 'working', latestLog: null, result: null,
    delegatedBy: null, parentTaskId: null, source: 'group',
    createdAt: new Date().toISOString(), attachments: attachments || [],
    groupId,
  };
  state.orchestrations[orchestrationId] = {
    id: orchestrationId, description: finalPrompt, by: 'User', status: 'routing',
    route: null, reason: null, clawTaskId: null, deepTaskId: null,
    clawResult: null, deepResult: null, merged: null,
    createdAt: new Date().toISOString(),
  };
  pushGroupMsg('status', 'Orchestrator', 'Routing task...', { status: 'working', groupId });
  orchestrate(orchestrationId, finalPrompt, groupId);
  res.json({ ok: true, taskId });
}

router.post('/groups/:groupId/send', (req: Request, res: Response) => {
  const groupId = req.params['groupId'] as string;
  const group = getGroup(groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });
  handleSend(req, res);
});

export default router;

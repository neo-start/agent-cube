import { Router } from 'express';
import { state, pushGroupMsg } from '../state.js';
import { getGroupBus, removeGroupBus } from '../group-bus.js';
import { loadGroupRegistry, getGroup, createGroup, updateGroup, deleteGroup, getGroupAgents } from '../group-registry.js';
import { loadGroupMessagesForGroup } from '../memory.js';
import { scheduleAgent, createThread, runAgentInThread, resumeThread } from '../agents.js';
import { orchestrate } from '../orchestration.js';
import { getAllAgentNames } from '../registry.js';

const router = Router();

// ── GET /api/groups ───────────────────────────────────────────────────────────
router.get('/groups', (_req, res) => {
  const groups = loadGroupRegistry();
  res.json({ groups });
});

// ── POST /api/groups ──────────────────────────────────────────────────────────
router.post('/groups', (req, res) => {
  const { name, agents, description } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'Missing name' });
  const group = createGroup({ name, agents: agents || [], description: description || '' });
  // Initialize in-memory messages for the new group
  state.groupMessages[group.id] = [];
  res.status(201).json({ ok: true, group });
});

// ── GET /api/groups/:groupId ──────────────────────────────────────────────────
router.get('/groups/:groupId', (req, res) => {
  const group = getGroup(req.params.groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });
  res.json({ ok: true, group });
});

// ── DELETE /api/groups/:groupId ───────────────────────────────────────────────
router.delete('/groups/:groupId', (req, res) => {
  if (req.params.groupId === 'default') {
    return res.status(400).json({ ok: false, error: 'Cannot delete default group' });
  }
  try {
    const deleted = deleteGroup(req.params.groupId);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Group not found' });
    delete state.groupMessages[req.params.groupId];
    removeGroupBus(req.params.groupId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── PATCH /api/groups/:groupId/agents ─────────────────────────────────────────
router.patch('/groups/:groupId/agents', (req, res) => {
  const group = getGroup(req.params.groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });

  const { add = [], remove = [] } = req.body;
  let agents = [...group.agents];
  for (const a of add) {
    if (!agents.includes(a)) agents.push(a);
  }
  agents = agents.filter(a => !remove.includes(a));
  const updated = updateGroup(req.params.groupId, { agents });
  res.json({ ok: true, group: updated });
});

// ── GET /api/groups/:groupId/messages ─────────────────────────────────────────
export function handleGetMessages(req, res) {
  const groupId = req.params.groupId || 'default';
  const msgs = state.groupMessages[groupId] || [];
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const result = since ? msgs.filter((_, i) => i >= since) : msgs;
  res.json({ messages: result, total: msgs.length });
}

router.get('/groups/:groupId/messages', (req, res) => {
  const group = getGroup(req.params.groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });
  handleGetMessages(req, res);
});

// ── GET /api/groups/:groupId/events — per-group EventBus history ──────────────
export function handleGetEvents(req, res) {
  const groupId = req.params.groupId || 'default';
  const bus = getGroupBus(groupId);
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const type = req.query.type || null;
  let events = bus.getHistory(since);
  if (type) events = events.filter(e => e.type === type);
  res.json({ events, total: bus.history.length });
}

router.get('/groups/:groupId/events', (req, res) => {
  const group = getGroup(req.params.groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });
  handleGetEvents(req, res);
});

// ── GET /api/groups/:groupId/stream — SSE per-group ───────────────────────────
export function handleStream(req, res) {
  const groupId = req.params.groupId || 'default';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const bus = getGroupBus(groupId);
  const unsubscribe = bus.on('*', (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', unsubscribe);
}

router.get('/groups/:groupId/stream', (req, res) => {
  const group = getGroup(req.params.groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });
  handleStream(req, res);
});

// ── POST /api/groups/:groupId/send ────────────────────────────────────────────
export function handleSend(req, res) {
  const groupId = req.params.groupId || 'default';
  const { text, target, attachments, threadId } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'Missing text' });

  const agentNames = getAllAgentNames();
  const agentNamesPattern = agentNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const mentionRegex = new RegExp(`@(${agentNamesPattern})\\b`, 'gi');

  let prompt = text.replace(mentionRegex, '').trim();
  if (attachments && attachments.length > 0) {
    prompt += '\n\nATTACHMENTS:\n' + attachments.map(a => `- ${a.name} [${a.type}]: ${a.url}`).join('\n');
  }

  // Resume a paused thread
  if (threadId && state.threads[threadId]) {
    pushGroupMsg('user', 'User', text, { threadId, attachments: attachments || [], groupId });
    const resumed = resumeThread(threadId, prompt);
    return res.json({ ok: true, threadId, resumed });
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
    const thread = createThread(uniqueMentions, prompt, 'User', groupId);
    pushGroupMsg('thread-start', 'System', `Discussion started: ${thread.topic}`, { threadId: thread.id, participants: thread.participants, groupId });
    runAgentInThread(uniqueMentions[0], thread.id);
    return res.json({ ok: true, threadId: thread.id });
  }

  // ── Single agent explicitly @mentioned ───────────────────────────────────
  const agent = target || (uniqueMentions.length === 1 ? uniqueMentions[0] : null);

  if (agentNames.includes(agent)) {
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
    return res.json({ ok: true, taskId });
  }

  // ── No @ → Orchestrator routes ────────────────────────────────────────────
  const taskId = `task-${++state.taskCounter}-${Date.now()}`;
  state.tasks[taskId] = {
    id: taskId, agent: 'Orchestrator', description: prompt, by: 'User',
    status: 'working', latestLog: null, result: null,
    delegatedBy: null, parentTaskId: null, source: 'group',
    createdAt: new Date().toISOString(), attachments: attachments || [],
    groupId,
  };
  const orchestrationId = `orch-${state.taskCounter}-${Date.now()}`;
  state.orchestrations[orchestrationId] = {
    id: orchestrationId, description: prompt, by: 'User', status: 'routing',
    route: null, reason: null, clawTaskId: null, deepTaskId: null,
    clawResult: null, deepResult: null, merged: null,
    createdAt: new Date().toISOString(),
  };
  pushGroupMsg('status', 'Orchestrator', 'Routing task...', { status: 'working', groupId });
  orchestrate(orchestrationId, prompt, groupId);
  res.json({ ok: true, taskId });
}

router.post('/groups/:groupId/send', (req, res) => {
  const group = getGroup(req.params.groupId);
  if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });
  handleSend(req, res);
});

export default router;

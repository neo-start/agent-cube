import { Router } from 'express';
import { state, pushGroupMsg } from '../state.js';
import { eventBus } from '../event-bus.js';
import { scheduleAgent, createThread, runAgentInThread, resumeThread } from '../agents.js';
import { orchestrate } from '../orchestration.js';
import { listThreads } from '../memory.js';

const router = Router();

// GET /api/group
router.get('/group', (req, res) => {
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const msgs = since ? state.groupMessages.filter((_, i) => i >= since) : state.groupMessages;
  res.json({ messages: msgs, total: state.groupMessages.length });
});

// GET /api/group/events — EventBus history (for debugging / audit)
router.get('/group/events', (req, res) => {
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const type = req.query.type || null;
  let events = eventBus.getHistory(since);
  if (type) events = events.filter(e => e.type === type);
  res.json({ events, total: eventBus.history.length });
});

// GET /api/group/stream
router.get('/group/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Each SSE connection subscribes to all events from EventBus
  const unsubscribe = eventBus.on('*', (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', unsubscribe);
});

// GET /api/group/threads — list saved threads
router.get('/group/threads', (req, res) => {
  const saved = listThreads();
  const active = Object.values(state.threads);
  res.json({ active, saved });
});

// POST /api/group/send
router.post('/group/send', (req, res) => {
  const { text, target, attachments, threadId } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'Missing text' });

  let prompt = text.replace(/@(Claw|Deep)\b/gi, '').trim();
  if (attachments && attachments.length > 0) {
    prompt += '\n\nATTACHMENTS:\n' + attachments.map(a => `- ${a.name} [${a.type}]: ${a.url}`).join('\n');
  }

  // Resume a paused thread
  if (threadId && state.threads[threadId]) {
    pushGroupMsg('user', 'User', text, { threadId, attachments: attachments || [] });
    const resumed = resumeThread(threadId, prompt);
    return res.json({ ok: true, threadId, resumed });
  }

  pushGroupMsg('user', 'User', text, { target: target || null, attachments: attachments || [] });

  const mentions = [...text.matchAll(/@(Claw|Deep)\b/gi)].map(m =>
    m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
  );
  const uniqueMentions = [...new Set(mentions)];

  // ── Multi-agent: start a Thread ──────────────────────────────────────────
  if (!target && uniqueMentions.length >= 2) {
    const thread = createThread(uniqueMentions, prompt);
    pushGroupMsg('thread-start', 'System', `Discussion started: ${thread.topic}`, { threadId: thread.id, participants: thread.participants });
    // First agent kicks off
    runAgentInThread(uniqueMentions[0], thread.id);
    return res.json({ ok: true, threadId: thread.id });
  }

  // ── Single agent explicitly @mentioned ───────────────────────────────────
  const agent = target || (uniqueMentions.length === 1 ? uniqueMentions[0] : null);

  if (agent === 'Claw' || agent === 'Deep') {
    const taskId = `task-${++state.taskCounter}-${Date.now()}`;
    const agentState = state.agents[agent];
    const isQueued = agentState.status === 'working';
    state.tasks[taskId] = {
      id: taskId, agent, description: prompt, by: 'User',
      status: isQueued ? 'queued' : 'working', latestLog: null, result: null,
      delegatedBy: null, parentTaskId: null, source: 'group',
      createdAt: new Date().toISOString(), attachments: attachments || [],
    };

    if (isQueued) {
      const currentLog = agentState.latestLog?.slice(0, 80) || '...';
      pushGroupMsg('status', agent,
        `收到，排队中。当前正在执行：${currentLog}`,
        { status: 'queued', taskId }
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
  };
  const orchestrationId = `orch-${state.taskCounter}-${Date.now()}`;
  state.orchestrations[orchestrationId] = {
    id: orchestrationId, description: prompt, by: 'User', status: 'routing',
    route: null, reason: null, clawTaskId: null, deepTaskId: null,
    clawResult: null, deepResult: null, merged: null,
    createdAt: new Date().toISOString(),
  };
  pushGroupMsg('status', 'Orchestrator', 'Routing task...', { status: 'working' });
  orchestrate(orchestrationId, prompt);
  res.json({ ok: true, taskId });
});

export default router;

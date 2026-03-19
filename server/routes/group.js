import { Router } from 'express';
import { state, groupSseClients, pushGroupMsg } from '../state.js';
import { runClaw, runDeep } from '../agents.js';
import { orchestrate } from '../orchestration.js';

const router = Router();

// GET /api/group
router.get('/group', (req, res) => {
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const msgs = since ? state.groupMessages.filter((_, i) => i >= since) : state.groupMessages;
  res.json({ messages: msgs, total: state.groupMessages.length });
});

// GET /api/group/stream
router.get('/group/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  groupSseClients.add(res);
  req.on('close', () => groupSseClients.delete(res));
});

// POST /api/group/send
router.post('/group/send', (req, res) => {
  const { text, target, attachments } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'Missing text' });

  pushGroupMsg('user', 'User', text, { target: target || null, attachments: attachments || [] });

  const mentions = [...text.matchAll(/@(Claw|Deep)\b/gi)].map(m => m[1]);
  const uniqueMentions = [...new Set(mentions.map(m => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()))];
  const agent = target || (uniqueMentions.length === 1 ? uniqueMentions[0] : null);
  const routeBoth = !target && uniqueMentions.length >= 2;

  const taskId = `task-${++state.taskCounter}-${Date.now()}`;
  let prompt = text.replace(/@(Claw|Deep)\b/gi, '').trim();

  if (attachments && attachments.length > 0) {
    const attachLines = attachments.map(a => `- ${a.name} [${a.type}]: ${a.url}`).join('\n');
    prompt += `\n\nATTACHMENTS:\n${attachLines}`;
  }

  state.tasks[taskId] = {
    id: taskId,
    agent: agent || 'Orchestrator',
    description: prompt,
    by: 'User',
    status: 'working',
    latestLog: null,
    result: null,
    delegatedBy: null,
    parentTaskId: null,
    source: 'group',
    createdAt: new Date().toISOString(),
    attachments: attachments || [],
  };

  if (routeBoth) {
    const clawTaskId = `task-${++state.taskCounter}-${Date.now()}`;
    const deepTaskId = `task-${++state.taskCounter}-${Date.now()}`;
    state.tasks[clawTaskId] = { id: clawTaskId, agent: 'Claw', description: prompt, by: 'User', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'group', createdAt: new Date().toISOString(), attachments: attachments || [] };
    state.tasks[deepTaskId] = { id: deepTaskId, agent: 'Deep', description: prompt, by: 'User', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'group', createdAt: new Date().toISOString(), attachments: attachments || [] };
    runClaw(clawTaskId, prompt);
    runDeep(deepTaskId, prompt);
  } else if (agent === 'Claw') {
    runClaw(taskId, prompt);
  } else if (agent === 'Deep') {
    runDeep(taskId, prompt);
  } else {
    const orchestrationId = `orch-${state.taskCounter}-${Date.now()}`;
    state.orchestrations[orchestrationId] = {
      id: orchestrationId, description: prompt, by: 'User', status: 'routing',
      route: null, reason: null, clawTaskId: null, deepTaskId: null,
      clawResult: null, deepResult: null, merged: null,
      createdAt: new Date().toISOString(),
    };
    pushGroupMsg('status', 'Orchestrator', 'Routing task...', { status: 'working' });
    orchestrate(orchestrationId, prompt);
  }

  res.json({ ok: true, taskId });
});

export default router;

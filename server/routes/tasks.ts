import { Router, Request, Response } from 'express';
import { state, broadcast, agentTaskQueues, persistQueues } from '../state.js';
import { scheduleAgent } from '../agents.js';

const router = Router();

// GET /api/tasks
router.get('/tasks', (_req: Request, res: Response) => {
  const agents: Record<string, unknown> = {};
  for (const [name, a] of Object.entries(state.agents)) {
    const task = a.taskId ? state.tasks[a.taskId] : null;
    agents[name] = {
      status: a.status,
      taskId: a.taskId,
      description: a.description,
      latestLog: a.latestLog,
      title: a.title,
      by: task?.by || null,
      raw: task?.result || null,
      delegatedBy: task?.delegatedBy || null,
      parentTaskId: task?.parentTaskId || null,
      source: task?.source || null,
      attachments: task?.attachments || [],
    };
  }
  res.json({ agents });
});

// GET /api/activity
router.get('/activity', (_req: Request, res: Response) => {
  const tasks = Object.values(state.tasks)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(t => ({
      id: t.id,
      agent: t.agent,
      by: t.by,
      description: t.description,
      status: t.status,
      result: t.result ? t.result.slice(0, 300) : null,
      latestLog: t.latestLog ? t.latestLog.slice(0, 200) : null,
      delegatedBy: t.delegatedBy || null,
      parentTaskId: t.parentTaskId || null,
      source: t.source,
      createdAt: t.createdAt,
      completedAt: t.completedAt || null,
    }));
  res.json({ tasks });
});

// POST /api/tasks/assign
router.post('/tasks/assign', (req: Request, res: Response) => {
  const { agent, description, by, attachments } = req.body as { agent: string; description: string; by?: string; attachments?: Array<{ name: string; type: string; url: string }> };
  if (!agent || !description) return res.status(400).json({ ok: false, error: 'Missing agent or description' });
  if (!state.agents[agent]) return res.status(400).json({ ok: false, error: `Unknown agent: ${agent}` });

  state.taskCounter++;
  const taskId = `task-${state.taskCounter}-${Date.now()}`;

  let prompt = description;
  if (attachments && attachments.length > 0) {
    const attachLines = attachments.map(a => `- ${a.name} [${a.type}]: ${a.url}`).join('\n');
    prompt += `\n\nATTACHMENTS:\n${attachLines}`;
    if (attachments.some(a => a.type === 'image')) {
      prompt += '\n\nThese files have been uploaded and are accessible at the given paths on the filesystem.';
    }
  }

  state.tasks[taskId] = {
    id: taskId,
    agent,
    description,
    by: by || 'User',
    status: 'working',
    latestLog: null,
    result: null,
    delegatedBy: null,
    parentTaskId: null,
    source: 'assign',
    createdAt: new Date().toISOString(),
    attachments: attachments || [],
  };

  scheduleAgent(agent, taskId, prompt);

  res.json({ ok: true, taskId, action: 'assigned' });
});

// POST /api/tasks/delegate
router.post('/tasks/delegate', (req: Request, res: Response) => {
  const { fromAgent, toAgent, description, parentTaskId } = req.body as { fromAgent: string; toAgent: string; description: string; parentTaskId?: string };
  if (!fromAgent || !toAgent || !description) {
    return res.status(400).json({ ok: false, error: 'Missing fields' });
  }

  state.taskCounter++;
  const taskId = `task-${state.taskCounter}-${Date.now()}`;

  state.tasks[taskId] = {
    id: taskId,
    agent: toAgent,
    description,
    by: fromAgent,
    status: 'working',
    latestLog: null,
    result: null,
    delegatedBy: fromAgent,
    parentTaskId: parentTaskId || null,
    source: 'delegate',
    createdAt: new Date().toISOString(),
  };

  scheduleAgent(toAgent, taskId, description);

  res.json({ ok: true, taskId, action: 'delegated' });
});

// POST /api/tasks/intake
router.post('/tasks/intake', (req: Request, res: Response) => {
  const { agentName, description, source } = req.body as { agentName: string; description: string; source?: string };
  if (!agentName || !description) return res.status(400).json({ ok: false, error: 'Missing fields' });

  const agent = state.agents[agentName];
  if (!agent) return res.status(400).json({ ok: false, error: `Unknown agent: ${agentName}` });

  state.taskCounter++;
  const taskId = `task-${state.taskCounter}-${Date.now()}`;
  state.tasks[taskId] = {
    id: taskId, agent: agentName, description, by: source || 'external',
    status: 'working', latestLog: null, result: null,
    delegatedBy: null, parentTaskId: null, source: source || 'intake',
    createdAt: new Date().toISOString(),
  };

  agent.status = 'working';
  agent.taskId = taskId;
  agent.description = description;
  agent.title = description.slice(0, 60);
  broadcast();

  res.json({ ok: true, taskId, status: 'working', source });
});

// POST /api/tasks/:id/complete
router.post('/tasks/:id/complete', (req: Request, res: Response) => {
  const { id } = req.params as Record<string, string>;
  const { agentName, result } = req.body as { agentName: string; result?: string };

  const task = state.tasks[id];
  if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

  task.status = 'done';
  task.result = result || null;

  const agent = state.agents[agentName];
  if (agent && agent.taskId === id) {
    agent.status = 'done';
    agent.latestLog = result ? result.slice(-500) : 'Completed';
    broadcast();
  }

  res.json({ ok: true });
});

// GET /api/tasks/:id
router.get('/tasks/:id', (req: Request, res: Response) => {
  const task = state.tasks[req.params['id'] as string];
  if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });
  res.json({ ok: true, ...task });
});

// DELETE /api/tasks/:id — cancel a task
router.delete('/tasks/:id', (req: Request, res: Response) => {
  const task = state.tasks[req.params['id'] as string];
  if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

  if (task.status === 'queued') {
    const queue = agentTaskQueues[task.agent];
    if (queue) {
      queue.remove(task.id);
      persistQueues();
    }
    task.status = 'cancelled';
    return res.json({ ok: true, status: 'cancelled' });
  }

  if (task.status === 'working') {
    task.status = 'cancellation-requested';
    return res.json({ ok: true, status: 'cancellation-requested' });
  }

  return res.status(400).json({ ok: false, error: `Cannot cancel task with status '${task.status}'` });
});

export default router;

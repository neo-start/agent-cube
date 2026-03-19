import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// ─── Directories ──────────────────────────────────────────────────────────────

const DATA_DIR = path.join(os.homedir(), '.agent-cube');
const MEMORY_DIR = path.join(DATA_DIR, 'memory');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
[DATA_DIR, MEMORY_DIR, LOGS_DIR, UPLOADS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024, files: 10 } });

// ─── Agent personas ───────────────────────────────────────────────────────────

const PERSONAS = {
  Claw: `You are Claw, a senior software engineer and coding specialist. You write clean, working code. You think step by step. You always verify your reasoning before coding. If you receive a task that is purely analytical or strategic (no coding needed), start your response with exactly [DELEGATE:Deep] on the first line, then explain what analysis you need from Deep. Otherwise, just solve the task directly.`,
  Deep: `You are Deep, a strategic analyst and thinking partner. You excel at breaking down problems, reasoning through tradeoffs, writing plans, and explaining complex ideas clearly. If you receive a task that requires actual code implementation or execution, start your response with exactly [DELEGATE:Claw] on the first line, then specify the exact coding task for Claw. Otherwise, just answer directly.`
};

// ─── Memory helpers ───────────────────────────────────────────────────────────

function loadMemory(agentName) {
  try {
    const f = path.join(MEMORY_DIR, `${agentName}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : [];
  } catch { return []; }
}

function saveMemory(agentName, messages) {
  const trimmed = messages.slice(-30);
  fs.writeFileSync(path.join(MEMORY_DIR, `${agentName}.json`), JSON.stringify(trimmed, null, 2));
}

function appendMemory(agentName, role, content) {
  const mem = loadMemory(agentName);
  mem.push({ role, content, ts: new Date().toISOString() });
  saveMemory(agentName, mem);
}

// ─── Task log helpers ─────────────────────────────────────────────────────────

function logTask(taskId, data) {
  try {
    fs.writeFileSync(path.join(LOGS_DIR, `task-${taskId}.json`), JSON.stringify(data, null, 2));
  } catch {}
}

// ─── Scratchpad helpers ───────────────────────────────────────────────────────

const SCRATCHPAD_FILE = path.join(DATA_DIR, 'scratchpad.json');

function loadScratchpad() {
  try {
    return fs.existsSync(SCRATCHPAD_FILE)
      ? JSON.parse(fs.readFileSync(SCRATCHPAD_FILE, 'utf-8'))
      : { entries: [] };
  } catch { return { entries: [] }; }
}

function saveScratchpad(data) {
  try {
    fs.writeFileSync(SCRATCHPAD_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

// ─── In-memory state ──────────────────────────────────────────────────────────

const state = {
  agents: {
    Claw: { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null },
    Deep: { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null },
    Orchestrator: { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null },
  },
  tasks: {},
  messages: [],
  groupMessages: [],
  taskCounter: 0,
  orchestrations: {},
};

// ─── Group chat helpers ─────────────────────────────────────────────────────

let groupMsgCounter = 0;

function pushGroupMsg(type, from, content, meta = {}) {
  const msg = {
    id: `gm-${++groupMsgCounter}-${Date.now()}`,
    type,       // 'user' | 'reply' | 'delegate' | 'status' | 'stream'
    from,       // 'User' | 'Claw' | 'Deep' | 'Orchestrator'
    content,
    timestamp: new Date().toISOString(),
    ...meta,    // taskId, toAgent, status, etc.
  };
  state.groupMessages.push(msg);
  if (state.groupMessages.length > 500) state.groupMessages.shift();
  broadcastGroup(msg);
  return msg;
}

// SSE for group chat
const groupSseClients = new Set();

function broadcastGroup(msg) {
  const payload = JSON.stringify(msg);
  for (const res of groupSseClients) {
    res.write(`data: ${payload}\n\n`);
  }
}

// ─── SSE clients ──────────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcast() {
  const payload = JSON.stringify(
    Object.fromEntries(
      Object.entries(state.agents).map(([name, a]) => [
        name,
        { status: a.status, task: a.title, log: a.latestLog, updated: new Date().toISOString() },
      ])
    )
  );
  for (const res of sseClients) {
    res.write(`data: ${payload}\n\n`);
  }
}

// ─── Delegation detection ─────────────────────────────────────────────────────

function checkDelegation(response, fromAgent, taskId, originalDesc) {
  const match = response.match(/^\[DELEGATE:(Claw|Deep)\]\n?([\s\S]*)/);
  if (!match) return false;
  const toAgent = match[1];
  const delegateDesc = match[2].trim() || originalDesc;
  if (toAgent === fromAgent) return false;

  // Emit delegation event to group chat
  pushGroupMsg('delegate', fromAgent, delegateDesc, { toAgent, taskId });

  // Carry over attachments from parent task
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

// ─── Agent executors ──────────────────────────────────────────────────────────

async function runClaw(taskId, description) {
  const agent = state.agents.Claw;
  agent.status = 'working';
  agent.taskId = taskId;
  agent.description = description;
  agent.title = description.slice(0, 60);
  agent.latestLog = 'Thinking...';
  agent._startedAt = Date.now();
  broadcast();
  pushGroupMsg('status', 'Claw', 'Thinking...', { status: 'working', taskId });

  // Track the stream message for live updates
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

  // Build prompt with clear instruction to focus on THIS task, not history
  const clawPrompt = `[NEW TASK — focus only on this request, ignore previous conversation history if unrelated]\n\n${description}`;

  // Claw has its own dedicated proxy on port 11436 to avoid session contention
  const CLAW_PROXY = process.env.CLAW_PROXY_URL || 'http://127.0.0.1:11436';
  const MAX_RETRIES = 1;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3 * 60 * 1000); // 3 min timeout

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
          // Update stream message for group chat
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
    // Finalize stream message → reply and broadcast the final state
    streamMsg.type = 'reply';
    streamMsg.content = result;
    streamMsg.status = 'done';
    broadcastGroup(streamMsg);
    logTask(taskId, { ...state.tasks[taskId], completedAt: new Date().toISOString() });
    broadcast();
    return; // success, exit retry loop
  } catch (err) {
    if (attempt < MAX_RETRIES && (err.name === 'AbortError' || /terminated|ECONNR/i.test(err.message))) {
      agent.latestLog = `Retrying (attempt ${attempt + 1})...`;
      broadcast();
      continue; // retry
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
  } // end retry loop
}

async function runDeep(taskId, description) {
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

// ─── Orchestration helpers ────────────────────────────────────────────────────

function watchSingleTask(orchestrationId, taskId, resultKey) {
  const iv = setInterval(() => {
    const task = state.tasks[taskId];
    if (!task) return;
    if (task.status === 'done' || task.status === 'blocked') {
      clearInterval(iv);
      state.orchestrations[orchestrationId][resultKey] = task.result;
      state.orchestrations[orchestrationId].merged = task.result;
      state.orchestrations[orchestrationId].status = task.status === 'done' ? 'done' : 'blocked';
      state.agents.Orchestrator.status = state.orchestrations[orchestrationId].status;
      state.agents.Orchestrator.latestLog = (task.result || 'Done').slice(-500);
      broadcast();
    }
  }, 1500);
}

async function watchBothTasks(orchestrationId, clawTaskId, deepTaskId, description) {
  const iv = setInterval(async () => {
    const clawTask = state.tasks[clawTaskId];
    const deepTask = state.tasks[deepTaskId];
    if (!clawTask || !deepTask) return;

    const clawDone = clawTask.status === 'done' || clawTask.status === 'blocked';
    const deepDone = deepTask.status === 'done' || deepTask.status === 'blocked';

    if (clawDone) state.orchestrations[orchestrationId].clawResult = clawTask.result;
    if (deepDone) state.orchestrations[orchestrationId].deepResult = deepTask.result;

    if (clawDone && deepDone) {
      clearInterval(iv);
      state.orchestrations[orchestrationId].status = 'merging';
      state.agents.Orchestrator.latestLog = 'Merging results...';
      broadcast();

      try {
        const mergeRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sk-b24861db17d640bba4ffb816c8863f34',
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: PERSONAS.Deep },
              { role: 'user', content: `Merge these two responses into one cohesive answer:\nANALYSIS (from Deep): ${state.orchestrations[orchestrationId].deepResult || '(none)'}\nIMPLEMENTATION (from Claw): ${state.orchestrations[orchestrationId].clawResult || '(none)'}\nOriginal request: ${description}\nProvide a clean integrated response.` },
            ],
            stream: false,
          }),
        });
        const mergeData = await mergeRes.json();
        const merged = mergeData.choices?.[0]?.message?.content || 'Merge failed';
        state.orchestrations[orchestrationId].merged = merged;
        state.orchestrations[orchestrationId].status = 'done';
        state.agents.Orchestrator.status = 'done';
        state.agents.Orchestrator.latestLog = merged.slice(-500);
      } catch (err) {
        state.orchestrations[orchestrationId].merged = `Merge error: ${err.message}`;
        state.orchestrations[orchestrationId].status = 'blocked';
        state.agents.Orchestrator.status = 'blocked';
        state.agents.Orchestrator.latestLog = `Merge error: ${err.message}`;
      }
      broadcast();
    }
  }, 1500);
}

async function orchestrate(orchestrationId, description) {
  const orchAgent = state.agents.Orchestrator;
  orchAgent.status = 'working';
  orchAgent.description = description;
  orchAgent.title = description.slice(0, 60);
  orchAgent.latestLog = 'Analyzing task...';
  orchAgent._startedAt = Date.now();
  broadcast();

  // Simple keyword-based fallback routing (no API call needed for obvious cases)
  const lowerDesc = description.toLowerCase();
  const codeKeywords = /\b(code|implement|build|fix|bug|write|create|refactor|deploy|script|function|api|endpoint|component|css|html|server|database|sql)\b/;
  const thinkKeywords = /\b(analyze|explain|plan|review|compare|evaluate|research|strategy|design|think|why|how|what|summarize|assess)\b/;
  const hasCode = codeKeywords.test(lowerDesc);
  const hasThink = thinkKeywords.test(lowerDesc);

  let routing;
  if (hasCode && !hasThink) {
    routing = { route: 'Claw', reason: 'Code-related task detected' };
  } else if (hasThink && !hasCode) {
    routing = { route: 'Deep', reason: 'Analysis/thinking task detected' };
  } else {
    // Ambiguous or mixed — use DeepSeek to decide
    routing = { route: 'both', reason: 'Default: engage both agents' };
    try {
      const routeRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-b24861db17d640bba4ffb816c8863f34',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: 'You are a task router. Analyze the task and respond with ONLY valid JSON, nothing else. No markdown, no explanation.' },
            { role: 'user', content: `Route this task: "${description}"\nJSON format: {"route": "Claw"|"Deep"|"both", "reason": "one line", "clawTask": "subtask for coder", "deepTask": "subtask for analyst"}\nClaw = coding/implementation. Deep = analysis/thinking. both = needs both.` },
          ],
          stream: false,
        }),
      });
      const routeData = await routeRes.json();
      const content = routeData.choices?.[0]?.message?.content || '{}';
      const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed.route) routing = parsed;
    } catch {}
  }

  state.orchestrations[orchestrationId].route = routing.route;
  state.orchestrations[orchestrationId].reason = routing.reason;
  orchAgent.latestLog = `Route: ${routing.route} — ${routing.reason || ''}`;
  broadcast();

  if (routing.route === 'Claw') {
    state.taskCounter++;
    const taskId = `task-${state.taskCounter}-${Date.now()}`;
    state.tasks[taskId] = { id: taskId, agent: 'Claw', description, by: 'Orchestrator', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'orchestrate', createdAt: new Date().toISOString() };
    state.orchestrations[orchestrationId].clawTaskId = taskId;
    runClaw(taskId, description);
    watchSingleTask(orchestrationId, taskId, 'clawResult');
  } else if (routing.route === 'Deep') {
    state.taskCounter++;
    const taskId = `task-${state.taskCounter}-${Date.now()}`;
    state.tasks[taskId] = { id: taskId, agent: 'Deep', description, by: 'Orchestrator', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'orchestrate', createdAt: new Date().toISOString() };
    state.orchestrations[orchestrationId].deepTaskId = taskId;
    runDeep(taskId, description);
    watchSingleTask(orchestrationId, taskId, 'deepResult');
  } else {
    // both
    const clawDesc = routing.clawTask || description;
    const deepDesc = routing.deepTask || description;

    state.taskCounter++;
    const clawTaskId = `task-${state.taskCounter}-${Date.now()}`;
    state.tasks[clawTaskId] = { id: clawTaskId, agent: 'Claw', description: clawDesc, by: 'Orchestrator', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'orchestrate', createdAt: new Date().toISOString() };

    state.taskCounter++;
    const deepTaskId = `task-${state.taskCounter}-${Date.now()}`;
    state.tasks[deepTaskId] = { id: deepTaskId, agent: 'Deep', description: deepDesc, by: 'Orchestrator', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'orchestrate', createdAt: new Date().toISOString() };

    state.orchestrations[orchestrationId].clawTaskId = clawTaskId;
    state.orchestrations[orchestrationId].deepTaskId = deepTaskId;

    runClaw(clawTaskId, clawDesc);
    runDeep(deepTaskId, deepDesc);
    watchBothTasks(orchestrationId, clawTaskId, deepTaskId, description);
  }
}

// ─── Watchdog (reset stuck agents after 8 minutes) ────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [, a] of Object.entries(state.agents)) {
    if (a.status === 'working' && a._startedAt && (now - a._startedAt) > 8 * 60 * 1000) {
      a.status = 'blocked';
      a.latestLog = '⏱ Timed out (8 min)';
      broadcast();
    }
  }
}, 30_000);

// ─── Group chat routes ──────────────────────────────────────────────────────

// GET /api/group — fetch all group messages
app.get('/api/group', (req, res) => {
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const msgs = since ? state.groupMessages.filter((_, i) => i >= since) : state.groupMessages;
  res.json({ messages: msgs, total: state.groupMessages.length });
});

// GET /api/group/stream — SSE for live group messages
app.get('/api/group/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  groupSseClients.add(res);
  req.on('close', () => groupSseClients.delete(res));
});

// POST /api/group/send — user sends a message to group
app.post('/api/group/send', (req, res) => {
  const { text, target, attachments } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'Missing text' });

  // Push user message to group
  pushGroupMsg('user', 'User', text, { target: target || null, attachments: attachments || [] });

  // Parse @mentions to route — support multiple mentions
  const mentions = [...text.matchAll(/@(Claw|Deep)\b/gi)].map(m => m[1]);
  const uniqueMentions = [...new Set(mentions.map(m => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()))];
  const agent = target || (uniqueMentions.length === 1 ? uniqueMentions[0] : null);
  const routeBoth = !target && uniqueMentions.length >= 2;

  // Create task
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
    // User @mentioned both agents — skip orchestrator, run both directly
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
    // No specific agent → auto-route via orchestrator
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

// ─── API routes ───────────────────────────────────────────────────────────────

// GET /api/tasks
app.get('/api/tasks', (_req, res) => {
  const agents = {};
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

// GET /api/activity — all tasks sorted by time, for activity feed
app.get('/api/activity', (_req, res) => {
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

// GET /api/tasks/:id — poll a specific task by ID
app.get('/api/tasks/:id', (req, res) => {
  const task = state.tasks[req.params.id];
  if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });
  res.json({ ok: true, ...task });
});

// POST /api/tasks/assign
app.post('/api/tasks/assign', (req, res) => {
  const { agent, description, by, attachments } = req.body;
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

  if (agent === 'Claw') runClaw(taskId, prompt);
  else if (agent === 'Deep') runDeep(taskId, prompt);

  res.json({ ok: true, taskId, action: 'assigned' });
});

// POST /api/tasks/delegate
app.post('/api/tasks/delegate', (req, res) => {
  const { fromAgent, toAgent, description, parentTaskId } = req.body;
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

  if (toAgent === 'Claw') runClaw(taskId, description);
  else if (toAgent === 'Deep') runDeep(taskId, description);

  res.json({ ok: true, taskId, action: 'delegated' });
});

// POST /api/tasks/intake
app.post('/api/tasks/intake', (req, res) => {
  const { agentName, description, source } = req.body;
  if (!agentName || !description) return res.status(400).json({ ok: false, error: 'Missing fields' });

  const agent = state.agents[agentName];
  if (!agent) return res.status(400).json({ ok: false, error: `Unknown agent: ${agentName}` });

  agent.status = 'working';
  agent.description = description;
  agent.title = description.slice(0, 60);
  broadcast();

  res.json({ ok: true, status: 'working', source });
});

// POST /api/tasks/:id/complete
app.post('/api/tasks/:id/complete', (req, res) => {
  const { id } = req.params;
  const { agentName, result } = req.body;

  const task = state.tasks[id];
  if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

  task.status = 'done';
  task.result = result;

  const agent = state.agents[agentName];
  if (agent && agent.taskId === id) {
    agent.status = 'done';
    agent.latestLog = result ? result.slice(-500) : 'Completed';
    broadcast();
  }

  res.json({ ok: true });
});

// POST /api/status
app.post('/api/status', (req, res) => {
  const { agent, status, task, log } = req.body;
  if (!agent || !state.agents[agent]) return res.status(400).json({ ok: false, error: 'Unknown agent' });

  state.agents[agent].status = status;
  if (task) state.agents[agent].title = task;
  if (log) state.agents[agent].latestLog = log;
  broadcast();

  res.json({ ok: true });
});

// GET /api/status
app.get('/api/status', (_req, res) => {
  const result = {};
  for (const [name, a] of Object.entries(state.agents)) {
    result[name] = { status: a.status, task: a.title, log: a.latestLog };
  }
  res.json(result);
});

// GET /api/status/stream  (SSE)
app.get('/api/status/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  sseClients.add(res);

  const payload = JSON.stringify(
    Object.fromEntries(
      Object.entries(state.agents).map(([name, a]) => [
        name,
        { status: a.status, task: a.title, log: a.latestLog, updated: new Date().toISOString() },
      ])
    )
  );
  res.write(`data: ${payload}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// GET /api/messages
app.get('/api/messages', (req, res) => {
  let msgs = state.messages;
  if (req.query.from) msgs = msgs.filter(m => m.from === req.query.from);
  if (req.query.to) msgs = msgs.filter(m => m.to === req.query.to);
  res.json({ messages: msgs });
});

// POST /api/messages
app.post('/api/messages', (req, res) => {
  const { from, to, text } = req.body;
  if (!from || !to || !text) return res.status(400).json({ ok: false, error: 'Missing fields' });

  const msg = {
    id: randomUUID(),
    from,
    to,
    text,
    timestamp: new Date().toISOString(),
    read: false,
  };
  state.messages.push(msg);
  if (state.messages.length > 200) state.messages.shift();

  res.json({ ok: true, message: msg });
});

// GET /api/memory/:agent
app.get('/api/memory/:agent', (req, res) => {
  const mem = loadMemory(req.params.agent);
  res.json({ agent: req.params.agent, messages: mem });
});

// DELETE /api/memory/:agent
app.delete('/api/memory/:agent', (req, res) => {
  saveMemory(req.params.agent, []);
  res.json({ ok: true });
});

// ─── Orchestrate routes ───────────────────────────────────────────────────────

app.post('/api/orchestrate', (req, res) => {
  const { description, by } = req.body;
  if (!description) return res.status(400).json({ ok: false, error: 'Missing description' });

  state.taskCounter++;
  const orchestrationId = `orch-${state.taskCounter}-${Date.now()}`;
  state.orchestrations[orchestrationId] = {
    id: orchestrationId,
    description,
    by: by || 'User',
    status: 'routing',
    route: null,
    reason: null,
    clawTaskId: null,
    deepTaskId: null,
    clawResult: null,
    deepResult: null,
    merged: null,
    createdAt: new Date().toISOString(),
  };

  orchestrate(orchestrationId, description);
  res.json({ ok: true, orchestrationId });
});

app.get('/api/orchestrate/:id', (req, res) => {
  const o = state.orchestrations[req.params.id];
  if (!o) return res.status(404).json({ ok: false });
  res.json({ ok: true, ...o });
});

// ─── Scratchpad routes ────────────────────────────────────────────────────────

app.get('/api/scratchpad', (_req, res) => {
  res.json(loadScratchpad());
});

app.post('/api/scratchpad', (req, res) => {
  const { key, value, agent } = req.body;
  if (!key || value === undefined) return res.status(400).json({ ok: false, error: 'Missing key or value' });
  const pad = loadScratchpad();
  const idx = pad.entries.findIndex(e => e.key === key);
  const entry = { key, value, agent: agent || 'user', ts: new Date().toISOString() };
  if (idx >= 0) pad.entries[idx] = entry;
  else pad.entries.push(entry);
  saveScratchpad(pad);
  broadcast();
  res.json({ ok: true, entry });
});

app.delete('/api/scratchpad/:key', (req, res) => {
  const pad = loadScratchpad();
  pad.entries = pad.entries.filter(e => e.key !== req.params.key);
  saveScratchpad(pad);
  res.json({ ok: true });
});

// ─── Upload endpoint ──────────────────────────────────────────────────────────

app.post('/api/upload', upload.array('files', 10), (req, res) => {
  const files = req.files.map(f => ({
    id: path.basename(f.filename, path.extname(f.filename)),
    name: f.originalname,
    url: `/uploads/${f.filename}`,
    type: f.mimetype.startsWith('image/') ? 'image' : 'file',
    size: f.size,
  }));
  res.json({ ok: true, files });
});

// ─── Static serving (production) ─────────────────────────────────────────────

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(join(__dirname, 'dist')));
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Agent Cube server running at http://localhost:${PORT}`);
});

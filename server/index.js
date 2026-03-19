import express from 'express';
import cors from 'cors';
import { join } from 'path';
import { __dirname, PORT, UPLOADS_DIR } from './config.js';
import { loadQueuedTasks, clearQueuedTasks } from './memory.js';
import { state, agentQueues, agentQueueMeta } from './state.js';
import { scheduleAgent } from './agents.js';

// Routes
import tasksRouter from './routes/tasks.js';
import groupRouter from './routes/group.js';
import statusRouter from './routes/status.js';
import messagesRouter from './routes/messages.js';
import memoryRouter from './routes/memory.js';
import orchestrateRouter from './routes/orchestrate.js';
import scratchpadRouter from './routes/scratchpad.js';
import uploadRouter from './routes/upload.js';

// ── Restore queued tasks from disk on startup ─────────────────────────────────
(function restoreQueues() {
  const saved = loadQueuedTasks();
  let restored = 0;
  for (const [agentName, tasks] of Object.entries(saved)) {
    if (!Array.isArray(tasks)) continue;
    for (const meta of tasks) {
      if (!meta?.taskId || !meta?.description || !meta?.agent) continue;
      if (!state.tasks[meta.taskId]) {
        state.tasks[meta.taskId] = {
          id: meta.taskId, agent: meta.agent, description: meta.description,
          by: 'User', status: 'queued', latestLog: 'Restored from queue',
          result: null, source: 'group', createdAt: meta.createdAt || new Date().toISOString(),
        };
      }
      const run = () => scheduleAgent(meta.agent, meta.taskId, meta.description);
      agentQueues[agentName] = agentQueues[agentName] || [];
      agentQueueMeta[agentName] = agentQueueMeta[agentName] || [];
      agentQueues[agentName].push(run);
      agentQueueMeta[agentName].push(meta);
      restored++;
    }
  }
  if (restored > 0) console.log(`[startup] Restored ${restored} queued task(s)`);
  else clearQueuedTasks();
})();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', tasksRouter);
app.use('/api', groupRouter);
app.use('/api', statusRouter);
app.use('/api', messagesRouter);
app.use('/api', memoryRouter);
app.use('/api', orchestrateRouter);
app.use('/api', scratchpadRouter);
app.use('/api', uploadRouter);

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(join(__dirname, '..', 'dist')));
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Agent Cube server running at http://localhost:${PORT}`);
});

import express from 'express';
import cors from 'cors';
import { join } from 'path';
import { __dirname, PORT, UPLOADS_DIR } from './config.js';
import { loadQueuedTasks, clearQueuedTasks } from './memory.js';
import { state, agentTaskQueues, dequeueAgentTask } from './state.js';
import { scheduleAgent } from './agents.js';
// Routes
import tasksRouter from './routes/tasks.js';
import groupRouter from './routes/group.js';
import groupsRouter from './routes/groups.js';
import agentsApiRouter from './routes/agents-api.js';
import statusRouter from './routes/status.js';
import messagesRouter from './routes/messages.js';
import memoryRouter from './routes/memory.js';
import orchestrateRouter from './routes/orchestrate.js';
import scratchpadRouter from './routes/scratchpad.js';
import uploadRouter from './routes/upload.js';
import tokensRouter from './routes/tokens.js';
// ── Restore queued tasks from disk on startup ─────────────────────────────────
(async function restoreQueues() {
    const saved = loadQueuedTasks();
    let restored = 0;
    for (const [agentName, tasks] of Object.entries(saved)) {
        if (!Array.isArray(tasks) || !agentTaskQueues[agentName])
            continue;
        for (const meta of tasks) {
            const m = meta;
            if (!m?.taskId || !m?.description || !m?.agent)
                continue;
            if (!state.tasks[m.taskId]) {
                state.tasks[m.taskId] = {
                    id: m.taskId, agent: m.agent, description: m.description,
                    by: 'User', status: 'queued', latestLog: 'Restored from queue',
                    result: null, delegatedBy: null, parentTaskId: null,
                    source: 'group', createdAt: m.createdAt || new Date().toISOString(),
                };
            }
            agentTaskQueues[agentName].enqueue(() => scheduleAgent(m.agent, m.taskId, m.description), { taskId: m.taskId, agent: m.agent, description: m.description, createdAt: m.createdAt || new Date().toISOString() });
            restored++;
        }
    }
    if (restored > 0) {
        console.log(`[startup] Restored ${restored} queued task(s)`);
        for (const [agentName, queue] of Object.entries(agentTaskQueues)) {
            if (queue.length > 0)
                dequeueAgentTask(agentName);
        }
    }
    else
        clearQueuedTasks();
})();
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', tasksRouter);
app.use('/api', groupRouter);
app.use('/api', groupsRouter);
app.use('/api', agentsApiRouter);
app.use('/api', statusRouter);
app.use('/api', messagesRouter);
app.use('/api', memoryRouter);
app.use('/api', orchestrateRouter);
app.use('/api', scratchpadRouter);
app.use('/api', uploadRouter);
app.use('/api', tokensRouter);
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(join(__dirname, '..', 'dist')));
app.get('*', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'dist', 'index.html'));
});
app.listen(PORT, () => {
    console.log(`Agent Cube server running at http://localhost:${PORT}`);
});

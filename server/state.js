import { eventBus } from './event-bus.js';
import { appendGroupMessage, loadGroupMessages, trimGroupMessagesFile, saveQueuedTasks, loadTasksState, saveTasksState } from './memory.js';
import { loadAgentRegistry } from './registry.js';
import { AgentTaskQueue } from './agent-queue.js';
export { saveTasksState };

// ── Initial state — pre-loaded from disk ─────────────────────────────────────
const persistedMessages = loadGroupMessages();
const persistedTasks = loadTasksState();

// Restore taskCounter from persisted tasks so IDs stay monotonically increasing
const _taskNums = Object.keys(persistedTasks).map(id => { const m = id.match(/^task-(\d+)-/); return m ? parseInt(m[1], 10) : 0; });
const _restoredTaskCounter = _taskNums.length > 0 ? Math.max(..._taskNums) : 0;

// Dynamically initialize agents from registry
const _registeredAgents = loadAgentRegistry();
const _agentsInitial = {};
for (const a of _registeredAgents) {
  _agentsInitial[a.name] = { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null };
}
// Orchestrator is a virtual routing agent, not a provider-backed agent
_agentsInitial.Orchestrator = { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null };

export const state = {
  agents: _agentsInitial,
  tasks: persistedTasks,
  messages: [],
  groupMessages: persistedMessages,
  taskCounter: _restoredTaskCounter,
  orchestrations: {},
  // Thread-based multi-agent conversations
  threads: {},
  threadCounter: 0,
};

// ── Legacy SSE clients (agent status panel) ───────────────────────────────────
export const sseClients = new Set();

export function broadcast() {
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

// ── Per-agent task queues (AgentTaskQueue instances) ──────────────────────────
const QUEUE_CAP = 20;

export const agentTaskQueues = {};
for (const a of _registeredAgents) {
  agentTaskQueues[a.name] = new AgentTaskQueue(a.name, QUEUE_CAP);
}

// Serialize all queue metas and persist to disk.
export function persistQueues() {
  const allMeta = Object.fromEntries(
    Object.entries(agentTaskQueues).map(([name, q]) => [name, q.getMeta()])
  );
  const hasQueued = Object.values(agentTaskQueues).some(q => q.length > 0);
  if (hasQueued) saveQueuedTasks(allMeta);
}

// Dequeue and run the next task for an agent; persist queue state afterward.
export function dequeueAgentTask(agentName) {
  if (!agentTaskQueues[agentName]) return;
  agentTaskQueues[agentName].dequeue();
  persistQueues();
}

// ── Group chat: now routes through EventBus + persists to disk ────────────────
export function pushGroupMsg(type, from, content, meta = {}) {
  const event = eventBus.emit({ type, from, content, ...meta });

  // Persist to disk (skip high-frequency streaming partials to avoid file spam)
  if (!meta.partial) {
    // Also keep in-memory groupMessages for /api/group polling
    state.groupMessages.push(event);
    if (state.groupMessages.length > 500) state.groupMessages.shift();
    appendGroupMessage(event);
  }

  return event;
}

// broadcastGroup is no longer used directly; EventBus handles fan-out.
export function broadcastGroup() {}

// Re-export groupSseClients as an empty set (SSE is now managed per-connection in group.js)
export const groupSseClients = new Set();

// ── Trim persisted messages file every hour ───────────────────────────────────
setInterval(trimGroupMessagesFile, 60 * 60 * 1000);

// ── Watchdog: reset stuck agents after 8 minutes ─────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [, a] of Object.entries(state.agents)) {
    if (a.status === 'working' && a._startedAt && (now - a._startedAt) > 8 * 60 * 1000) {
      a.status = 'blocked';
      a.latestLog = 'Timed out (8 min)';
      broadcast();
    }
  }
}, 30_000);

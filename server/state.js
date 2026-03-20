import { eventBus } from './event-bus.js';
import { appendGroupMessage, loadGroupMessages, trimGroupMessagesFile, saveQueuedTasks, loadTasksState, saveTasksState } from './memory.js';
export { saveTasksState };

// ── Initial state — pre-loaded from disk ─────────────────────────────────────
const persistedMessages = loadGroupMessages();
const persistedTasks = loadTasksState();

export const state = {
  agents: {
    Claw: { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null },
    Deep: { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null },
    Orchestrator: { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null },
  },
  tasks: persistedTasks,
  messages: [],
  groupMessages: persistedMessages,
  taskCounter: 0,
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

// ── Per-agent task queues ─────────────────────────────────────────────────────
// agentQueues: executable functions (not serializable)
// agentQueueMeta: serializable metadata for persistence
export const agentQueues = { Claw: [], Deep: [] };
export const agentQueueMeta = { Claw: [], Deep: [] };

export function enqueueAgentTask(agentName, taskFn, meta = null) {
  agentQueues[agentName].push(taskFn);
  if (meta) {
    agentQueueMeta[agentName].push(meta);
    saveQueuedTasks(agentQueueMeta);
  }
}

export function dequeueAgentTask(agentName) {
  const next = agentQueues[agentName].shift();
  agentQueueMeta[agentName].shift(); // keep in sync
  // Only write to disk if there are still queued tasks
  const hasQueued = Object.values(agentQueueMeta).some(q => q.length > 0);
  if (hasQueued) saveQueuedTasks(agentQueueMeta);
  if (next) next();
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

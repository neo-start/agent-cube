import { appendGroupMessageForGroup, loadGroupMessagesForGroup, trimGroupMessagesFileForGroup, migrateGroupMessages, saveQueuedTasks, loadTasksState, saveTasksState } from './memory.js';
import { loadAgentRegistry } from './registry.js';
import { loadGroupRegistry } from './group-registry.js';
import { getGroupBus } from './group-bus.js';
import { AgentTaskQueue } from './agent-queue.js';
import type { AppState, AgentState, GroupMessage } from './types.js';
export { saveTasksState };

// ── Migrate old group-messages.jsonl on startup ───────────────────────────────
migrateGroupMessages();

// ── Initial state — pre-loaded from disk ─────────────────────────────────────
const persistedTasks = loadTasksState();

// Restore taskCounter from persisted tasks so IDs stay monotonically increasing
const _taskNums = Object.keys(persistedTasks).map(id => { const m = id.match(/^task-(\d+)-/); return m ? parseInt(m[1], 10) : 0; });
const _restoredTaskCounter = _taskNums.length > 0 ? Math.max(..._taskNums) : 0;

// Dynamically initialize agents from registry — all start idle (tasks handle their own status)
const _registeredAgents = loadAgentRegistry();
const _agentsInitial: Record<string, AgentState> = {};
for (const a of _registeredAgents) {
  _agentsInitial[a.name] = { status: 'idle', taskId: null, description: null, latestLog: 'Restarted', title: null, _startedAt: null };
}
// Orchestrator is a virtual routing agent, not a provider-backed agent
_agentsInitial['Orchestrator'] = { status: 'idle', taskId: null, description: null, latestLog: 'Restarted', title: null, _startedAt: null };

// Initialize per-group messages from all known groups
const _groupRegistry = loadGroupRegistry();
const _groupMessagesMap: Record<string, GroupMessage[]> = {};
for (const g of _groupRegistry) {
  _groupMessagesMap[g.id] = loadGroupMessagesForGroup(g.id);
}

export const state: AppState = {
  agents: _agentsInitial,
  tasks: persistedTasks,
  messages: [],
  groupMessages: _groupMessagesMap,  // { [groupId]: [...] }
  taskCounter: _restoredTaskCounter,
  orchestrations: {},
  // Thread-based multi-agent conversations
  // Initialize threadCounter from current timestamp (seconds) so IDs never collide across restarts
  threads: {},
  threadCounter: Math.floor(Date.now() / 1000),
};

// ── Legacy SSE clients (agent status panel) ───────────────────────────────────
export const sseClients = new Set<import('express').Response>();

export function broadcast(): void {
  const payload = JSON.stringify(
    Object.fromEntries(
      Object.entries(state.agents).map(([name, a]) => [
        name,
        { status: a.status, task: a.title, log: a.latestLog, updated: new Date().toISOString() },
      ])
    )
  );
  for (const res of sseClients) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ── Per-agent task queues (AgentTaskQueue instances) ──────────────────────────
const QUEUE_CAP = 20;

export const agentTaskQueues: Record<string, AgentTaskQueue> = {};
for (const a of _registeredAgents) {
  agentTaskQueues[a.name] = new AgentTaskQueue(a.name, QUEUE_CAP);
}

// Serialize all queue metas and persist to disk.
export function persistQueues(): void {
  const allMeta = Object.fromEntries(
    Object.entries(agentTaskQueues).map(([name, q]) => [name, q.getMeta()])
  );
  const hasQueued = Object.values(agentTaskQueues).some(q => q.length > 0);
  if (hasQueued) saveQueuedTasks(allMeta as Record<string, unknown[]>);
}

// Dequeue and run the next task for an agent; persist queue state afterward.
export function dequeueAgentTask(agentName: string): void {
  if (!agentTaskQueues[agentName]) return;
  agentTaskQueues[agentName].dequeue();
  persistQueues();
}

// ── Group chat: routes through per-group EventBus + persists to disk ──────────
export function pushGroupMsg(type: string, from: string, content: string, meta: Record<string, unknown> = {}): GroupMessage {
  const groupId = (meta['groupId'] as string) || 'default';
  const bus = getGroupBus(groupId);
  const event = bus.emit({ type, from, content, ...meta });

  // Persist to disk (skip high-frequency streaming partials to avoid file spam)
  if (!meta['partial']) {
    if (!state.groupMessages[groupId]) state.groupMessages[groupId] = [];
    state.groupMessages[groupId].push(event);
    if (state.groupMessages[groupId].length > 500) state.groupMessages[groupId].shift();
    appendGroupMessageForGroup(groupId, event);
  }

  return event;
}

// SSE clients for group streams are managed per-connection in routes/group.ts
export const groupSseClients = new Set<import('express').Response>();

// ── Trim persisted messages files every hour ──────────────────────────────────
setInterval(() => {
  for (const groupId of Object.keys(state.groupMessages)) {
    trimGroupMessagesFileForGroup(groupId);
  }
}, 60 * 60 * 1000);

// ── Watchdog: reset stuck agents after 8 minutes ─────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [name, a] of Object.entries(state.agents)) {
    if (a.status === 'working' && a._startedAt && (now - a._startedAt) > 8 * 60 * 1000) {
      a.status = 'blocked';
      a.latestLog = 'Timed out (8 min)';
      saveTasksState(state.tasks);
      dequeueAgentTask(name);
      broadcast();
    }
  }
}, 30_000);

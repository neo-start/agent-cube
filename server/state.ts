import { appendGroupMessageForGroup, loadGroupMessagesForGroup, trimGroupMessagesFileForGroup, migrateGroupMessages, saveQueuedTasks, loadTasksState, saveTasksState, loadProjects, listThreads } from './memory.js';
import { loadAgentRegistry } from './registry.js';
import { loadGroupRegistry } from './group-registry.js';
import { getGroupBus } from './group-bus.js';
import { AgentTaskQueue } from './agent-queue.js';
import { EventEmitter } from 'events';
import type { AppState, AgentState, GroupMessage, Project } from './types.js';
export { saveTasksState };

// ── Task completion events (replaces polling in orchestration) ───────────────
export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(100);

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
  _agentsInitial[a.name] = { status: 'idle', taskId: null, description: null, latestLog: 'Restarted', title: null, _startedAt: null, _nudgedAt: null };
}
// Orchestrator is a virtual routing agent, not a provider-backed agent
_agentsInitial['Orchestrator'] = { status: 'idle', taskId: null, description: null, latestLog: 'Restarted', title: null, _startedAt: null, _nudgedAt: null };

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
  threads: (() => {
    // Restore threads from disk on startup; deduplicate by id (keep most recent file per thread)
    const map: Record<string, import('./types.js').Thread> = {};
    for (const t of listThreads()) {
      const existing = map[t.id];
      if (!existing || new Date(t.startedAt) > new Date(existing.startedAt)) {
        map[t.id] = t;
      }
    }
    return map;
  })(),
  threadCounter: Math.floor(Date.now() / 1000),
  projects: loadProjects() as Record<string, Project>,
  pendingClarifications: {},
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

  // Persist to disk:
  // - skip partial streaming chunks (high-frequency, no value in history)
  // - skip 'stream' type entirely: they start empty and get replaced by 'reply' when done;
  //   if the server restarts mid-stream they'd be stuck as "typing..." in history forever
  // - skip transient 'working' status messages: they are ephemeral indicators that have no
  //   value after a restart and would flood the 500-msg window, pushing real replies out
  const isTransientStatus = type === 'status' && meta['status'] === 'working';
  if (!meta['partial'] && type !== 'stream' && !isTransientStatus) {
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

// ── Watchdog: nudge at 20 min, force-reset at 35 min ─────────────────────────
const WATCHDOG_NUDGE_MS  = 20 * 60 * 1000;   // 20 minutes — ask for progress
const WATCHDOG_TIMEOUT_MS = 35 * 60 * 1000;   // 35 minutes — force reset

setInterval(() => {
  const now = Date.now();
  for (const [name, a] of Object.entries(state.agents)) {
    if (a.status !== 'working' || !a._startedAt) continue;
    const elapsed = now - a._startedAt;

    // Phase 2: Hard timeout — force reset to blocked
    if (elapsed > WATCHDOG_TIMEOUT_MS) {
      const taskId = a.taskId;
      const task = taskId ? state.tasks[taskId] : null;
      const groupId = task?.groupId || 'default';

      a.status = 'blocked';
      a.latestLog = `Timed out after ${Math.round(elapsed / 60000)} min`;
      a._nudgedAt = null;

      // Update task status so orchestration watchers can detect completion
      if (task) task.status = 'blocked';

      // Notify group chat so the user can see what happened
      if (task && (task.source === 'group' || task.source === 'orchestrate' || task.source === 'delegate')) {
        pushGroupMsg('status', name,
          `⏱ Timed out after ${Math.round(elapsed / 60000)} min. Task: ${a.title ?? '(unknown)'}. Resetting to blocked.`,
          { taskId: taskId!, groupId, status: 'blocked' }
        );
      }

      saveTasksState(state.tasks);
      dequeueAgentTask(name);
      broadcast();
      // Emit task-done so orchestration event watchers can react
      if (taskId) taskEvents.emit('task-done', taskId);
      continue;
    }

    // Phase 1: Nudge — ask agent to report progress (once only)
    if (elapsed > WATCHDOG_NUDGE_MS && !a._nudgedAt) {
      a._nudgedAt = now;
      const taskId = a.taskId;
      const task = taskId ? state.tasks[taskId] : null;
      const groupId = task?.groupId || 'default';

      a.latestLog = `Nudged at ${Math.round(elapsed / 60000)} min — waiting for progress`;
      broadcast();

      if (task && (task.source === 'group' || task.source === 'orchestrate' || task.source === 'delegate')) {
        pushGroupMsg('status', 'System',
          `⏳ ${name} has been working for ${Math.round(elapsed / 60000)} min on: "${a.title ?? '(unknown)'}". Will timeout at 35 min.`,
          { taskId: taskId!, groupId, status: 'nudge' }
        );
      }
    }
  }
}, 30_000);

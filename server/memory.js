import fs from 'fs';
import path from 'path';
import { MEMORY_DIR, LOGS_DIR, SCRATCHPAD_FILE, SOULS_DIR, LONG_TERM_DIR, INBOX_DIR, THREADS_DIR, DATA_DIR } from './config.js';

const GROUP_MESSAGES_FILE = path.join(DATA_DIR, 'group-messages.jsonl');
const GROUPS_DIR = path.join(DATA_DIR, 'groups');
const QUEUED_TASKS_FILE = path.join(DATA_DIR, 'queued-tasks.json');
const TASKS_STATE_FILE = path.join(DATA_DIR, 'tasks-state.json');
const GROUP_MESSAGES_LIMIT = 500;
const TASKS_KEEP_RECENT = 200; // max tasks to keep in snapshot

// ── Per-group message persistence ─────────────────────────────────────────────

function getGroupMessagesFile(groupId) {
  const dir = path.join(GROUPS_DIR, groupId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'messages.jsonl');
}

export function appendGroupMessageForGroup(groupId, msg) {
  try {
    fs.appendFileSync(getGroupMessagesFile(groupId), JSON.stringify(msg) + '\n');
  } catch {}
}

export function loadGroupMessagesForGroup(groupId) {
  try {
    const f = getGroupMessagesFile(groupId);
    if (!fs.existsSync(f)) return [];
    const lines = fs.readFileSync(f, 'utf-8').split('\n').filter(l => l.trim());
    const tail = lines.slice(-GROUP_MESSAGES_LIMIT);
    return tail.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function trimGroupMessagesFileForGroup(groupId) {
  try {
    const f = getGroupMessagesFile(groupId);
    if (!fs.existsSync(f)) return;
    const lines = fs.readFileSync(f, 'utf-8').split('\n').filter(l => l.trim());
    if (lines.length > GROUP_MESSAGES_LIMIT * 2) {
      const trimmed = lines.slice(-GROUP_MESSAGES_LIMIT);
      fs.writeFileSync(f, trimmed.join('\n') + '\n');
    }
  } catch {}
}

// Migration: move old global group-messages.jsonl → groups/default/messages.jsonl
export function migrateGroupMessages() {
  if (!fs.existsSync(GROUP_MESSAGES_FILE)) return;
  try {
    const content = fs.readFileSync(GROUP_MESSAGES_FILE, 'utf-8');
    const defaultFile = getGroupMessagesFile('default');
    const exists = fs.existsSync(defaultFile);
    const empty = exists && fs.readFileSync(defaultFile, 'utf-8').trim() === '';
    if (!exists || empty) {
      fs.writeFileSync(defaultFile, content);
    }
    fs.renameSync(GROUP_MESSAGES_FILE, GROUP_MESSAGES_FILE + '.bak');
    console.log('[migration] Moved group-messages.jsonl → groups/default/messages.jsonl');
  } catch (e) {
    console.error('[migration] Failed to migrate group messages:', e);
  }
}

// ── Task state persistence ─────────────────────────────────────────────────────

export function saveTasksState(tasks) {
  try {
    // Keep only recent tasks (by createdAt), skip ones with no status
    const all = Object.values(tasks).filter(t => t && t.id);
    const sorted = all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const recent = sorted.slice(0, TASKS_KEEP_RECENT);
    const obj = Object.fromEntries(recent.map(t => [t.id, t]));
    fs.writeFileSync(TASKS_STATE_FILE, JSON.stringify(obj, null, 2));
  } catch {}
}

export function loadTasksState() {
  try {
    if (!fs.existsSync(TASKS_STATE_FILE)) return {};
    const tasks = JSON.parse(fs.readFileSync(TASKS_STATE_FILE, 'utf8'));
    // Mark any "working" tasks as "blocked" — they were interrupted by restart
    for (const task of Object.values(tasks)) {
      if (task.status === 'working') {
        task.status = 'blocked';
        task.latestLog = 'Interrupted by server restart';
      }
    }
    return tasks;
  } catch { return {}; }
}

// ── Group message persistence (backward compat: delegate to default group) ────

export function appendGroupMessage(msg) { appendGroupMessageForGroup('default', msg); }
export function loadGroupMessages() { return loadGroupMessagesForGroup('default'); }
export function trimGroupMessagesFile() { trimGroupMessagesFileForGroup('default'); }

// ── Queued task persistence ───────────────────────────────────────────────────

export function saveQueuedTasks(queues) {
  try {
    // Only save serializable task info (no functions)
    const serializable = {};
    for (const [agent, tasks] of Object.entries(queues)) {
      serializable[agent] = tasks.map(t => (typeof t === 'object' ? t : null)).filter(Boolean);
    }
    fs.writeFileSync(QUEUED_TASKS_FILE, JSON.stringify(serializable, null, 2));
  } catch {}
}

export function loadQueuedTasks() {
  try {
    if (!fs.existsSync(QUEUED_TASKS_FILE)) return {};
    return JSON.parse(fs.readFileSync(QUEUED_TASKS_FILE, 'utf8'));
  } catch { return {}; }
}

export function clearQueuedTasks() {
  try { fs.writeFileSync(QUEUED_TASKS_FILE, '{}'); } catch {}
}

export function loadMemory(agentName) {
  try {
    const f = path.join(MEMORY_DIR, `${agentName}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : [];
  } catch { return []; }
}

export function saveMemory(agentName, messages) {
  const trimmed = messages.slice(-30);
  fs.writeFileSync(path.join(MEMORY_DIR, `${agentName}.json`), JSON.stringify(trimmed, null, 2));
}

export function appendMemory(agentName, role, content) {
  const mem = loadMemory(agentName);
  mem.push({ role, content, ts: new Date().toISOString() });
  saveMemory(agentName, mem);
}

export function logTask(taskId, data) {
  try {
    fs.writeFileSync(path.join(LOGS_DIR, `task-${taskId}.json`), JSON.stringify(data, null, 2));
  } catch {}
}

export function loadScratchpad() {
  try {
    return fs.existsSync(SCRATCHPAD_FILE)
      ? JSON.parse(fs.readFileSync(SCRATCHPAD_FILE, 'utf-8'))
      : { entries: [] };
  } catch { return { entries: [] }; }
}

export function saveScratchpad(data) {
  try {
    fs.writeFileSync(SCRATCHPAD_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

// ─── Soul (persona) ────────────────────────────────────────────────────────────

export function loadSoul(agentName) {
  try {
    const f = path.join(SOULS_DIR, `${agentName}.md`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : null;
  } catch { return null; }
}

// ─── Long-term memory ──────────────────────────────────────────────────────────

export function loadLongTermMemory(agentName) {
  try {
    const f = path.join(LONG_TERM_DIR, `${agentName}.md`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : '';
  } catch { return ''; }
}

export function saveLongTermMemory(agentName, content) {
  try {
    fs.writeFileSync(path.join(LONG_TERM_DIR, `${agentName}.md`), content, 'utf-8');
  } catch {}
}

export function appendLongTermMemory(agentName, entry) {
  const existing = loadLongTermMemory(agentName);
  const timestamp = new Date().toISOString().slice(0, 16);
  const newEntry = `\n## ${timestamp}\n${entry}\n`;
  saveLongTermMemory(agentName, existing + newEntry);
}

// ─── Inbox (file-based mailbox per agent per thread) ──────────────────────────
// Each message is a JSON line appended to ~/.agent-cube/inboxes/{Agent}-{threadId}.jsonl

export function appendInbox(agentName, threadId, message) {
  try {
    const f = path.join(INBOX_DIR, `${agentName}-${threadId}.jsonl`);
    const entry = JSON.stringify({ ...message, deliveredAt: new Date().toISOString() });
    fs.appendFileSync(f, entry + '\n', 'utf-8');
  } catch {}
}

export function readInbox(agentName, threadId) {
  try {
    const f = path.join(INBOX_DIR, `${agentName}-${threadId}.jsonl`);
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

export function clearInbox(agentName, threadId) {
  try {
    const f = path.join(INBOX_DIR, `${agentName}-${threadId}.jsonl`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch {}
}

// ─── Thread persistence ────────────────────────────────────────────────────────

export function saveThread(thread) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const f = path.join(THREADS_DIR, `${date}-${thread.id}.json`);
    fs.writeFileSync(f, JSON.stringify(thread, null, 2), 'utf-8');
  } catch {}
}

export function listThreads() {
  try {
    return fs.readdirSync(THREADS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  } catch { return []; }
}

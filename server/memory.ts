import fs from 'fs';
import path from 'path';
import { MEMORY_DIR, LOGS_DIR, SCRATCHPAD_FILE, SOULS_DIR, LONG_TERM_DIR, INBOX_DIR, THREADS_DIR, DATA_DIR, PROJECTS_FILE } from './config.js';
import type { Task, Thread, MemoryEntry, Scratchpad, GroupMessage, Project } from './types.js';

const GROUP_MESSAGES_FILE = path.join(DATA_DIR, 'group-messages.jsonl');
const GROUPS_DIR = path.join(DATA_DIR, 'groups');
const QUEUED_TASKS_FILE = path.join(DATA_DIR, 'queued-tasks.json');
const TASKS_STATE_FILE = path.join(DATA_DIR, 'tasks-state.json');
const GROUP_MESSAGES_LIMIT = 500;
const TASKS_KEEP_RECENT = 200; // max tasks to keep in snapshot

// ── Per-group message persistence ─────────────────────────────────────────────

function getGroupMessagesFile(groupId: string): string {
  const dir = path.join(GROUPS_DIR, groupId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'messages.jsonl');
}

export function appendGroupMessageForGroup(groupId: string, msg: GroupMessage): void {
  try {
    fs.appendFileSync(getGroupMessagesFile(groupId), JSON.stringify(msg) + '\n');
  } catch {}
}

export function loadGroupMessagesForGroup(groupId: string): GroupMessage[] {
  try {
    const f = getGroupMessagesFile(groupId);
    if (!fs.existsSync(f)) return [];
    const lines = fs.readFileSync(f, 'utf-8').split('\n').filter(l => l.trim());
    const tail = lines.slice(-GROUP_MESSAGES_LIMIT);
    return tail.map(l => { try { return JSON.parse(l) as GroupMessage; } catch { return null; } }).filter((x): x is GroupMessage => x !== null);
  } catch { return []; }
}

export function trimGroupMessagesFileForGroup(groupId: string): void {
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
export function migrateGroupMessages(): void {
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

export function saveTasksState(tasks: Record<string, Task>): void {
  try {
    // Keep only recent tasks (by createdAt), skip ones with no status
    const all = Object.values(tasks).filter(t => t && t.id);
    const sorted = all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const recent = sorted.slice(0, TASKS_KEEP_RECENT);
    const obj = Object.fromEntries(recent.map(t => [t.id, t]));
    fs.writeFileSync(TASKS_STATE_FILE, JSON.stringify(obj, null, 2));
  } catch {}
}

export function loadTasksState(): Record<string, Task> {
  try {
    if (!fs.existsSync(TASKS_STATE_FILE)) return {};
    const tasks: Record<string, Task> = JSON.parse(fs.readFileSync(TASKS_STATE_FILE, 'utf8'));
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

export function appendGroupMessage(msg: GroupMessage): void { appendGroupMessageForGroup('default', msg); }
export function loadGroupMessages(): GroupMessage[] { return loadGroupMessagesForGroup('default'); }
export function trimGroupMessagesFile(): void { trimGroupMessagesFileForGroup('default'); }

// ── Queued task persistence ───────────────────────────────────────────────────

export function saveQueuedTasks(queues: Record<string, unknown[]>): void {
  try {
    // Only save serializable task info (no functions)
    const serializable: Record<string, unknown[]> = {};
    for (const [agent, tasks] of Object.entries(queues)) {
      serializable[agent] = tasks.map(t => (typeof t === 'object' ? t : null)).filter(Boolean);
    }
    fs.writeFileSync(QUEUED_TASKS_FILE, JSON.stringify(serializable, null, 2));
  } catch {}
}

export function loadQueuedTasks(): Record<string, unknown[]> {
  try {
    if (!fs.existsSync(QUEUED_TASKS_FILE)) return {};
    return JSON.parse(fs.readFileSync(QUEUED_TASKS_FILE, 'utf8'));
  } catch { return {}; }
}

export function clearQueuedTasks(): void {
  try { fs.writeFileSync(QUEUED_TASKS_FILE, '{}'); } catch {}
}

export function loadMemory(agentName: string): MemoryEntry[] {
  try {
    const f = path.join(MEMORY_DIR, `${agentName}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) as MemoryEntry[] : [];
  } catch { return []; }
}

export function saveMemory(agentName: string, messages: MemoryEntry[]): void {
  const trimmed = messages.slice(-30);
  fs.writeFileSync(path.join(MEMORY_DIR, `${agentName}.json`), JSON.stringify(trimmed, null, 2));
}

export function appendMemory(agentName: string, role: string, content: string): void {
  const mem = loadMemory(agentName);
  mem.push({ role, content, ts: new Date().toISOString() });
  saveMemory(agentName, mem);
}

export function logTask(taskId: string, data: unknown): void {
  try {
    fs.writeFileSync(path.join(LOGS_DIR, `task-${taskId}.json`), JSON.stringify(data, null, 2));
  } catch {}
}

export function loadScratchpad(): Scratchpad {
  try {
    return fs.existsSync(SCRATCHPAD_FILE)
      ? JSON.parse(fs.readFileSync(SCRATCHPAD_FILE, 'utf-8')) as Scratchpad
      : { entries: [] };
  } catch { return { entries: [] }; }
}

export function saveScratchpad(data: Scratchpad): void {
  try {
    fs.writeFileSync(SCRATCHPAD_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

// ─── Soul (persona) ────────────────────────────────────────────────────────────

export function loadSoul(agentName: string): string | null {
  try {
    const f = path.join(SOULS_DIR, `${agentName}.md`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : null;
  } catch { return null; }
}

// ─── Long-term memory ──────────────────────────────────────────────────────────

export function loadLongTermMemory(agentName: string): string {
  try {
    const f = path.join(LONG_TERM_DIR, `${agentName}.md`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : '';
  } catch { return ''; }
}

export function saveLongTermMemory(agentName: string, content: string): void {
  try {
    fs.writeFileSync(path.join(LONG_TERM_DIR, `${agentName}.md`), content, 'utf-8');
  } catch {}
}

export function appendLongTermMemory(agentName: string, entry: string): void {
  const existing = loadLongTermMemory(agentName);
  const timestamp = new Date().toISOString().slice(0, 16);
  const newEntry = `\n## ${timestamp}\n${entry}\n`;
  saveLongTermMemory(agentName, existing + newEntry);
}

// ─── Inbox (file-based mailbox per agent per thread) ──────────────────────────
// Each message is a JSON line appended to ~/.agent-cube/inboxes/{Agent}-{threadId}.jsonl

export function appendInbox(agentName: string, threadId: string, message: Record<string, unknown>): void {
  try {
    const f = path.join(INBOX_DIR, `${agentName}-${threadId}.jsonl`);
    const entry = JSON.stringify({ ...message, deliveredAt: new Date().toISOString() });
    fs.appendFileSync(f, entry + '\n', 'utf-8');
  } catch {}
}

export function readInbox(agentName: string, threadId: string): Record<string, unknown>[] {
  try {
    const f = path.join(INBOX_DIR, `${agentName}-${threadId}.jsonl`);
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } })
      .filter((x): x is Record<string, unknown> => x !== null);
  } catch { return []; }
}

export function clearInbox(agentName: string, threadId: string): void {
  try {
    const f = path.join(INBOX_DIR, `${agentName}-${threadId}.jsonl`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch {}
}

// ─── Thread persistence ────────────────────────────────────────────────────────

export function saveThread(thread: Thread): void {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const f = path.join(THREADS_DIR, `${date}-${thread.id}.json`);
    fs.writeFileSync(f, JSON.stringify(thread, null, 2), 'utf-8');
  } catch {}
}

export function listThreads(): Thread[] {
  try {
    return fs.readdirSync(THREADS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf-8')) as Thread; }
        catch { return null; }
      })
      .filter((x): x is Thread => x !== null)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  } catch { return []; }
}

// ── Project persistence ────────────────────────────────────────────────────────

export function loadProjects(): Record<string, Project> {
  try {
    if (!fs.existsSync(PROJECTS_FILE)) return {};
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8')) as Record<string, Project>;
  } catch { return {}; }
}

export function saveProjects(projects: Record<string, Project>): void {
  try {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8');
  } catch {}
}

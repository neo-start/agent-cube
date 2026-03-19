import fs from 'fs';
import path from 'path';
import { MEMORY_DIR, LOGS_DIR, SCRATCHPAD_FILE, SOULS_DIR, LONG_TERM_DIR, INBOX_DIR, THREADS_DIR } from './config.js';

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

import fs from 'fs';
import path from 'path';
import { MEMORY_DIR, LOGS_DIR, SCRATCHPAD_FILE } from './config.js';

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

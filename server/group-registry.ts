import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import { loadAgentRegistry } from './registry.js';
import type { Group } from './types.js';

const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');

function readGroups(): Group[] | null {
  try {
    if (!fs.existsSync(GROUPS_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8'));
    return data.groups || null;
  } catch { return null; }
}

function writeGroups(groups: Group[]): void {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify({ groups }, null, 2));
}

export function loadGroupRegistry(): Group[] {
  let groups = readGroups();
  if (!groups) {
    const agents = loadAgentRegistry().map(a => a.name);
    groups = [{
      id: 'default',
      name: 'Default Group',
      agents,
      description: '',
      createdAt: new Date().toISOString(),
    }];
    writeGroups(groups);
  }
  return groups;
}

export function getGroup(groupId: string): Group | null {
  const groups = loadGroupRegistry();
  return groups.find(g => g.id === groupId) || null;
}

export function createGroup({ name, agents = [], description = '' }: { name: string; agents?: string[]; description?: string }): Group {
  const groups = loadGroupRegistry();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const group: Group = { id, name, agents, description, createdAt: new Date().toISOString() };
  groups.push(group);
  writeGroups(groups);
  return group;
}

export function updateGroup(groupId: string, patch: Partial<Group>): Group | null {
  const groups = loadGroupRegistry();
  const idx = groups.findIndex(g => g.id === groupId);
  if (idx === -1) return null;
  groups[idx] = { ...groups[idx], ...patch };
  writeGroups(groups);
  return groups[idx];
}

export function deleteGroup(groupId: string): boolean {
  if (groupId === 'default') throw new Error('Cannot delete default group');
  const groups = loadGroupRegistry();
  const idx = groups.findIndex(g => g.id === groupId);
  if (idx === -1) return false;
  groups.splice(idx, 1);
  writeGroups(groups);
  return true;
}

export function getGroupAgents(groupId: string): string[] {
  const group = getGroup(groupId);
  return group ? group.agents : [];
}

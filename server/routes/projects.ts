import { Router } from 'express';
import { state } from '../state.js';
import { saveProjects } from '../memory.js';
import type { Project } from '../types.js';
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';

const router = Router();

// Allowed base directories for project workspaces
const ALLOWED_BASES = [
  path.join(homedir(), 'Stars'),
  path.join(homedir(), 'projects'),
  path.join(homedir(), 'workspace'),
];

function isAllowedDirectory(dir: string): boolean {
  const resolved = path.resolve(dir);
  return ALLOWED_BASES.some(base => resolved.startsWith(base + path.sep) || resolved === base);
}

// GET /api/projects — list all projects
router.get('/', (_req, res) => {
  res.json(Object.values(state.projects));
});

// POST /api/projects — create a project
router.post('/', (req, res) => {
  const { name, directory, groupId, description } = req.body as Partial<Project>;
  if (!name || !directory) {
    return res.status(400).json({ error: 'name and directory are required' });
  }
  const resolved = path.resolve(directory);
  if (!isAllowedDirectory(resolved)) {
    return res.status(400).json({ error: `directory must be under one of: ${ALLOWED_BASES.join(', ')}` });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(400).json({ error: `directory does not exist: ${resolved}` });
  }
  // Prevent binding the same directory to multiple projects
  const duplicate = Object.values(state.projects).find(p => path.resolve(p.directory) === resolved);
  if (duplicate) {
    return res.status(400).json({ error: `directory already bound to project "${duplicate.name}" (${duplicate.id})` });
  }
  const id = `project-${Date.now()}`;
  const project: Project = {
    id,
    name,
    directory: resolved,
    groupId,
    description,
    createdAt: new Date().toISOString(),
  };
  state.projects[id] = project;
  saveProjects(state.projects);
  res.json(project);
});

// DELETE /api/projects/:id — remove a project
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  if (!state.projects[id]) return res.status(404).json({ error: 'not found' });
  delete state.projects[id];
  saveProjects(state.projects);
  res.json({ ok: true });
});

export default router;

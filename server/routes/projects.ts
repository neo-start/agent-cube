import { Router } from 'express';
import { state } from '../state.js';
import { saveProjects } from '../memory.js';
import type { Project } from '../types.js';

const router = Router();

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
  const id = `project-${Date.now()}`;
  const project: Project = {
    id,
    name,
    directory,
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

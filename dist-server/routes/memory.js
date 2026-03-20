import { Router } from 'express';
import { loadMemory, saveMemory, loadSoul, loadLongTermMemory, saveLongTermMemory, appendLongTermMemory } from '../memory.js';
import { SOULS_DIR } from '../config.js';
import fs from 'fs';
import path from 'path';
const router = Router();
// ─── Short-term memory (conversation history) ───────────────────────────────
// GET /api/memory/:agent
router.get('/memory/:agent', (req, res) => {
    const agent = req.params['agent'];
    const mem = loadMemory(agent);
    res.json({ agent, messages: mem });
});
// DELETE /api/memory/:agent
router.delete('/memory/:agent', (req, res) => {
    const agent = req.params['agent'];
    saveMemory(agent, []);
    res.json({ ok: true });
});
// ─── Soul (persona) ─────────────────────────────────────────────────────────
// GET /api/soul/:agent
router.get('/soul/:agent', (req, res) => {
    const agent = req.params['agent'];
    const soul = loadSoul(agent);
    res.json({ agent, soul: soul || '' });
});
// PUT /api/soul/:agent
router.put('/soul/:agent', (req, res) => {
    const agent = req.params['agent'];
    const { content } = req.body;
    if (content === undefined)
        return res.status(400).json({ ok: false, error: 'Missing content' });
    try {
        fs.writeFileSync(path.join(SOULS_DIR, `${agent}.md`), content, 'utf-8');
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});
// ─── Long-term memory ────────────────────────────────────────────────────────
// GET /api/memory/:agent/long-term
router.get('/memory/:agent/long-term', (req, res) => {
    const agent = req.params['agent'];
    const mem = loadLongTermMemory(agent);
    res.json({ agent, memory: mem });
});
// PUT /api/memory/:agent/long-term — overwrite
router.put('/memory/:agent/long-term', (req, res) => {
    const agent = req.params['agent'];
    const { content } = req.body;
    if (content === undefined)
        return res.status(400).json({ ok: false, error: 'Missing content' });
    saveLongTermMemory(agent, content);
    res.json({ ok: true });
});
// POST /api/memory/:agent/long-term — append
router.post('/memory/:agent/long-term', (req, res) => {
    const agent = req.params['agent'];
    const { entry } = req.body;
    if (!entry)
        return res.status(400).json({ ok: false, error: 'Missing entry' });
    appendLongTermMemory(agent, entry);
    res.json({ ok: true });
});
export default router;

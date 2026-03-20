import { Router } from 'express';
import { randomUUID } from 'crypto';
import { state } from '../state.js';
const router = Router();
// GET /api/messages
router.get('/messages', (req, res) => {
    let msgs = state.messages;
    if (req.query['from'])
        msgs = msgs.filter(m => m.from === req.query['from']);
    if (req.query['to'])
        msgs = msgs.filter(m => m.to === req.query['to']);
    res.json({ messages: msgs });
});
// POST /api/messages
router.post('/messages', (req, res) => {
    const { from, to, text } = req.body;
    if (!from || !to || !text)
        return res.status(400).json({ ok: false, error: 'Missing fields' });
    const msg = {
        id: randomUUID(),
        from,
        to,
        text,
        timestamp: new Date().toISOString(),
        read: false,
    };
    state.messages.push(msg);
    if (state.messages.length > 200)
        state.messages.shift();
    res.json({ ok: true, message: msg });
});
export default router;

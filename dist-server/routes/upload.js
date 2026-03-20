import { Router } from 'express';
import path from 'path';
import { upload } from '../config.js';
const router = Router();
// POST /api/upload
router.post('/upload', (req, res) => {
    upload.array('files', 10)(req, res, (err) => {
        if (err) {
            const multerErr = err;
            const msg = multerErr.code === 'LIMIT_FILE_SIZE'
                ? `File too large (max 100MB)`
                : multerErr.message || 'Upload failed';
            return res.status(400).json({ ok: false, error: msg });
        }
        const files = (req.files || []).map(f => ({
            id: path.basename(f.filename, path.extname(f.filename)),
            name: f.originalname,
            url: `/uploads/${f.filename}`,
            type: f.mimetype.startsWith('image/') ? 'image' : 'file',
            size: f.size,
        }));
        res.json({ ok: true, files });
    });
});
export default router;

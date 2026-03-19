import { Router } from 'express';
import path from 'path';
import { upload } from '../config.js';

const router = Router();

// POST /api/upload
router.post('/upload', upload.array('files', 10), (req, res) => {
  const files = req.files.map(f => ({
    id: path.basename(f.filename, path.extname(f.filename)),
    name: f.originalname,
    url: `/uploads/${f.filename}`,
    type: f.mimetype.startsWith('image/') ? 'image' : 'file',
    size: f.size,
  }));
  res.json({ ok: true, files });
});

export default router;

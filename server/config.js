import path from 'path';
import os from 'os';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = dirname(__filename);

export const PORT = process.env.PORT || 3002;

export const DATA_DIR = path.join(os.homedir(), '.agent-cube');
export const MEMORY_DIR = path.join(DATA_DIR, 'memory');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const SCRATCHPAD_FILE = path.join(DATA_DIR, 'scratchpad.json');
export const SOULS_DIR = path.join(DATA_DIR, 'souls');
export const LONG_TERM_DIR = path.join(DATA_DIR, 'memory', 'long-term');

[DATA_DIR, MEMORY_DIR, LOGS_DIR, UPLOADS_DIR, SOULS_DIR, LONG_TERM_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

export const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024, files: 10 } });

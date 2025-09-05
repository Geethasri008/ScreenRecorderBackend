import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors({ origin: 'http://localhost:5173' })); // Vite default
app.use(morgan('dev'));
app.use(express.json());

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// SQLite setup
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    filesize INTEGER NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    cb(null, safe);
  }
});
const upload = multer({ storage });

// Routes
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Screen Recorder API running' });
});

// POST /api/recordings — upload video
app.post('/api/recordings', upload.single('video'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const { filename, path: filepath, size } = req.file;

    const insert = db.prepare('INSERT INTO recordings (filename, filepath, filesize) VALUES (?, ?, ?)');
    insert.run(filename, filepath, size, function (err) {
      if (err) return res.status(500).json({ error: 'DB insert failed' });
      const record = { id: this.lastID, filename, filepath, filesize: size };
      res.status(201).json({ message: 'Recording uploaded successfully', recording: record });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /api/recordings — list metadata
app.get('/api/recordings', (req, res) => {
  db.all('SELECT id, filename, filesize, createdAt FROM recordings ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB query failed' });
    res.json(rows);
  });
});

// GET /api/recordings/:id — stream video with range support
app.get('/api/recordings/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.get('SELECT * FROM recordings WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB query failed' });
    if (!row) return res.status(404).json({ error: 'Recording not found' });

    const videoPath = row.filepath;
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/webm'
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/webm'
      });
      fs.createReadStream(videoPath).pipe(res);
    }
  });
});

app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));

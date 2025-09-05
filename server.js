import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import multer from 'multer';
import pkg from 'pg';
import { v2 as cloudinary } from 'cloudinary';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors({ origin: 'https://screen-recorder-frontend-six.vercel.app/' })); // Update with frontend URL after deploy
app.use(morgan('dev'));
app.use(express.json());

// Cloudinary config (use env vars in Render)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Ensure table exists
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recordings (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      filesize BIGINT NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
})();

// Multer — keep files in memory (not disk)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Routes
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Screen Recorder API running' });
});

// POST /api/recordings — upload video to Cloudinary
app.post('/api/recordings', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { originalname, buffer, size } = req.file;

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { resource_type: 'video', folder: 'recordings' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        )
        .end(buffer);
    });

    // Save metadata in Postgres
    const result = await pool.query(
      `INSERT INTO recordings (filename, url, filesize) VALUES ($1, $2, $3) RETURNING *`,
      [originalname, uploadResult.secure_url, size]
    );

    res.status(201).json({
      message: 'Recording uploaded successfully',
      recording: result.rows[0]
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /api/recordings — list metadata
app.get('/api/recordings', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, filename, url, filesize, createdAt FROM recordings ORDER BY id DESC`
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB query failed' });
  }
});

// GET /api/recordings/:id — return Cloudinary video URL
app.get('/api/recordings/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM recordings WHERE id = $1`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Recording not found' });

    // Instead of streaming, just return Cloudinary URL
    res.json({ url: row.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB query failed' });
  }
});

app.listen(PORT, () =>
  console.log(`API listening on http://localhost:${PORT}`)
);

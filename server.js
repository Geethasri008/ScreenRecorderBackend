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
const cors = require("cors");
app.use(cors({
  origin: [
    "http://localhost:5173", 
    "https://screen-recorder-frontend-six.vercel.app"
  ],
  methods: ["GET", "POST"],
}));
app.use(morgan('dev'));
app.use(express.json());

// PostgreSQL
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Create table if not exists
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

// Cloudinary setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer (store in memory before upload to Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Root
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Screen Recorder API running' });
});

// Upload route
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload_stream(
      { resource_type: 'video', folder: 'recordings' },
      async (error, uploadResult) => {
        if (error) {
          console.error('Cloudinary error:', error);
          return res.status(500).json({ error: 'Upload to Cloudinary failed' });
        }

        // Save metadata to DB
        const { originalname, size } = req.file;
        const filename = `${Date.now()}-${originalname}`;
        await pool.query(
          'INSERT INTO recordings (filename, url, filesize) VALUES ($1, $2, $3)',
          [filename, uploadResult.secure_url, size]
        );

        res.json({ url: uploadResult.secure_url, filename });
      }
    );

    // Pipe file buffer to Cloudinary
    result.end(req.file.buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// List all recordings
app.get('/api/recordings', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, filename, url, filesize, createdAt FROM recordings ORDER BY id DESC'
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB query failed' });
  }
});

app.listen(PORT, () =>
  console.log(`✅ API listening on http://localhost:${PORT}`)
);

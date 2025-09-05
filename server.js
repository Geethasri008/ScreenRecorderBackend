import express from "express";
import cors from "cors";
import morgan from "morgan";
import multer from "multer";
import pkg from "pg";
import { v2 as cloudinary } from "cloudinary";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Allowed origins
const allowedOrigins = [
  "http://localhost:5173",
  "https://screen-recorder-frontend-six.vercel.app",
  "https://screen-recorder-frontend-ixl2xytsi-geethas-projects-594b30ca.vercel.app",
  "https://screen-recorder-frontend-n3stbe1wr-geethas-projects-594b30ca.vercel.app"
];

// Middlewares
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS not allowed"));
      }
    },
    methods: ["GET", "POST"],
  })
);
app.use(morgan("dev"));
app.use(express.json());

// PostgreSQL
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer (in memory)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Root route
app.get("/", (req, res) => {
  res.json({ status: "OK", message: "Screen Recorder API running" });
});

// Upload route
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Wrap Cloudinary upload_stream in a Promise
    const uploadToCloudinary = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: "video", folder: "recordings" },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });

    const uploadResult = await uploadToCloudinary();

    // Save to DB
    const { originalname, size } = req.file;
    const filename = `${Date.now()}-${originalname}`;
    await pool.query(
      "INSERT INTO recordings (filename, url, filesize) VALUES ($1, $2, $3)",
      [filename, uploadResult.secure_url, size]
    );

    res.json({ url: uploadResult.secure_url, filename });
  } catch (e) {
    console.error("Upload failed:", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

// List recordings
app.get("/api/recordings", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, filename, url, filesize, createdAt FROM recordings ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (e) {
    console.error("DB query failed:", e);
    res.status(500).json({ error: "DB query failed" });
  }
});

app.listen(PORT, () =>
  console.log(`✅ API listening on http://localhost:${PORT}`)
);

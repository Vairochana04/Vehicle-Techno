import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from './db.js';
import { config } from './config.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import jobRoutes from './routes/jobs.js';
import adminRoutes from './routes/admin.js';
import analyticsRoutes from './routes/analytics.js';
import verifyRoutes from './routes/verify.js';

seed();
const app = express();
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
const corsOrigin = config.isProduction ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean) : (process.env.CORS_ORIGIN || true);
app.use(cors({ origin: corsOrigin, credentials: true })); app.use(express.json({ limit: '5mb' }));
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'Valuation Techno API', mode: config.isProduction ? 'production' : 'preview', time: new Date().toISOString() }));
app.use('/api/auth', authRoutes); app.use('/api/jobs', jobRoutes); app.use('/api/admin', adminRoutes); app.use('/api/verify', verifyRoutes); app.use('/api', analyticsRoutes);
// Mobile App Layer: file upload with geo/time metadata + content hash for killfake duplicate checks
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => {
      const originalExt = path.extname(file.originalname || '').toLowerCase();
      const ext = /^\.[a-z0-9]{1,8}$/.test(originalExt) ? originalExt : '';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype?.startsWith('image/')) return cb(null, true);
    const error = new Error('Only image or PDF files are allowed.'); error.status = 415; cb(error);
  },
});
app.post('/api/upload', requireAuth, requireRole('INSPECTOR', 'BANK'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: file)' });
  const rejectUpload = (message) => { fs.rmSync(req.file.path, { force: true }); return res.status(400).json({ error: message }); };
  const coordinate = (value) => value === undefined || value === '' ? undefined : Number.isFinite(Number(value)) ? Number(value) : null;
  const lat = coordinate(req.body.lat); const lng = coordinate(req.body.lng);
  if (lat === null || lng === null || (lat === undefined) !== (lng === undefined)) return rejectUpload('Provide both valid GPS coordinates, or leave both blank.');
  if (lat !== undefined && (lat < -90 || lat > 90 || lng < -180 || lng > 180)) return rejectUpload('GPS coordinates are outside the valid range.');
  const capturedAt = req.body.capturedAt ? new Date(req.body.capturedAt) : new Date();
  if (!Number.isFinite(capturedAt.getTime())) return rejectUpload('The photo timestamp is invalid.');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
  res.status(201).json({ filename: req.file.filename, originalName: req.file.originalname, imageHash: hash, category: req.body.category || 'DAMAGE', lat, lng, capturedAt: capturedAt.toISOString() });
});
// Serve built frontend when present (single-port demo). `npm start` auto-builds it via prestart.
const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (fs.existsSync(webDist)) { app.use(express.static(webDist, { setHeaders: (res, filePath) => { if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store, must-revalidate'); } })); app.get('/project.zip', (req, res) => res.download(fileURLToPath(new URL('../../web/dist/project.zip', import.meta.url)), 'Valuation-Techno-Project.zip')); app.get('*', (req, res, next) => req.path.startsWith('/api') ? next() : res.sendFile(path.join(webDist, 'index.html'))); }
else {
  // Friendly help instead of a confusing "Cannot GET /" when the frontend was not built yet
  app.get('*', (req, res, next) => req.path.startsWith('/api') ? next() : res.status(200).type('html').send(`<!doctype html><html><body style="font-family:Arial,sans-serif;text-align:center;padding:40px"><h1>🚗 Valuation Techno — Server Running ✅</h1><p>The frontend has not been built yet. Stop the server in the VS Code terminal (Ctrl+C), then run these commands:</p><pre style="display:inline-block;text-align:left;background:#0f172a;color:#7dd3fc;padding:16px;border-radius:10px">npm.cmd run build\nnpm.cmd start</pre><p>Then refresh this page.</p></body></html>`));
}
app.use((err, req, res, next) => { console.error(err); if (err?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: err.errors }); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });
export default app;

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, publicUser, audit } from '../db.js';
import { uid, now } from '../utils.js';
import { sign, requireAuth, wrap, setTokenCookie } from '../middleware/auth.js';
const r = Router();
const creds = z.object({ email: z.string().email(), password: z.string().min(6) });

const loginAttempts = new Map(); // brute-force guard: 10 failures / 15 min per email+IP
function rateLimited(key) { const nowMs = Date.now(); const hits = (loginAttempts.get(key) || []).filter((t) => nowMs - t < 15 * 60000); loginAttempts.set(key, hits); return hits.length >= 10; }
function recordFailure(key) { const hits = loginAttempts.get(key) || []; hits.push(Date.now()); loginAttempts.set(key, hits); }

r.post('/register', wrap(async (req, res) => {
  const b = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(6), phone: z.string().optional(), role: z.enum(['BANK', 'INSPECTOR', 'LOAN_SEEKER']), bankName: z.string().optional(), lat: z.number().optional(), lng: z.number().optional() }).parse(req.body);
  if (db.prepare('SELECT id FROM users WHERE email=?').get(b.email)) return res.status(409).json({ error: 'Email already registered' });
  const id = uid();
  db.prepare('INSERT INTO users(id,role,name,email,phone,passwordHash,bankName,lat,lng,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, b.role, b.name, b.email, b.phone || null, bcrypt.hashSync(b.password, 10), b.bankName || null, b.lat ?? null, b.lng ?? null, now());
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  audit(null, id, 'USER_REGISTERED', b.role); const tok = sign(user); setTokenCookie(req, res, tok); res.status(201).json({ token: tok, user: publicUser(user) });
}));
r.post('/login', wrap(async (req, res) => {
  const b = creds.parse(req.body); const rlKey = `${b.email.toLowerCase()}|${req.ip}`;
  if (rateLimited(rlKey)) return res.status(429).json({ error: 'Too many failed login attempts. Try again in 15 minutes.' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(b.email);
  if (!user || !bcrypt.compareSync(b.password, user.passwordHash)) { recordFailure(rlKey); return res.status(401).json({ error: 'Invalid email or password' }); }
  loginAttempts.delete(rlKey);
  if (user.status === 'SUSPENDED') return res.status(403).json({ error: 'Account suspended. Contact platform support.' });
  const tok = sign(user); setTokenCookie(req, res, tok); res.json({ token: tok, user: publicUser(user) });
}));
r.post('/otp/request', wrap(async (req, res) => {
  const { phone } = z.object({ phone: z.string().min(10) }).parse(req.body);
  const code = String(100000 + Math.floor(Math.random() * 900000));
  db.prepare('INSERT INTO otp_codes VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET code=excluded.code, expiresAt=excluded.expiresAt').run(phone, code, new Date(Date.now() + 5 * 60000).toISOString());
  // Demo mode (non-production only): OTP returned so the flow is testable without Twilio/SMS.
  const isProd = process.env.NODE_ENV === 'production';
  res.json(isProd ? { message: 'OTP sent', expiresInSeconds: 300 } : { message: 'OTP sent (demo mode)', demoOtp: code, expiresInSeconds: 300 });
}));
r.post('/otp/verify', wrap(async (req, res) => {
  const { phone, code } = z.object({ phone: z.string(), code: z.string() }).parse(req.body);
  const row = db.prepare('SELECT * FROM otp_codes WHERE phone=?').get(phone);
  if (!row || row.code !== code || new Date(row.expiresAt) < new Date()) return res.status(401).json({ error: 'Invalid or expired OTP' });
  const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!user) return res.status(404).json({ error: 'No account for this phone. Please register first.' });
  const tok = sign(user); setTokenCookie(req, res, tok); res.json({ token: tok, user: publicUser(user) });
}));
r.post('/logout', (req, res) => { res.setHeader('Set-Cookie', 'vt_token=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true }); });
r.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
export default r;

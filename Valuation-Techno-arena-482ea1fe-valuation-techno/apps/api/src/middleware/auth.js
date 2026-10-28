import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db.js';
export function sign(user) { return jwt.sign({ id: user.id, role: user.role, email: user.email }, config.jwtSecret, { expiresIn: '7d' }); }
export function setTokenCookie(req, res, tok) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
  res.setHeader('Set-Cookie', `vt_token=${tok}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure ? '; Secure' : ''}`);
}
// Token may arrive via Authorization (API clients), X-Auth-Token (proxies that strip Authorization),
// HttpOnly cookie (browser same-origin), or ?token= (WebSocket / report links). Accept all of them.
export function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  if (req.headers['x-auth-token']) return req.headers['x-auth-token'];
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)vt_token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (req.query?.token) return req.query.token;
  return null;
}
export function requireAuth(req, res, next) {
  const tok = extractToken(req);
  if (!tok) return res.status(401).json({ error: 'Login required' });
  try {
    const payload = jwt.verify(tok, config.jwtSecret);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Session expired — please login again', code: 'SESSION_EXPIRED' });
    req.user = user; next();
  } catch { return res.status(401).json({ error: 'Session expired — please login again', code: 'SESSION_EXPIRED' }); }
}
export const requireRole = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

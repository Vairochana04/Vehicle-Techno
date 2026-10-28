import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

// Real-time layer: every workflow event is published instantly to connected
// dashboards (bank / inspector / admin / seeker) — no refresh, no polling.
let wss = null;
const clients = new Map(); // ws -> {id, role}
export function attachRealtime(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    let user = null;
    try {
      const token = new URL(req.url, 'http://x').searchParams.get('token');
      user = jwt.verify(token, config.jwtSecret);
    } catch { /* anonymous: receives public market ticks only */ }
    clients.set(ws, { id: user?.id || null, role: user?.role || 'GUEST' });
    ws.send(JSON.stringify({ type: 'CONNECTED', role: user?.role || 'GUEST', at: new Date().toISOString() }));
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (buf) => { try { const m = JSON.parse(buf); if (m.type === 'PING') ws.send(JSON.stringify({ type: 'PONG', at: new Date().toISOString() })); } catch { /* ignore */ } });
  });
  // Simulated live market heartbeat (DeepSearch feed) every 20s — frontends animate ticks from this.
  setInterval(() => publish({ type: 'MARKET_TICK', at: new Date().toISOString() }), 20000).unref?.();
  return wss;
}
export function publish(event) {
  if (!wss) return 0;
  const msg = JSON.stringify({ ...event, at: event.at || new Date().toISOString() });
  let sent = 0;
  for (const [ws, meta] of clients) {
    if (event.roles && !event.roles.includes(meta.role)) continue;
    if (ws.readyState === 1) { ws.send(msg); sent++; }
  }
  return sent;
}
export const onlineCount = () => clients.size;

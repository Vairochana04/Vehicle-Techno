import http from 'node:http';
import app from './app.js';
import { config } from './config.js';
import { attachRealtime } from './realtime.js';
const server = http.createServer(app);
attachRealtime(server); // WebSocket live layer on /ws (same port — single-service deployment)
server.listen(config.port, '0.0.0.0', () => console.log(`\n✅ Valuation Techno STARTED!\n👉 Open this address in your browser: http://localhost:${config.port}\n   (Do not click the 0.0.0.0 address — it will not open in a browser)\n`));

// Backrooms: Bodycam game server: static files + authoritative multiplayer (WebSocket on /ws).
// Used by `npm start` (server.js) and by the desktop build (desktop/main.cjs).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameCore } from '../public/js/shared/core.js';

export const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

// Starts listening; resolves to { server, core, port, close() }. port 0 picks a free port.
export function startGameServer({ port = 3000, host = '0.0.0.0', bots = 5, difficulty = 1, fragLimit = 25, timeLimit = 600, mode = 'ffa', layout = 'maze', light = 'normal', log = console.log } = {}) {
  const core = new GameCore({ bots, difficulty, fragLimit, timeLimit, mode, layout, light });
  const server = http.createServer((req, res) => {
    let url;
    try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (url === '/info') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ port: server.address().port, lan: lanAddresses(), mode: core.mode, layout: core.layout, light: core.light,
        capacity: core.capacity, teamSlots: core.mode === 'tdm' && core.layout === 'arena' ? 5 : null,
        players: [...core.players.values()].filter((p) => !p.bot).length,
        bots: [...core.players.values()].filter((p) => p.bot).length, selectedBots: core.onlineBotCount,
        esc: core.escapeState() }));
      return;
    }
    const file = path.normalize(path.join(PUBLIC_DIR, url === '/' ? 'index.html' : url));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  const encoded = new WeakMap(); // broadcast messages are serialized once
  let nextId = 1;
  wss.on('connection', (ws) => {
    const id = 'p' + nextId++;
    core.join(id, (msg) => {
      if (ws.readyState !== 1) return;
      let s = encoded.get(msg);
      if (!s) { s = JSON.stringify(msg); encoded.set(msg, s); }
      ws.send(s);
    });
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      try { core.handle(id, msg); } catch (e) { log('bad message from', id, e.message); }
    });
    ws.on('close', () => core.leave(id));
  });

  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    try { core.tick(Math.min(0.1, (now - last) / 1000)); } catch (e) { log('tick error', e); }
    last = now;
  }, 1000 / 30);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({ server, core, port: actual, close: () => new Promise((r) => { clearInterval(timer); for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => r()); }) });
    });
  });
}

// Backrooms: Bodycam — static file server + authoritative multiplayer (WebSocket on /ws).
// Usage: npm start   (PORT=3000 BOTS=5 DIFF=1 FRAGS=25 TIME=600 MODE=ffa|tdm)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameCore } from './public/js/shared/core.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = +process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const core = new GameCore({ bots: process.env.BOTS ? +process.env.BOTS : 5, difficulty: process.env.DIFF ? +process.env.DIFF : 1, fragLimit: +process.env.FRAGS || 25, timeLimit: +process.env.TIME || 600, mode: process.env.MODE === 'tdm' ? 'tdm' : 'ffa' });
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
    try { core.handle(id, msg); } catch (e) { console.error('bad message from', id, e.message); }
  });
  ws.on('close', () => core.leave(id));
});

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  core.tick(Math.min(0.1, (now - last) / 1000));
  last = now;
}, 1000 / 30);

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Backrooms: Bodycam sunucusu hazır (${core.mode === 'tdm' ? 'takım çatışması' : 'herkes herkese'}) → http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Yerel ağdaki arkadaşların için: http://${ip}:${PORT}`);
});

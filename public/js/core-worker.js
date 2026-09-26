// Offline match: runs the authoritative GameCore off the main thread; messages are batched per tick.
import { GameCore } from './shared/core.js';

let core = null, out = [], timer = 0, last = 0, paused = false;
const flush = () => { if (out.length) { self.postMessage(out); out = []; } };

self.onmessage = (e) => {
  const m = e.data;
  if (m && m.t === '__init') {
    core = new GameCore(m.opts);
    core.join('me', (msg) => out.push(msg));
    last = performance.now();
    timer = setInterval(() => {
      const now = performance.now();
      if (!paused) core.tick(Math.min(0.1, (now - last) / 1000));
      last = now;
      flush();
    }, 1000 / 30);
    return;
  }
  if (m && m.t === '__stop') { clearInterval(timer); self.close(); return; }
  if (m && m.t === '__pause') { paused = !!m.on; return; }
  if (core) { core.handle('me', m); flush(); }
};

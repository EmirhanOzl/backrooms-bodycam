// Transport: WebSocket to the Node server, or an in-browser GameCore loopback for offline play.
import { GameCore } from './shared/core.js';

export class Net {
  constructor() { this.queue = []; this.closed = false; }

  static online(timeout = 2500) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(`${proto}://${location.host}/ws`); } catch (e) { reject(e); return; }
      const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, timeout);
      ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
      ws.onopen = () => {
        clearTimeout(timer);
        const n = new Net();
        n.ws = ws;
        ws.onmessage = (e) => { try { n.queue.push(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
        ws.onclose = () => { n.closed = true; };
        n.send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
        resolve(n);
      };
    });
  }

  static offline(opts) {
    const n = new Net();
    const core = new GameCore(opts);
    core.join('me', (m) => n.queue.push(m));
    n.send = (m) => core.handle('me', m);
    let last = performance.now();
    n.timer = setInterval(() => {
      const now = performance.now();
      core.tick(Math.min(0.1, (now - last) / 1000));
      last = now;
    }, 1000 / 30);
    n.core = core;
    return n;
  }

  poll() { const q = this.queue; this.queue = []; return q; }

  close() {
    if (this.ws) this.ws.close();
    clearInterval(this.timer);
    this.closed = true;
  }
}

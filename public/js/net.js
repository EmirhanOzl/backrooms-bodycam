// Transport: WebSocket to the Node server, or an offline GameCore (Web Worker, main-thread fallback).
import { GameCore } from './shared/core.js';

export class Net {
  constructor() { this.queue = []; this.closed = false; this.online = false; }

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
        n.online = true;
        n.ws = ws;
        ws.onmessage = (e) => { try { n.queue.push(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
        ws.onclose = () => { n.closed = true; };
        n.send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
        resolve(n);
      };
    });
  }

  // useWorker=false keeps the simulation on this thread (debugging / automated tests: net.core is reachable)
  static offline(opts, useWorker = true) {
    const n = new Net();
    if (useWorker) try {
      const w = new Worker(new URL('./core-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { for (const m of e.data) n.queue.push(m); };
      w.onerror = (e) => { console.error('offline core crashed', e); n.closed = true; };
      w.postMessage({ t: '__init', opts });
      n.send = (m) => w.postMessage(m);
      n.worker = w;
      return n;
    } catch (e) {
      console.warn('worker unavailable, simulating on the main thread', e);
    }
    const core = (n.core = new GameCore(opts));
    core.join('me', (m) => n.queue.push(m));
    n.send = (m) => core.handle('me', m);
    let last = performance.now();
    n.timer = setInterval(() => {
      const now = performance.now();
      core.tick(Math.min(0.1, (now - last) / 1000));
      last = now;
    }, 1000 / 30);
    return n;
  }

  poll() { const q = this.queue; this.queue = []; return q; }

  close() {
    if (this.ws) this.ws.close();
    if (this.worker) { this.worker.postMessage({ t: '__stop' }); this.worker.terminate(); }
    clearInterval(this.timer);
    this.closed = true;
  }
}

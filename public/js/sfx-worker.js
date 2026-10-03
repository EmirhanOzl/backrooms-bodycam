// Synthesizes a slice of the sound bank off the main thread (see sfx.js).
import { synthOne } from './sfx.js';

self.onmessage = (e) => {
  const { sr, items } = e.data;
  for (const [name, v] of items) {
    try {
      const out = synthOne(name, v, sr);
      const chs = Array.isArray(out) ? out : [out];
      self.postMessage({ name, v, chs }, chs.map((c) => c.buffer));
    } catch (e) {
      self.postMessage({ error: `Sound synthesis ${name}[${v}] at ${sr} Hz: ${e.message || e}` });
      return;
    }
  }
  self.postMessage({ done: true });
};

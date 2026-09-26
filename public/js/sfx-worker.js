// Synthesizes a slice of the sound bank off the main thread (see sfx.js).
import { synthOne } from './sfx.js';

self.onmessage = (e) => {
  const { sr, items } = e.data;
  for (const [name, v] of items) {
    const out = synthOne(name, v, sr);
    const chs = Array.isArray(out) ? out : [out];
    self.postMessage({ name, v, chs }, chs.map((c) => c.buffer));
  }
  self.postMessage({ done: true });
};

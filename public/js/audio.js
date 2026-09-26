// Sound engine: plays pre-synthesized buffers (sfx.js) through a small mixer.
//   voices ─┬─> sfx ─> duck ─┐
//           ├─> amb ──────────┼─> master ─> muffle(lowpass) ─> post ─> limiter ─> out
//           └─> ui  ──────────────────────────────────────────┘
//   reverb sends ─> convolver ─> sfx
// Every voice is one AudioBufferSourceNode + gain (+ panner / occlusion filter when needed),
// capped per category with oldest-voice stealing, so heavy firefights never overload the audio thread.
import { soundList, synthOne } from './sfx.js';

const CAPS = { fp: 10, gun: 14, imp: 10, step: 8, mech: 8, ui: 6, amb: 4, misc: 12, boom: 4 };
const LOUD = { pistol: 0.8, revolver: 1, smg: 0.72, shotgun: 1, rifle: 0.95, m4: 0.9, sniper: 1.05 };

export class Sound {
  constructor() {
    this.ctx = null;
    this.bank = {};
    this.ready = false;
    this.vol = { master: 0.8, sfx: 1, amb: 0.8, ui: 0.9 };
    this.hrtf = true;
    this.voices = {};
    this.lastVar = {};
  }

  // Creates the context (suspended until a user gesture on most browsers) and synthesizes the bank.
  async load(onProgress = () => {}) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('WebAudio unavailable');
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.buildGraph();
    const items = [];
    for (const [name, n] of soundList()) for (let v = 0; v < n; v++) items.push([name, v]);
    const total = items.length;
    let done = 0;
    const accept = (name, v, chs) => {
      const n = Math.max(...chs.map((c) => c.length));
      const b = ctx.createBuffer(chs.length, n, ctx.sampleRate);
      chs.forEach((c, i) => b.copyToChannel(c instanceof Float32Array ? c : new Float32Array(c), i));
      (this.bank[name] ||= [])[v] = b;
      onProgress(++done / total);
    };
    let workers = [];
    try {
      const nW = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
      workers = Array.from({ length: nW }, () => new Worker(new URL('./sfx-worker.js', import.meta.url), { type: 'module' }));
      await Promise.all(workers.map((wk, i) => new Promise((resolve, reject) => {
        wk.onmessage = (e) => { if (e.data.done) resolve(); else accept(e.data.name, e.data.v, e.data.chs); };
        wk.onerror = (e) => reject(e);
        wk.postMessage({ sr: ctx.sampleRate, items: items.filter((_, j) => j % nW === i) });
      })));
    } catch (e) {
      console.warn('sound worker unavailable, synthesizing on the main thread', e);
      for (const [name, v] of items) {
        if (this.bank[name]?.[v]) continue;
        const out = synthOne(name, v, ctx.sampleRate);
        accept(name, v, Array.isArray(out) ? out : [out]);
        if (done % 8 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    } finally { workers.forEach((w) => w.terminate()); }
    this.verb.buffer = this.bank.ir[0];
    this.ready = true;
    this.startHum();
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }
  now() { return this.ctx ? this.ctx.currentTime : 0; }

  buildGraph() {
    const ctx = this.ctx;
    const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    this.limiter = ctx.createDynamicsCompressor();
    Object.entries({ threshold: -4, knee: 2, ratio: 16, attack: 0.001, release: 0.12 }).forEach(([k, v]) => { this.limiter[k].value = v; });
    this.limiter.connect(ctx.destination);
    this.post = G(1); this.post.connect(this.limiter);
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
    this.muffle.connect(this.post);
    this.master = G(this.vol.master); this.master.connect(this.muffle);
    this.duck = G(1); this.duck.connect(this.master);
    this.sfx = G(this.vol.sfx); this.sfx.connect(this.duck);
    this.amb = G(this.vol.amb); this.amb.connect(this.master);
    this.uiOut = G(this.vol.master); this.uiOut.connect(this.post);
    this.uiBus = G(this.vol.ui); this.uiBus.connect(this.uiOut);
    this.verbIn = G(1);
    this.verb = ctx.createConvolver();
    this.verbOut = G(0.55);
    this.verbIn.connect(this.verb).connect(this.verbOut).connect(this.sfx);
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.02);
    this.uiOut.gain.setTargetAtTime(this.vol.master, t, 0.02);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.02);
    this.amb.gain.setTargetAtTime(this.vol.amb, t, 0.02);
    this.uiBus.gain.setTargetAtTime(this.vol.ui, t, 0.02);
  }

  listener(p, f, u) {
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t); L.forwardY.setValueAtTime(f.y, t); L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(u.x, t); L.upY.setValueAtTime(u.y, t); L.upZ.setValueAtTime(u.z, t);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }

  // ------------------------------------------------------------------ voices
  // o: { cat, vol, rate, jitter, pos, ref, rolloff, occl, verb, lp, when, bus, v }
  play(name, o = {}) {
    if (!this.ready) return null;
    const list = this.bank[name];
    if (!list) return null;
    const ctx = this.ctx;
    // avoid repeating the same variant twice in a row
    let vi = o.v ?? ((Math.random() * list.length) | 0);
    if (o.v == null && list.length > 1 && vi === this.lastVar[name]) vi = (vi + 1) % list.length;
    this.lastVar[name] = vi;
    const when = Math.max(ctx.currentTime, o.when || 0);
    const cat = o.cat || 'misc';
    const vs = (this.voices[cat] ||= []);
    if (vs.length >= (CAPS[cat] || 8)) {
      const old = vs.shift();
      try { old.g.gain.setTargetAtTime(0, ctx.currentTime, 0.008); old.src.stop(ctx.currentTime + 0.05); } catch { /* already stopped */ }
    }
    const src = ctx.createBufferSource();
    src.buffer = list[vi];
    const j = o.jitter ?? 0.03;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * j);
    const g = ctx.createGain();
    g.gain.value = (o.vol ?? 1) * (o.occl ? 0.5 : 1);
    src.connect(g);
    let head = g;
    const lpF = o.occl ? Math.min(o.lp || 20000, 750) : o.lp;
    if (lpF && lpF < 18000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lpF; f.Q.value = 0.5; head.connect(f); head = f; }
    if (o.pos) {
      const p = ctx.createPanner();
      p.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse'; p.refDistance = o.ref ?? 2; p.rolloffFactor = o.rolloff ?? 1.1; p.maxDistance = 120;
      if (p.positionX) { p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z; }
      else p.setPosition(o.pos.x, o.pos.y, o.pos.z);
      head.connect(p); head = p;
    }
    head.connect(o.bus || this.sfx);
    const vg = (o.verb ?? 0) * (o.occl ? 1.6 : 1);
    if (vg > 0) { const s = ctx.createGain(); s.gain.value = vg; head.connect(s).connect(this.verbIn); }
    const voice = { src, g };
    vs.push(voice);
    src.onended = () => { const i = vs.indexOf(voice); if (i >= 0) vs.splice(i, 1); head.disconnect(); };
    src.start(when);
    return voice;
  }

  // ------------------------------------------------------------------ semantic helpers
  shot(type, { fp = false, pos = null, dist = 0, occl = false, when = 0 } = {}) {
    const L = LOUD[type] || 0.9;
    if (fp) { this.play('fp_' + type, { cat: 'fp', vol: L * 0.9, verb: 0.5, when, jitter: 0.02 }); return; }
    const far = dist > 30;
    this.play((far ? 'fr_' : 'np_') + type, {
      cat: 'gun', pos, vol: L * (far ? 1.5 : 1.1), ref: far ? 16 : 5, rolloff: far ? 0.8 : 1.05, occl, when, jitter: 0.03,
      verb: far ? 0.2 : 0.65, lp: !far && dist > 12 ? 16000 / (1 + (dist - 12) / 9) : 0,
    });
  }
  impact(kind, pos, dist = 5, occl = false) {
    if (dist > 45) return;
    const name = { player: 'im_flesh', head: 'im_head', plate: 'im_plate', wall: 'im_wall', floor: 'im_floor', ceil: 'im_ceil' }[kind] || 'im_wall';
    this.play(name, { cat: 'imp', pos, vol: kind === 'player' || kind === 'head' ? 0.75 : 0.5, ref: 2.5, occl, verb: 0.25 });
  }
  whiz(pos, k, when) { this.play('whiz', { cat: 'imp', pos, vol: 0.35 + 0.6 * k, ref: 1.5, when, verb: 0.05 }); }
  step(pos, { run = false, vol = 0.3, occl = false } = {}) {
    this.play(run ? 'st_run' : 'st_walk', { cat: 'step', pos, vol, ref: 1.6, rolloff: 1.3, occl, verb: 0.08, jitter: 0.06 });
  }
  mech(name, vol = 0.5, pos = null, when = 0) { return this.play(name, { cat: 'mech', vol, pos, ref: 1.5, verb: pos ? 0.2 : 0.12, when, jitter: 0.03 }); }
  ui(name, vol = 0.5, when = 0) { return this.play(name, { cat: 'ui', vol, bus: this.uiBus, when, jitter: 0 }); }

  explosion(pos, dist, occl) {
    const near = dist < 32;
    this.play(near ? 'gr_boom' : 'gr_far', { cat: 'boom', pos, vol: near ? 1.4 : 1.2, ref: near ? 7 : 20, rolloff: 0.9, occl, verb: 0.9, jitter: 0.02 });
    if (dist < 9 && !occl) {
      // the blast itself is heard at full level; the ears shut down right after it
      const k = 1 - dist / 9;
      this.deafen(600 + (1 - k) * 2500, 1.2 + k * 2.5, 0.07);
      this.duckSfx(1 - k * 0.7, 2 + k * 2, 0.09);
      if (k > 0.35) this.tinnitus(1.5 + k * 3, 0.045 * k, 0.1);
    }
  }

  hurt(zone = 'b', dmg = 20) {
    if (!this.ready) return;
    this.ui(zone === 'h' ? 'hurt_head' : 'hurt', 0.55 + Math.min(0.4, dmg / 80));
    this.deafen(zone === 'h' ? 700 : Math.max(1500, 5000 - dmg * 80), zone === 'h' ? 2.2 : 0.7);
    if (zone === 'h') this.tinnitus(2.6, 0.05);
  }

  deafen(freq, sec, delay = 0) {
    if (!this.ctx) return;
    const f = this.muffle.frequency, now = this.ctx.currentTime, t = now + delay, v = Math.max(20, f.value);
    const target = Math.min(v, freq);
    f.cancelScheduledValues(now); f.setValueAtTime(v, now);
    if (delay > 0) f.setValueAtTime(v, t);
    f.exponentialRampToValueAtTime(target, t + 0.03); f.exponentialRampToValueAtTime(20000, t + 0.03 + sec);
  }
  duckSfx(level, sec, delay = 0) {
    if (!this.ctx) return;
    const g = this.duck.gain, now = this.ctx.currentTime, t = now + delay, v = g.value;
    g.cancelScheduledValues(now); g.setValueAtTime(v, now);
    if (delay > 0) g.setValueAtTime(v, t);
    g.linearRampToValueAtTime(Math.min(v, level), t + 0.04); g.linearRampToValueAtTime(1, t + 0.04 + sec);
  }
  tinnitus(sec, vol, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.frequency.value = 3800 + Math.random() * 500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * this.vol.master, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
    o.connect(g).connect(this.post); o.start(t); o.stop(t + sec + 0.05);
  }

  // ------------------------------------------------------------------ ambience (live, few nodes)
  startHum() {
    if (this.humG) return;
    const ctx = this.ctx, g = (this.humG = ctx.createGain());
    g.gain.value = 0.9;
    g.connect(this.amb);
    const mk = (type, f, filt, ff, q, v) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const flt = ctx.createBiquadFilter(); flt.type = filt; flt.frequency.value = ff; flt.Q.value = q;
      const gg = ctx.createGain(); gg.gain.value = v;
      o.connect(flt).connect(gg).connect(g); o.start();
      return gg;
    };
    const saw = mk('sawtooth', 120, 'bandpass', 360, 2, 0.022);
    mk('sine', 60, 'lowpass', 200, 0.7, 0.03);
    mk('square', 240, 'lowpass', 900, 0.7, 0.006);
    // faint ballast hiss
    const hiss = ctx.createBufferSource();
    const nb =ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    hiss.buffer = nb; hiss.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
    const hg = ctx.createGain(); hg.gain.value = 0.005;
    hiss.connect(hp).connect(hg).connect(g); hiss.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 0.008;
    lfo.connect(lg).connect(saw.gain); lfo.start();
    // flickering-troffer buzz (positional, follows the nearest flickering light)
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 240;
    const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 1900; bpf.Q.value = 0.7;
    this.buzzG = ctx.createGain(); this.buzzG.gain.value = 0;
    this.buzzP = ctx.createPanner();
    Object.assign(this.buzzP, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 1.5, rolloffFactor: 1.4 });
    const g2 = ctx.createGain(); g2.gain.value = 0.3;
    o.connect(bpf); o2.connect(g2).connect(bpf);
    bpf.connect(this.buzzG).connect(this.buzzP).connect(this.amb);
    o.start(); o2.start();
  }
  setHum(level) { if (this.humG) this.humG.gain.setTargetAtTime(level, this.ctx.currentTime, 0.3); }
  buzz(pos, level) {
    if (!this.buzzG) return;
    const t = this.ctx.currentTime;
    if (pos) { const P = this.buzzP; if (P.positionX) { P.positionX.setValueAtTime(pos.x, t); P.positionY.setValueAtTime(pos.y, t); P.positionZ.setValueAtTime(pos.z, t); } }
    this.buzzG.gain.setTargetAtTime(pos ? 0.05 * level * (0.8 + Math.random() * 0.4) : 0, t, 0.015);
  }
  distant(pos) {
    const pick = ['amb_thud', 'amb_creak', 'amb_steps', 'amb_knock', 'amb_drone', 'amb_pop', 'amb_scream'];
    const w = [3, 3, 3, 2, 2, 2, 0.6];
    let x = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    while ((x -= w[i]) > 0) i++;
    this.play(pick[i], { cat: 'amb', pos, vol: 0.9, ref: 8, rolloff: 0.6, bus: this.amb, verb: 0.3 });
  }
}

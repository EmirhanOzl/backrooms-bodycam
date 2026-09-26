// Fully synthesized audio (WebAudio): fluorescent hum, layered gunshots with room reflections,
// wall occlusion, bullet impacts / whizzes, 3D footsteps, hit feedback, tinnitus, level ambience.
const SHOT = {
  pistol: { len: 0.2, lp0: 9000, lp1: 1300, thump: 0.7, gain: 0.9, crack: 0.55, mech: 3600 },
  smg: { len: 0.15, lp0: 7000, lp1: 1100, thump: 0.55, gain: 0.75, crack: 0.4, mech: 4200 },
  shotgun: { len: 0.45, lp0: 6000, lp1: 450, thump: 1.4, gain: 1.2, crack: 0.25, mech: 0 },
  rifle: { len: 0.3, lp0: 11000, lp1: 1500, thump: 1.0, gain: 1.05, crack: 0.85, mech: 2800 },
};

export class Sound {
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain(); this.master.gain.value = this.volume ?? 0.8;
    // muffle filter: head hits / heavy damage briefly deafen the player
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.15;
    this.master.connect(this.muffle).connect(comp).connect(ctx.destination);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.45;
    try {
      this.verb = ctx.createConvolver(); this.verb.buffer = this.ir(1.5, 2.6);
      this.verbIn.connect(this.verb).connect(this.master);
    } catch { /* some devices reject custom IR buffers: play dry */ }
    // early reflections of a low-ceiling office maze
    this.room = ctx.createGain(); this.room.gain.value = 1;
    for (const [dl, g] of [[0.009, 0.32], [0.017, 0.24], [0.029, 0.18], [0.043, 0.1]]) {
      const d = ctx.createDelay(0.1); d.delayTime.value = dl;
      const gg = ctx.createGain(); gg.gain.value = g;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
      this.room.connect(d).connect(lp).connect(gg).connect(this.master);
    }
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    this.hum();
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  ir(dur, decay) {
    const ctx = this.ctx, n = (ctx.sampleRate * dur) | 0, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 200 ? i / 200 : 1); }
    return b;
  }
  hum() {
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.value = 0.9;
    g.connect(this.master);
    const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 120;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 360; bp.Q.value = 2;
    const sg = ctx.createGain(); sg.gain.value = 0.022;
    saw.connect(bp).connect(sg).connect(g);
    const sine = ctx.createOscillator(); sine.frequency.value = 60;
    const s2 = ctx.createGain(); s2.gain.value = 0.03;
    sine.connect(s2).connect(g);
    const h3 = ctx.createOscillator(); h3.type = 'square'; h3.frequency.value = 240;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const s3 = ctx.createGain(); s3.gain.value = 0.006;
    h3.connect(lp).connect(s3).connect(g);
    const hiss = ctx.createBufferSource(); hiss.buffer = this.noiseBuf; hiss.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
    const s4 = ctx.createGain(); s4.gain.value = 0.006;
    hiss.connect(hp).connect(s4).connect(g);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 0.008;
    lfo.connect(lg).connect(sg.gain);
    [saw, sine, h3, hiss, lfo].forEach((o) => o.start());
  }
  // routing: positional or direct; occluded sources lose highs and level, gain more reverb
  out(pos, gain = 1, verb = 1, occluded = false, room = 0) {
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.value = gain * (occluded ? 0.5 : 1);
    let head = g;
    if (occluded) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; g.connect(lp); head = lp; }
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 2.5; p.rolloffFactor = 1.1; p.maxDistance = 100;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      head.connect(p); p.connect(this.master);
    } else head.connect(this.master);
    const vg = verb * (occluded ? 1.8 : 1);
    if (vg) { const v = ctx.createGain(); v.gain.value = vg; g.connect(v).connect(this.verbIn); }
    if (room) { const r = ctx.createGain(); r.gain.value = room; g.connect(r).connect(this.room); }
    return g;
  }
  noise(dur, when = 0) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    s.start(this.ctx.currentTime + when, Math.random() * 0.5, dur + 0.05);
    return s;
  }
  env(g, t, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    return g;
  }
  filt(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  listener(p, f) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }

  // ---------------------------------------------------------------- weapons
  shot(type, pos = null, dist = 0, occluded = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, P = SHOT[type] || SHOT.pistol;
    const far = Math.min(1, dist / 40);
    const out = this.out(pos, P.gain * (pos ? 1.6 : 1), 1 + far, occluded, pos ? 0.6 : 1);
    const lpDist = this.filt('lowpass', 14000 / (1 + dist / 6)); lpDist.connect(out);
    // body: filtered noise burst
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(P.lp0, t); lp.frequency.exponentialRampToValueAtTime(P.lp1, t + P.len);
    this.noise(P.len).connect(lp).connect(this.env(ctx.createGain(), t, 1, 0.002, P.len)).connect(lpDist);
    // low thump (felt more than heard)
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const og = ctx.createGain(); og.gain.setValueAtTime(P.thump, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(og).connect(lpDist); o.start(t); o.stop(t + 0.22);
    // supersonic crack
    if (P.crack && dist < 30 && !occluded) {
      this.noise(0.02).connect(this.filt('highpass', 3000)).connect(this.env(ctx.createGain(), t, P.crack, 0.001, 0.03)).connect(lpDist);
    }
    if (!pos) {
      // action cycling + brass hitting the carpet
      if (P.mech) this.clank(0.025, P.mech, 0.16, 0.035);
      if (type !== 'shotgun') this.clank(0.42 + Math.random() * 0.15, 5200, 0.05, 0.03);
    }
  }
  impact(kind, pos, dist = 5) {
    if (!this.ctx || dist > 40) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this.out(pos, 0.9, 0.35);
    if (kind === 'player') {
      this.noise(0.07).connect(this.filt('lowpass', 700)).connect(this.env(ctx.createGain(), t, 0.9, 0.002, 0.08)).connect(out);
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.08);
      o.connect(this.env(ctx.createGain(), t, 0.7, 0.002, 0.1)).connect(out); o.start(t); o.stop(t + 0.12);
    } else if (kind === 'wall') {
      this.noise(0.06).connect(this.filt('bandpass', 1400, 0.9)).connect(this.env(ctx.createGain(), t, 0.7, 0.001, 0.06)).connect(out);
      this.noise(0.12).connect(this.filt('highpass', 4000)).connect(this.env(ctx.createGain(), t + 0.01, 0.12, 0.004, 0.14)).connect(out); // drywall grit
    } else if (kind === 'floor') {
      this.noise(0.05).connect(this.filt('lowpass', 500)).connect(this.env(ctx.createGain(), t, 0.8, 0.002, 0.05)).connect(out);
    } else {
      this.noise(0.1).connect(this.filt('bandpass', 2600, 1.5)).connect(this.env(ctx.createGain(), t, 0.45, 0.001, 0.1)).connect(out);
      this.noise(0.3).connect(this.filt('highpass', 3000)).connect(this.env(ctx.createGain(), t + 0.05, 0.08, 0.02, 0.3)).connect(out); // tile debris
    }
  }
  whiz(pos, k) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(5200, t); bp.frequency.exponentialRampToValueAtTime(1500, t + 0.16);
    this.noise(0.18).connect(bp).connect(this.env(ctx.createGain(), t, 0.25 + 0.6 * k, 0.01, 0.17)).connect(this.out(pos, 1.5, 0.1));
    this.noise(0.015).connect(this.filt('highpass', 5000)).connect(this.env(ctx.createGain(), t, 0.4 * k, 0.001, 0.02)).connect(this.out(pos, 1.5, 0));
  }
  step(pos, vol = 0.25, run = false, occluded = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const bp = this.filt('bandpass', 240 + Math.random() * 140, 0.9);
    this.noise(0.1).connect(bp).connect(this.env(ctx.createGain(), t, vol * (run ? 1.4 : 1), 0.012, 0.09)).connect(this.out(pos, pos ? 2.2 : 1, 0.15, occluded));
    if (Math.random() < 0.35) { // damp carpet squelch
      this.noise(0.08).connect(this.filt('bandpass', 1800, 3)).connect(this.env(ctx.createGain(), t + 0.02, vol * 0.12, 0.01, 0.1)).connect(this.out(pos, pos ? 2 : 1, 0, occluded));
    }
  }
  gear(vol = 0.3) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.noise(0.12).connect(this.filt('bandpass', 3000 + Math.random() * 1500, 0.8)).connect(this.env(ctx.createGain(), t, 0.05 * vol, 0.03, 0.12)).connect(this.out(null, 1, 0));
    if (Math.random() < 0.5) this.clank(0.02 + Math.random() * 0.05, 5500 + Math.random() * 2500, 0.05 * vol, 0.03);
  }
  tick(freq, vol, when = 0, dur = 0.03, type = 'square') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.out(null, 1, 0.2)); o.start(t); o.stop(t + dur + 0.02);
  }
  clank(when, freq = 2500, vol = 0.35, dur = 0.05) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    s.connect(this.filt('bandpass', freq, 4)).connect(this.env(ctx.createGain(), t, vol, 0.003, dur)).connect(this.out(null, 1, 0.3));
    s.start(t, Math.random() * 0.5, dur + 0.05);
  }
  reload(type, dur) {
    if (type === 'shotgun') {
      for (let i = 0; i < 4; i++) this.clank(0.25 + i * (dur - 0.7) / 4, 1800, 0.3, 0.06);
      this.pump(dur - 0.35);
      return;
    }
    this.clank(0.12, 1500, 0.35, 0.07);            // mag release
    this.gear(0.8);
    this.clank(dur * 0.55, 1100, 0.45, 0.08);      // mag seat
    this.clank(dur * 0.58, 3200, 0.25, 0.03);
    this.clank(dur * 0.82, 2200, 0.4, 0.06);       // charging handle / slide
    this.clank(dur * 0.88, 3000, 0.35, 0.05);
  }
  pump(when = 0.12) { this.clank(when, 900, 0.4, 0.09); this.clank(when + 0.16, 1300, 0.45, 0.08); this.clank(when + 0.5, 5000, 0.06, 0.03); }
  dry() { this.clank(0, 4000, 0.25, 0.025); }

  // ---------------------------------------------------------------- feedback
  hit(kill, zone, plate) {
    if (!this.ctx) return;
    if (zone === 'h') { this.tick(3300, 0.16, 0, 0.09, 'sine'); this.tick(4900, 0.08, 0, 0.12, 'sine'); this.clank(0, 6000, 0.2, 0.03); }
    else if (plate) { this.clank(0, 900, 0.3, 0.06); this.tick(1500, 0.07, 0, 0.15, 'sine'); }
    else this.tick(zone === 'l' ? 1500 : 1900, 0.15, 0, 0.05, 'sine');
    if (kill) { this.tick(1100, 0.2, 0.07, 0.12, 'triangle'); this.tick(1650, 0.17, 0.14, 0.2, 'triangle'); this.tick(70, 0.3, 0.05, 0.25, 'sine'); }
  }
  hurt(zone = 'b', dmg = 20) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    o.connect(this.env(ctx.createGain(), t, 0.7, 0.002, 0.25)).connect(this.out(null, 1, 0)); o.start(t); o.stop(t + 0.3);
    this.noise(0.08).connect(this.filt('lowpass', 800)).connect(this.env(ctx.createGain(), t, 0.5, 0.002, 0.08)).connect(this.out(null, 1, 0));
    const f = this.muffle.frequency;
    const deaf = zone === 'h' ? 700 : Math.max(1500, 5000 - dmg * 80);
    f.cancelScheduledValues(t); f.setValueAtTime(deaf, t); f.exponentialRampToValueAtTime(20000, t + (zone === 'h' ? 2.2 : 0.7));
    if (zone === 'h') { // tinnitus
      const r = ctx.createOscillator(); r.frequency.value = 3900 + Math.random() * 300;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      r.connect(g).connect(ctx.destination); r.start(t); r.stop(t + 2.7);
    }
  }
  beat() { this.tick(55, 0.5, 0, 0.12, 'sine'); this.tick(50, 0.35, 0.18, 0.12, 'sine'); }
  crate(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(500, t); bp.frequency.linearRampToValueAtTime(1300, t + 0.35);
    const g = this.env(ctx.createGain(), t, 0.5, 0.05, 0.4);
    const am = ctx.createOscillator(); am.frequency.value = 38; const ag = ctx.createGain(); ag.gain.value = 0.4;
    am.connect(ag).connect(g.gain); am.start(t); am.stop(t + 0.45);
    this.noise(0.4).connect(bp).connect(g).connect(this.out(pos, pos ? 2 : 1, 0.4));
    this.clank(0.38, 380, 0.5, 0.12);
  }
  pickup() { this.clank(0, 2600, 0.3, 0.04); this.clank(0.07, 1900, 0.3, 0.05); this.gear(0.6); }
  deploy() { this.clank(0, 1400, 0.25, 0.05); this.clank(0.12, 2600, 0.2, 0.04); }
  toggle() { this.tick(3000, 0.12, 0, 0.02); }

  // ---------------------------------------------------------------- ambience
  // persistent electrical buzz at the nearest flickering troffer
  buzz(pos, level) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.buzzG) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 240;
      const bp = this.filt('bandpass', 1900, 0.7);
      this.buzzG = ctx.createGain(); this.buzzG.gain.value = 0;
      this.buzzP = ctx.createPanner();
      Object.assign(this.buzzP, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 1.5, rolloffFactor: 1.4 });
      const g2 = ctx.createGain(); g2.gain.value = 0.3;
      o.connect(bp); o2.connect(g2).connect(bp);
      bp.connect(this.buzzG).connect(this.buzzP).connect(this.master);
      o.start(); o2.start();
    }
    const t = ctx.currentTime;
    if (pos) { this.buzzP.positionX.value = pos.x; this.buzzP.positionY.value = pos.y; this.buzzP.positionZ.value = pos.z; }
    const target = pos ? 0.05 * level * (0.8 + Math.random() * 0.4) : 0;
    this.buzzG.gain.setTargetAtTime(target, t, 0.015);
  }
  // unsettling far-away sounds: heavy thud, creak, or a few muffled footsteps
  distant(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, r = Math.random();
    const out = this.out(pos, 2.5, 2.2, true);
    if (r < 0.35) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.5);
      o.connect(this.env(ctx.createGain(), t, 0.8, 0.01, 0.6)).connect(out); o.start(t); o.stop(t + 0.7);
      this.noise(0.4).connect(this.filt('lowpass', 300)).connect(this.env(ctx.createGain(), t, 0.6, 0.005, 0.4)).connect(out);
    } else if (r < 0.7) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 8;
      bp.frequency.setValueAtTime(320, t); bp.frequency.linearRampToValueAtTime(520, t + 1.1);
      const g = this.env(ctx.createGain(), t, 0.5, 0.2, 1.2);
      const am = ctx.createOscillator(); am.frequency.value = 14; const ag = ctx.createGain(); ag.gain.value = 0.35;
      am.connect(ag).connect(g.gain); am.start(t); am.stop(t + 1.3);
      this.noise(1.2).connect(bp).connect(g).connect(out);
    } else {
      for (let i = 0; i < 4; i++) {
        this.noise(0.1, i * 0.42).connect(this.filt('bandpass', 260, 0.9)).connect(this.env(ctx.createGain(), t + i * 0.42, 0.5, 0.012, 0.09)).connect(out);
      }
    }
  }
}

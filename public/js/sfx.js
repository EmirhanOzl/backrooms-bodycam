// Offline sound design: every sound effect is synthesized once (pure JS DSP, no WebAudio) into
// sample buffers at load time, normally inside a Web Worker. Playing a sound in-game is then just
// one AudioBufferSourceNode, which keeps the audio thread light even during full-auto firefights.
//
// synthBank(sampleRate) -> { name: [variant, ...] } where a variant is a Float32Array (mono)
// or [Float32Array, Float32Array] (stereo).

let SR = 48000;
let rnd = Math.random;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const rr = (a, b) => a + (b - a) * rnd();

// ------------------------------------------------------------------ primitives
const len = (sec) => Math.max(1, Math.ceil(sec * SR));
const mk = (sec) => new Float32Array(len(sec));

function noise(sec) { const x = mk(sec); for (let i = 0; i < x.length; i++) x[i] = rnd() * 2 - 1; return x; }

// attack/decay envelope applied in place: linear attack, exponential decay (time constant d)
function env(x, a, d, hold = 0) {
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] *= t < a ? t / a : t < a + hold ? 1 : Math.exp(-(t - a - hold) / d);
  }
  return x;
}
// raised-sine window (for whooshes / breaths): peaks at `peak` fraction of the length
function bell(x, peak = 0.5, pow = 2) {
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const u = i / n, k = u < peak ? u / peak : 1 - (u - peak) / (1 - peak);
    x[i] *= Math.pow(Math.sin(k * Math.PI / 2), pow);
  }
  return x;
}

// RBJ biquad; f may be a function of time (seconds), re-evaluated every 32 samples
function biquad(x, type, f, q = 0.707, gainDb = 0) {
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const set = (fr) => {
    fr = Math.max(10, Math.min(fr, SR * 0.45));
    const w = 2 * Math.PI * fr / SR, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
    let B0, B1, B2, A0, A1, A2;
    if (type === 'lp') { B0 = (1 - cs) / 2; B1 = 1 - cs; B2 = B0; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; }
    else if (type === 'hp') { B0 = (1 + cs) / 2; B1 = -(1 + cs); B2 = B0; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; }
    else if (type === 'bp') { B0 = al; B1 = 0; B2 = -al; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; }
    else { const A = Math.pow(10, gainDb / 40); B0 = 1 + al * A; B1 = -2 * cs; B2 = 1 - al * A; A0 = 1 + al / A; A1 = -2 * cs; A2 = 1 - al / A; }
    b0 = B0 / A0; b1 = B1 / A0; b2 = B2 / A0; a1 = A1 / A0; a2 = A2 / A0;
  };
  const dyn = typeof f === 'function';
  if (!dyn) set(f);
  for (let i = 0; i < x.length; i++) {
    if (dyn && (i & 31) === 0) set(f(i / SR));
    const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}
const lp = (x, f, q) => biquad(x, 'lp', f, q);
const hp = (x, f, q) => biquad(x, 'hp', f, q);
const bp = (x, f, q) => biquad(x, 'bp', f, q);
const expSweep = (f0, f1, tau) => (t) => f1 + (f0 - f1) * Math.exp(-t / tau);

// sine (optionally swept) oscillator with its own envelope
function tone(sec, f0, f1 = f0, tau = 0.05, a = 0.001, d = 0.1, shape = 'sine') {
  const x = mk(sec);
  let ph = rnd() * 0.2;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, f = f1 + (f0 - f1) * Math.exp(-t / tau);
    ph += f / SR;
    const s = Math.sin(2 * Math.PI * ph);
    x[i] = (shape === 'tri' ? Math.asin(s) * 0.64 : shape === 'soft' ? Math.tanh(s * 2.5) : s) * (t < a ? t / a : Math.exp(-(t - a) / d));
  }
  return x;
}
// inharmonic metal: [[freq, amp, decay], ...]
function partials(sec, list, a = 0.0004) {
  const x = mk(sec);
  for (const [f, amp, d] of list) {
    const ph = rnd() * 6.28, fr = f * rr(0.985, 1.015), w = 2 * Math.PI * fr / SR;
    for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] += amp * Math.sin(w * i + ph) * (t < a ? t / a : Math.exp(-(t - a) / d)); }
  }
  return x;
}
function add(dst, src, at = 0, g = 1) {
  const o = Math.round(at * SR), n = Math.min(src.length, dst.length - o);
  for (let i = 0; i < n; i++) dst[o + i] += src[i] * g;
  return dst;
}
function gain(x, g) { for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
function drive(x, k) { const n = Math.tanh(k); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * k) / n; return x; }
function peakOf(x) { let p = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > p) p = v; } return p; }
function norm(x, peak = 0.95) { const p = peakOf(x); return p > 1e-9 ? gain(x, peak / p) : x; }
function fadeOut(x, sec = 0.01) { const n = Math.min(x.length, len(sec)); for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n; return x; }
function trim(x, floor = 0.0004) { let e = x.length - 1; while (e > 64 && Math.abs(x[e]) < floor) e--; return fadeOut(x.slice(0, Math.min(x.length, e + len(0.01))), 0.006); }
// short pressure pulse: positive half sine then a longer negative lobe (muzzle blast "punch")
function pulse(T, amp = 1) {
  const x = mk(T * 3.2), n1 = len(T);
  for (let i = 0; i < x.length; i++) x[i] = i < n1 ? amp * Math.sin(Math.PI * i / n1) : -0.35 * amp * Math.sin(Math.PI * (i - n1) / (2.2 * n1)) * (i < n1 * 3.2 ? 1 : 0);
  return x;
}
// supersonic N-wave
function nwave(T, amp = 1) { const n = len(T), x = mk(T * 1.2); for (let i = 0; i < n; i++) x[i] = amp * (1 - 2 * i / n); return x; }
function click(f, amp = 1, dec = 0.008, q = 3) {
  const x = noise(dec * 7);
  env(x, 0.0001, dec * 0.45);
  bp(x, f, q);
  gain(x, 3);
  add(x, partials(dec * 7, [[f * 0.71, 0.35, dec], [f * 1.33, 0.25, dec * 0.8], [f * 2.07, 0.15, dec * 0.6]]));
  return gain(x, amp);
}
function burst(sec, type, f, q, a, d, amp = 1) { const x = noise(sec); env(x, a, d); biquad(x, type, f, q); return gain(x, amp); }

// early reflections of the low carpeted office corridors (mono in, stereo out)
const TAPS_L = [[0.0049, 0.55], [0.0118, 0.42], [0.0191, 0.33], [0.0273, 0.26], [0.0386, 0.19], [0.0532, 0.13], [0.0741, 0.08]];
const TAPS_R = [[0.0063, 0.5], [0.0097, 0.4], [0.0224, 0.32], [0.0301, 0.24], [0.0417, 0.17], [0.0588, 0.12], [0.0802, 0.07]];
function reflect(x, amt = 1, lpF = 3200, extra = 0.1) {
  const f = lp(x.slice(), lpF, 0.6);
  const outL = new Float32Array(x.length + len(extra)), outR = new Float32Array(outL.length);
  add(outL, x); add(outR, x);
  for (const [t, g] of TAPS_L) add(outL, f, t, g * amt);
  for (const [t, g] of TAPS_R) add(outR, f, t, g * amt);
  return [outL, outR];
}
const mono = ([l, r]) => { const x = new Float32Array(l.length); for (let i = 0; i < l.length; i++) x[i] = (l[i] + r[i]) * 0.5; return x; };

// small Freeverb-style reverb (mono in, stereo out) for baked distant tails
function reverb(x, { room = 0.84, damp = 0.35, wet = 0.5, dry = 1, tail = 1.2 } = {}) {
  const n = x.length + len(tail), sc = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], aps = [556, 441, 341, 225];
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) {
    const o = out[c], spread = c * 23;
    for (const L of combs) {
      const D = Math.round((L + spread) * sc), buf = new Float32Array(D);
      let idx = 0, store = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[idx];
        store = y * (1 - damp) + store * damp;
        buf[idx] = (i < x.length ? x[i] * 0.015 : 0) + store * room;
        if (++idx >= D) idx = 0;
        o[i] += y;
      }
    }
    for (const L of aps) {
      const D = Math.round((L + spread) * sc), buf = new Float32Array(D);
      let idx = 0;
      for (let i = 0; i < n; i++) { const b = buf[idx], v = o[i]; o[i] = -v + b; buf[idx] = v + b * 0.5; if (++idx >= D) idx = 0; }
    }
    for (let i = 0; i < n; i++) o[i] = o[i] * wet + (i < x.length ? x[i] * dry : 0);
  }
  return out;
}

// ------------------------------------------------------------------ firearms
// imp: muzzle blast impulse, pT: pressure pulse width scale, crack: supersonic crack (heard downrange)
// body*: filtered-noise blast, mid*: resonant body, boom*: low thump, ring: metal, mech: action cycling (first person)
const GUNS = {
  pistol: { len: 0.5, imp: 0.8, pT: 1, crack: 0.35, bodyF: [7200, 1400], bodyT: 0.034, bodyTau: 0.03, midF: 720, midQ: 1.4, midA: 0.55, midT: 0.03, boomF: [170, 58], boomA: 0.55, boomT: 0.055, boomTau: 0.03, drive: 2.6, ring: [[2900, 0.05, 0.02]], mech: [[0.014, 3300, 0.32], [0.034, 2500, 0.26]] },
  revolver: { len: 0.7, imp: 1.0, pT: 1.3, crack: 0.65, bodyF: [6500, 1000], bodyT: 0.06, bodyTau: 0.05, midF: 520, midQ: 1.3, midA: 0.75, midT: 0.06, boomF: [140, 44], boomA: 0.95, boomT: 0.1, boomTau: 0.04, drive: 3.2, ring: [[1850, 0.09, 0.07], [3150, 0.05, 0.045]], mech: [[0.03, 4100, 0.14]] },
  smg: { len: 0.42, imp: 0.65, pT: 0.9, crack: 0.3, bodyF: [6200, 1500], bodyT: 0.027, bodyTau: 0.025, midF: 950, midQ: 1.5, midA: 0.42, midT: 0.02, boomF: [155, 62], boomA: 0.45, boomT: 0.045, boomTau: 0.025, drive: 2.1, ring: null, mech: [[0.011, 3900, 0.22], [0.027, 3000, 0.18]] },
  shotgun: { len: 0.85, imp: 1.1, pT: 1.8, crack: 0.15, bodyF: [5000, 420], bodyT: 0.11, bodyTau: 0.07, midF: 320, midQ: 1.0, midA: 0.85, midT: 0.09, boomF: [118, 36], boomA: 1.35, boomT: 0.16, boomTau: 0.06, drive: 3.4, ring: null, mech: null },
  rifle: { len: 0.65, imp: 1.0, pT: 1.3, crack: 0.9, bodyF: [9000, 1150], bodyT: 0.05, bodyTau: 0.04, midF: 590, midQ: 1.2, midA: 0.62, midT: 0.045, boomF: [138, 44], boomA: 1.0, boomT: 0.09, boomTau: 0.035, drive: 3.1, ring: [[2350, 0.045, 0.03]], mech: [[0.021, 2350, 0.36], [0.049, 1850, 0.3]] },
  m4: { len: 0.6, imp: 1.0, pT: 1.1, crack: 1.0, bodyF: [11500, 1650], bodyT: 0.04, bodyTau: 0.035, midF: 820, midQ: 1.4, midA: 0.5, midT: 0.035, boomF: [160, 55], boomA: 0.82, boomT: 0.07, boomTau: 0.03, drive: 2.9, ring: [[3300, 0.04, 0.025]], mech: [[0.017, 3500, 0.3], [0.039, 2800, 0.25]], spring: true },
  sniper: { len: 1.0, imp: 1.25, pT: 1.6, crack: 1.25, bodyF: [9500, 900], bodyT: 0.085, bodyTau: 0.06, midF: 440, midQ: 1.1, midA: 0.85, midT: 0.08, boomF: [120, 34], boomA: 1.45, boomT: 0.18, boomTau: 0.05, drive: 3.6, ring: [[1650, 0.05, 0.06]], mech: null },
};

function gunCore(P, mode) {
  const far = mode === 'far', L = far ? 1.1 : P.len;
  const x = mk(L);
  if (!far) {
    add(x, hp(env(noise(0.014), 0.0001, 0.0022), 300), 0, P.imp * 1.4);
    add(x, pulse(0.0021 * P.pT), 0, P.imp);
    if (mode === 'near' && P.crack) add(x, hp(nwave(0.0007), 900), 0, P.crack * 1.2);
  }
  const f0 = far ? P.bodyF[0] * 0.18 : P.bodyF[0] * rr(0.93, 1.07), f1 = far ? P.bodyF[1] * 0.55 : P.bodyF[1];
  const bt = P.bodyT * (far ? 2.2 : rr(0.9, 1.1));
  const b = env(noise(Math.min(L, bt * 9)), 0.0004, bt);
  lp(b, expSweep(f0, f1, P.bodyTau), 0.85); lp(b, expSweep(f0 * 1.3, f1, P.bodyTau), 0.6);
  add(x, b, 0, 1.3);
  const m = env(noise(Math.min(L, P.midT * 8)), 0.0005, P.midT * (far ? 1.8 : 1));
  bp(m, P.midF * rr(0.95, 1.05), P.midQ);
  add(x, m, 0, P.midA * 2.6);
  const boomT = P.boomT * (far ? 2.3 : 1);
  add(x, tone(Math.min(L, boomT * 7), P.boomF[0] * rr(0.95, 1.05), P.boomF[1], P.boomTau, 0.0012, boomT), 0, P.boomA * (mode === 'fp' ? 1.2 : far ? 1.4 : 0.9));
  if (P.ring && !far) add(x, partials(0.3, P.ring), 0.0005);
  drive(x, P.drive * (far ? 0.6 : 1));
  return norm(x, 0.95);
}

function gunshot(type, mode) {
  const P = GUNS[type];
  const core = gunCore(P, mode);
  if (mode === 'fp') {
    const [L, R] = reflect(core, 0.95, 3400, 0.1);
    // diffuse glue: dense very early reverb so the shot does not sound "dry" before the convolver tail
    const glue = lp(env(noise(0.25), 0.002, 0.05), 2400);
    add(L, glue, 0.006, 0.12); add(R, glue.reverse(), 0.006, 0.12);
    if (P.mech) for (const [t, f, a] of P.mech) { const c = click(f * rr(0.95, 1.05), a, 0.009); add(L, c, t, 0.75); add(R, c, t, 1); }
    if (P.spring) { const s = partials(0.12, [[1150, 0.05, 0.04], [1720, 0.03, 0.03]]); add(L, s, 0.03); add(R, s, 0.03); }
    return [trim(norm(L, 0.95)), trim(norm(R, 0.95))];
  }
  if (mode === 'near') return trim(norm(mono(reflect(core, 0.7, 3000, 0.09)), 0.95));
  const f = lp(lp(core, 1400, 0.7), 900, 0.7);
  const [a, b] = reverb(f, { room: 0.87, damp: 0.5, wet: 1.3, dry: 0.55, tail: 1.3 });
  return trim(norm(mono([a, b]), 0.8));
}

// ------------------------------------------------------------------ recipes
const R = {};

// knife
R.kn_swing = () => { const x = noise(0.3); bp(x, (t) => 500 + 2300 * Math.sin(Math.min(1, t / 0.22) * Math.PI), 1.3); bell(x, 0.45, 2); add(x, bell(bp(noise(0.3), 5200, 0.9), 0.5, 3), 0, 0.25); return trim(norm(x, 0.8)); };
R.kn_heavy = () => { const x = noise(0.42); bp(x, (t) => 380 + 1600 * Math.sin(Math.min(1, t / 0.32) * Math.PI), 1.1); bell(x, 0.55, 2); add(x, bell(bp(noise(0.42), 4200, 0.8), 0.6, 3), 0, 0.2); return trim(norm(x, 0.85)); };
R.kn_flesh = () => {
  const x = mk(0.3);
  add(x, lp(env(noise(0.2), 0.001, 0.03), 800), 0, 1.2);
  add(x, tone(0.2, 105, 52, 0.03, 0.002, 0.06), 0, 0.9);
  const sq = env(noise(0.2), 0.004, 0.06); bp(sq, (t) => 1500 - 600 * t * 5, 5); for (let i = 0; i < sq.length; i++) sq[i] *= 0.6 + 0.4 * Math.sin(i / SR * 2 * Math.PI * 32);
  add(x, sq, 0.01, 1.6);
  return trim(norm(drive(x, 1.6), 0.9));
};
R.kn_wall = () => {
  const x = partials(0.3, [[2600, 0.5, 0.045], [3900, 0.35, 0.035], [5700, 0.2, 0.02]]);
  add(x, burst(0.1, 'hp', 3000, 0.7, 0.0005, 0.018, 1.3));
  add(x, burst(0.12, 'bp', 1200, 1, 0.001, 0.03, 1.2));
  return trim(norm(x, 0.8));
};
R.kn_draw = () => {
  const x = mk(0.55);
  add(x, burst(0.12, 'bp', 900, 1, 0.01, 0.03, 0.8));
  const s = noise(0.45); hp(s, 3800); env(s, 0.06, 0.13); add(x, s, 0.04, 0.7);
  add(x, partials(0.45, [[3150, 0.15, 0.22], [4680, 0.12, 0.18], [6230, 0.08, 0.14]], 0.05), 0.05);
  return trim(norm(x, 0.7));
};

// grenade
R.gr_pin = () => { const x = click(3300, 1, 0.008); const y = mk(0.3); add(y, x); add(y, partials(0.28, [[4200, 0.3, 0.1], [6150, 0.2, 0.07]]), 0.002); add(y, click(2600, 0.6, 0.006), 0.085); return trim(norm(y, 0.7)); };
R.gr_spoon = () => { const y = mk(0.35); add(y, click(3000, 0.6, 0.006)); add(y, partials(0.33, [[2480, 0.5, 0.16], [3820, 0.3, 0.11], [5230, 0.2, 0.07]]), 0.004); return trim(norm(y, 0.6)); };
R.gr_bounce = () => { const y = partials(0.12, [[700 * rr(0.9, 1.1), 0.5, 0.03], [1150, 0.3, 0.02], [2300, 0.1, 0.01]]); add(y, burst(0.08, 'lp', 600, 0.7, 0.001, 0.02, 1.2)); return trim(norm(y, 0.8)); };
R.gr_throw = () => { const x = noise(0.3); bp(x, (t) => 400 + 1400 * Math.sin(Math.min(1, t / 0.25) * Math.PI), 1); bell(x, 0.4); add(x, burst(0.15, 'bp', 2500, 0.8, 0.02, 0.04, 0.4)); return trim(norm(x, 0.6)); };
function explosion(far) {
  const L = far ? 3.2 : 2.6, x = mk(L);
  if (!far) { add(x, pulse(0.0065), 0, 1.2); add(x, hp(nwave(0.001), 700), 0, 0.8); add(x, hp(env(noise(0.03), 0.0001, 0.004), 400), 0, 1.5); }
  const b = env(noise(1.6), 0.001, far ? 0.5 : 0.32); lp(b, expSweep(far ? 1500 : 6500, 170, 0.25), 0.8); add(x, b, 0, 1.4);
  add(x, tone(2.2, 72, 24, 0.3, 0.002, 0.6), 0, 1.5);
  const sub = env(noise(2.5), 0.01, far ? 1.2 : 0.9); lp(sub, 90, 0.8); lp(sub, 90, 0.8); add(x, sub, 0, 3);
  if (!far) for (let i = 0; i < 46; i++) { const t = 0.12 + Math.pow(rnd(), 1.6) * 1.8; add(x, click(rr(1800, 5200), rr(0.05, 0.25) * (1.9 - t) / 1.9, rr(0.004, 0.012)), t); }
  drive(x, far ? 1.8 : 3.8);
  const [a, c] = far ? reverb(lp(x, 500, 0.7), { room: 0.9, damp: 0.55, wet: 1.4, dry: 0.5, tail: 1.5 }) : reflect(norm(x), 0.9, 2600, 0.1);
  if (far) return trim(norm(mono([a, c]), 0.8));
  return [trim(norm(a, 0.97)), trim(norm(c, 0.97))];
}
R.gr_boom = () => explosion(false);
R.gr_far = () => explosion(true);

// bullet impacts
R.im_flesh = () => {
  const x = mk(0.25);
  add(x, lp(env(noise(0.12), 0.0005, 0.024), 1300), 0, 1.3);
  add(x, tone(0.15, 125, 62, 0.02, 0.001, 0.045), 0, 0.9);
  add(x, burst(0.05, 'bp', 2300, 2, 0.0003, 0.012, 0.8));
  return trim(norm(drive(x, 1.8), 0.9));
};
R.im_head = () => { const x = R.im_flesh(); const y = mk(0.4); add(y, x, 0, 0.7); add(y, partials(0.38, [[2900, 0.6, 0.12], [4350, 0.4, 0.09], [6100, 0.25, 0.06]])); add(y, click(5200, 0.8, 0.004)); return trim(norm(y, 0.9)); };
R.im_plate = () => { const y = partials(0.3, [[620, 0.6, 0.08], [1040, 0.45, 0.06], [1690, 0.3, 0.05], [2600, 0.2, 0.03]]); add(y, click(3000, 0.9, 0.005)); add(y, lp(env(noise(0.06), 0.0005, 0.01), 900), 0, 0.8); return trim(norm(drive(y, 1.4), 0.85)); };
R.im_wall = () => {
  const x = mk(0.4);
  add(x, burst(0.1, 'bp', rr(1200, 1800), 1, 0.0003, 0.02, 1.6));
  add(x, burst(0.1, 'lp', 500, 0.7, 0.0005, 0.03, 1.2));
  add(x, burst(0.3, 'hp', 4200, 0.7, 0.003, 0.07, 0.25), 0.006);
  for (let i = 0; i < 5; i++) add(x, click(rr(2500, 5000), rr(0.04, 0.12), 0.004), rr(0.03, 0.3));
  return trim(norm(drive(x, 1.5), 0.85));
};
R.im_floor = () => { const x = mk(0.2); add(x, burst(0.12, 'lp', 450, 0.8, 0.0005, 0.03, 1.4)); add(x, burst(0.05, 'bp', 900, 1.2, 0.0003, 0.01, 0.6)); add(x, tone(0.1, 95, 70, 0.02, 0.001, 0.03), 0, 0.5); return trim(norm(x, 0.8)); };
R.im_ceil = () => { const x = mk(0.7); add(x, burst(0.1, 'bp', 2500, 1.5, 0.0003, 0.02, 1.4)); add(x, burst(0.1, 'lp', 700, 0.7, 0.001, 0.02, 0.8)); for (let i = 0; i < 9; i++) add(x, burst(0.03, 'bp', rr(1500, 4000), 2, 0.001, 0.006, rr(0.05, 0.2)), rr(0.1, 0.6)); return trim(norm(x, 0.8)); };
R.whiz = () => {
  const x = mk(0.28);
  add(x, hp(nwave(0.0008), 600), 0, 1);
  add(x, burst(0.03, 'hp', 3000, 0.7, 0.0001, 0.004, 0.8));
  const w = noise(0.24); bp(w, expSweep(rr(4200, 5200), 1600, 0.08), 6); bell(w, 0.3, 2); add(x, w, 0.002, 0.9);
  return trim(norm(x, 0.9));
};

// movement
function step(run) {
  const x = mk(0.3);
  const heel = run ? 1.3 : 1;
  add(x, burst(0.15, 'lp', rr(280, 420), 0.8, 0.004, run ? 0.035 : 0.028, heel));
  add(x, tone(0.1, 80, 60, 0.03, 0.002, 0.025), 0, 0.35);
  if (run) add(x, burst(0.1, 'lp', 400, 0.8, 0.003, 0.02, 0.7), rr(0.028, 0.04));
  add(x, burst(0.1, 'bp', rr(1500, 2400), 0.8, 0.01, 0.025, run ? 0.35 : 0.22), 0.012);
  if (rnd() < 0.5) { const sq = env(noise(0.1), 0.01, 0.03); bp(sq, (t) => 1300 - t * 3000, 6); add(x, sq, 0.02, 0.5); }
  return trim(norm(x, 0.85));
}
R.st_walk = () => step(false);
R.st_run = () => step(true);
R.st_land = () => { const x = mk(0.4); add(x, burst(0.2, 'lp', 300, 0.8, 0.003, 0.05, 1.5)); add(x, tone(0.2, 70, 45, 0.05, 0.002, 0.06), 0, 0.8); add(x, R.gear(), 0.02, 0.6); return trim(norm(x, 0.9)); };
R.gear = () => { const x = mk(0.3); add(x, bell(bp(noise(0.2), rr(2200, 4200), 0.7), 0.4, 2), 0, 0.6); if (rnd() < 0.7) for (let i = 0; i < 3; i++) add(x, partials(0.05, [[rr(4000, 7000), 0.3, 0.012]]), rr(0, 0.12)); return trim(norm(x, 0.6)); };
R.cloth = () => { const x = bell(bp(noise(rr(0.14, 0.22)), rr(1800, 3200), 0.7), 0.35, 2); return trim(norm(x, 0.6)); };

// brass / hulls on the damp carpet
R.sh_brass = () => { const x = mk(0.15); add(x, click(rr(3800, 5200), 0.7, 0.005)); add(x, burst(0.03, 'lp', 700, 0.7, 0.0003, 0.006, 0.6)); add(x, click(rr(4200, 5600), 0.25, 0.004), rr(0.05, 0.08)); return trim(norm(x, 0.6)); };
R.sh_hull = () => { const x = mk(0.15); add(x, burst(0.05, 'lp', 900, 0.8, 0.0005, 0.015, 1)); add(x, burst(0.03, 'bp', 1500, 1.5, 0.0003, 0.008, 0.5)); add(x, burst(0.05, 'lp', 800, 0.8, 0.0005, 0.01, 0.4), 0.07); return trim(norm(x, 0.6)); };

// weapon handling
const slideN = (sec, f, q, a, d, amp) => burst(sec, 'bp', f, q, a, d, amp);
const seq = (sec, parts) => { const x = mk(sec); for (const [t, s, g] of parts) add(x, s, t, g ?? 1); return trim(norm(x, 0.85)); };
R.mag_out_p = () => seq(0.2, [[0, click(3500, 1, 0.006)], [0.01, slideN(0.1, 3000, 1.5, 0.005, 0.02, 0.8)]]);
R.mag_in_p = () => seq(0.2, [[0, slideN(0.06, 2200, 1.4, 0.004, 0.015, 0.6)], [0.045, click(3000, 1, 0.007)], [0.045, burst(0.06, 'lp', 600, 0.7, 0.001, 0.015, 0.9)]]);
R.slide_rel = () => seq(0.2, [[0, click(2600, 1, 0.01)], [0, partials(0.15, [[1900, 0.3, 0.04], [3300, 0.25, 0.03]])], [0, burst(0.05, 'lp', 1500, 0.7, 0.0005, 0.01, 0.6)]]);
R.slide_rack = () => seq(0.35, [[0, slideN(0.1, 2500, 1.5, 0.01, 0.03, 0.6)], [0.06, click(3000, 0.7, 0.006)], [0.13, click(2600, 1, 0.01)], [0.13, partials(0.15, [[1900, 0.3, 0.04]])]]);
R.mag_out_r = () => seq(0.3, [[0, click(2800, 0.9, 0.007)], [0.015, slideN(0.15, 2200, 2, 0.01, 0.05, 0.8)], [0.05, partials(0.1, [[1700, 0.1, 0.03]])]]);
R.mag_in_r = () => seq(0.3, [[0, slideN(0.1, 1800, 1.6, 0.006, 0.035, 0.7)], [0.075, click(2400, 1, 0.01)], [0.075, burst(0.06, 'lp', 700, 0.7, 0.001, 0.015, 0.8)], [0.08, partials(0.1, [[1500, 0.15, 0.03]])]]);
R.ch_pull = () => seq(0.3, [[0, click(2200, 0.8, 0.008)], [0.01, slideN(0.12, 1700, 2, 0.01, 0.04, 0.8)], [0.02, partials(0.12, [[900, 0.12, 0.05], [1350, 0.08, 0.04]])], [0.08, click(2000, 0.5, 0.006)]]);
R.ch_rel = () => seq(0.25, [[0, click(2000, 1, 0.012)], [0, burst(0.06, 'lp', 800, 0.7, 0.0005, 0.015, 0.9)], [0.002, partials(0.18, [[1500, 0.4, 0.06], [2600, 0.3, 0.04]])]]);
R.bolt_catch = () => seq(0.25, [[0, burst(0.05, 'lp', 700, 0.7, 0.0005, 0.01, 0.7)], [0.006, click(2400, 0.5, 0.005)], [0.02, R.ch_rel(), 0.9]]);
R.mag_tap = () => seq(0.15, [[0, burst(0.05, 'lp', 600, 0.7, 0.0005, 0.012, 1)], [0, click(2200, 0.5, 0.006)]]);
R.sh_insert = () => seq(0.2, [[0, slideN(0.08, rr(1300, 1600), 1.5, 0.006, 0.03, 0.8)], [0.055, click(2600, 0.9, 0.008)], [0.055, burst(0.04, 'lp', 900, 0.7, 0.0005, 0.01, 0.5)]]);
R.pump_back = () => seq(0.2, [[0, slideN(0.1, 1100, 1.2, 0.01, 0.04, 0.8)], [0.065, click(1700, 1, 0.012)], [0.065, partials(0.1, [[1250, 0.2, 0.03]])]]);
R.pump_fwd = () => seq(0.2, [[0, slideN(0.08, 1300, 1.2, 0.008, 0.03, 0.7)], [0.055, click(2000, 1, 0.012)], [0.055, burst(0.05, 'lp', 800, 0.7, 0.0005, 0.012, 0.8)]]);
R.rv_open = () => seq(0.35, [[0, click(3200, 0.8, 0.006)], [0.04, partials(0.2, [[2100, 0.15, 0.05]])], [0.06, slideN(0.1, 2600, 2, 0.01, 0.03, 0.5)], [0.12, click(2400, 0.7, 0.008)]]);
R.rv_eject = () => { const x = mk(0.6); add(x, click(2800, 0.8, 0.008)); for (let i = 0; i < 6; i++) add(x, partials(0.08, [[rr(3500, 5200), 0.3, 0.02], [rr(6000, 7500), 0.15, 0.012]]), rr(0.05, 0.4)); return trim(norm(x, 0.8)); };
R.rv_load = () => seq(0.35, [[0, slideN(0.1, 2000, 1.5, 0.01, 0.03, 0.6)], [0.08, click(3000, 0.6, 0.006)], [0.1, click(3400, 0.5, 0.005)], [0.13, click(2800, 0.7, 0.007)]]);
R.rv_close = () => seq(0.3, [[0, click(2400, 1, 0.01)], [0, partials(0.15, [[1800, 0.3, 0.04]])], [0.07, click(3800, 0.3, 0.004)], [0.1, click(3800, 0.3, 0.004)]]);
R.bolt_up = () => seq(0.15, [[0, click(2600, 0.7, 0.006)], [0.004, partials(0.08, [[3200, 0.15, 0.02]])]]);
R.bolt_back = () => seq(0.25, [[0, slideN(0.14, 1900, 2, 0.01, 0.05, 0.8)], [0.1, click(2200, 0.9, 0.008)]]);
R.bolt_fwd = () => seq(0.25, [[0, slideN(0.12, 2100, 2, 0.01, 0.04, 0.8)], [0.085, click(2500, 1, 0.01)], [0.085, burst(0.04, 'lp', 900, 0.7, 0.0005, 0.01, 0.5)]]);
R.bolt_down = () => seq(0.15, [[0, click(2800, 0.9, 0.007)], [0, burst(0.04, 'lp', 700, 0.7, 0.0005, 0.01, 0.6)]]);
R.dry = () => seq(0.12, [[0, click(3800, 0.8, 0.005)], [0, burst(0.03, 'lp', 800, 0.7, 0.0003, 0.006, 0.4)]]);
R.mode = () => seq(0.12, [[0, click(4200, 0.8, 0.004)], [0.03, click(3000, 0.6, 0.004)]]);
R.deploy_light = () => seq(0.3, [[0, R.cloth(), 0.7], [0.06, click(3000, 0.7, 0.006)]]);
R.deploy_heavy = () => seq(0.4, [[0, R.cloth(), 0.9], [0.08, click(2200, 0.8, 0.008)], [0.12, click(2600, 0.6, 0.006)], [0.13, partials(0.1, [[1600, 0.1, 0.03]])]]);
R.holster = () => seq(0.25, [[0, R.cloth(), 1]]);
R.inspect = () => seq(0.4, [[0, R.cloth(), 0.8], [0.18, click(2900, 0.4, 0.005)]]);

// UI / feedback
R.ui_hit = () => { const x = mk(0.09); add(x, tone(0.06, rr(2500, 2700), 1700, 0.012, 0.0005, 0.016), 0, 0.8); add(x, burst(0.01, 'hp', 5000, 0.7, 0.0001, 0.0018, 0.5)); add(x, tone(0.05, 190, 150, 0.02, 0.001, 0.02), 0, 0.35); return trim(norm(x, 0.8)); };
R.ui_head = () => { const x = partials(0.3, [[3050, 0.8, 0.11], [4540, 0.5, 0.08], [6230, 0.3, 0.05], [7900, 0.15, 0.03]]); add(x, click(5400, 0.7, 0.003)); add(x, tone(0.05, 220, 160, 0.02, 0.001, 0.02), 0, 0.3); return trim(norm(x, 0.8)); };
R.ui_armor = () => { const x = partials(0.2, [[950, 0.7, 0.06], [1600, 0.5, 0.045], [2300, 0.3, 0.03]]); add(x, click(2800, 0.5, 0.004)); return trim(norm(x, 0.75)); };
R.ui_kill = () => {
  const x = mk(0.5);
  add(x, tone(0.4, 95, 42, 0.07, 0.001, 0.13), 0, 1.1);
  add(x, burst(0.06, 'lp', 1300, 0.7, 0.0003, 0.02, 0.9));
  add(x, tone(0.1, 1500, 1100, 0.03, 0.0005, 0.04), 0, 0.35);
  add(x, partials(0.4, [[740, 0.12, 0.15], [1110, 0.08, 0.12]]), 0.03);
  return trim(norm(drive(x, 1.5), 0.9));
};
R.ui_killhs = () => { const x = mk(0.5); add(x, R.ui_kill(), 0, 0.9); add(x, R.ui_head(), 0.005, 0.7); return trim(norm(x, 0.9)); };
R.ui_streak = () => { const x = mk(0.5); add(x, tone(0.2, 880, 880, 1, 0.005, 0.08, 'tri'), 0, 0.5); add(x, tone(0.25, 1320, 1320, 1, 0.005, 0.1, 'tri'), 0.09, 0.5); return trim(norm(x, 0.6)); };
R.ui_pickup = () => seq(0.35, [[0, R.cloth(), 0.8], [0.03, click(2600, 0.7, 0.006)], [0.09, click(1900, 0.7, 0.007)]]);
R.ui_crate = () => {
  const x = mk(0.6);
  const c = noise(0.42); bp(c, (t) => 500 + 800 * t / 0.42, 6); env(c, 0.05, 0.3);
  for (let i = 0; i < c.length; i++) c[i] *= 0.6 + 0.4 * Math.sin(i / SR * 2 * Math.PI * 38);
  add(x, c, 0, 1.6); add(x, burst(0.1, 'lp', 400, 0.7, 0.001, 0.04, 1), 0.38); add(x, click(1200, 0.5, 0.01), 0.38);
  return trim(norm(x, 0.8));
};
R.ui_beep = () => { const x = mk(0.3); for (const t of [0, 0.13]) { add(x, tone(0.08, 2600, 2600, 1, 0.003, 1, 'soft'), t, 0.5); } for (let i = 0; i < x.length; i++) { const t = i / SR; if (!((t > 0 && t < 0.07) || (t > 0.13 && t < 0.2))) x[i] *= 0.02; } return trim(norm(x, 0.5)); };
R.ui_click = () => trim(norm(click(1900, 1, 0.004), 0.5));
R.ui_hover = () => trim(norm(click(2800, 1, 0.003), 0.25));
R.ui_toast = () => { const x = tone(0.12, 1400, 1400, 1, 0.003, 0.04, 'tri'); return trim(norm(x, 0.35)); };
R.ui_end = () => { const x = mk(1.4); [523, 392, 330].forEach((f, i) => add(x, tone(0.9, f, f, 1, 0.01, 0.35, 'tri'), i * 0.18, 0.5)); return trim(norm(x, 0.55)); };

// player
R.hurt = () => { const x = mk(0.35); add(x, tone(0.3, 85, 38, 0.06, 0.002, 0.1), 0, 1); add(x, burst(0.1, 'lp', 700, 0.7, 0.001, 0.035, 0.7)); add(x, burst(0.05, 'bp', 1600, 1.5, 0.0003, 0.01, 0.35)); return trim(norm(drive(x, 1.6), 0.9)); };
R.hurt_head = () => { const x = mk(0.5); add(x, R.hurt(), 0, 1); add(x, partials(0.4, [[2200, 0.15, 0.2], [3300, 0.1, 0.15]]), 0.01); return trim(norm(x, 0.9)); };
R.heart = () => { const x = mk(0.45); add(x, tone(0.2, 60, 45, 0.05, 0.004, 0.05), 0, 1); add(x, burst(0.06, 'lp', 150, 0.7, 0.003, 0.02, 0.5)); add(x, tone(0.2, 52, 40, 0.05, 0.004, 0.045), 0.19, 0.7); return trim(norm(x, 0.8)); };
R.breath = () => { const x = noise(rr(0.5, 0.65)); bp(x, rr(900, 1200), 0.6); bell(x, 0.35, 2); add(x, bell(bp(noise(0.55), 400, 0.8), 0.4, 2), 0, 0.3); return trim(norm(x, 0.5)); };
R.death = () => { const x = mk(1.2); add(x, R.hurt(), 0, 1); add(x, burst(1.1, 'lp', 300, 0.7, 0.2, 0.3, 0.4), 0.1); return trim(norm(x, 0.8)); };

// distant level ambience (baked with reverb so they sound far away and around corners)
const farify = (x, wet = 1.3) => { lp(x, 1200, 0.7); return trim(norm(mono(reverb(x, { room: 0.88, damp: 0.5, wet, dry: 0.3, tail: 1.8 })), 0.7)); };
R.amb_thud = () => { const x = mk(0.8); add(x, tone(0.7, 62, 30, 0.2, 0.01, 0.35)); add(x, burst(0.5, 'lp', 300, 0.7, 0.005, 0.2, 0.7)); return farify(x); };
R.amb_creak = () => { const x = noise(1.3); bp(x, (t) => 320 + 200 * t, 9); env(x, 0.2, 0.5, 0.3); for (let i = 0; i < x.length; i++) x[i] *= 0.55 + 0.45 * Math.sin(i / SR * 2 * Math.PI * (13 + 3 * Math.sin(i / SR * 3))); return farify(x, 1); };
R.amb_steps = () => { const x = mk(2); for (let i = 0; i < 5; i++) add(x, step(false), i * 0.42 + rr(-0.03, 0.03), 0.8); return farify(x, 1.1); };
R.amb_knock = () => { const x = mk(1.3); for (let i = 0; i < 3; i++) { add(x, burst(0.1, 'lp', 600, 0.7, 0.001, 0.03, 1.2), i * 0.33); add(x, tone(0.1, 180, 120, 0.02, 0.001, 0.03), i * 0.33, 0.6); } return farify(x, 1); };
R.amb_drone = () => { const x = mk(3.2); let ph = 0; for (let i = 0; i < x.length; i++) { ph += 55 / SR; x[i] = ((ph % 1) * 2 - 1) * Math.sin(Math.PI * i / x.length) ** 2; } lp(x, 260, 0.8); add(x, bell(bp(noise(3.2), 700, 3), 0.5, 2), 0, 0.15); return farify(x, 0.9); };
R.amb_pop = () => { const x = mk(0.6); add(x, click(2000, 1, 0.01)); const b = noise(0.4); bp(b, 1900, 2); env(b, 0.002, 0.08); for (let i = 0; i < b.length; i++) b[i] *= Math.sin(i / SR * 2 * Math.PI * 120) > 0 ? 1 : 0.2; add(x, b, 0.01, 0.8); return farify(x, 0.8); };
R.amb_scream = () => { const x = mk(1.6); let ph = 0; for (let i = 0; i < x.length; i++) { const t = i / SR; ph += (420 + 60 * Math.sin(t * 7) - 120 * t) / SR; x[i] = Math.sin(2 * Math.PI * ph) * Math.sin(Math.PI * t / 1.6) ** 2; } add(x, bell(bp(noise(1.6), 1500, 2), 0.3), 0, 0.3); return farify(x, 1.4); };

// convolver IR: carpeted low-ceiling labyrinth. Highs decay faster than lows.
R.ir = () => {
  const T = 1.9, out = [];
  for (let c = 0; c < 2; c++) {
    const x = noise(T);
    for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] *= t < 0.012 ? 0 : Math.exp(-(t - 0.012) / 0.26) * (t < 0.02 ? (t - 0.012) / 0.008 : 1); }
    lp(x, expSweep(7000, 900, 0.35), 0.7);
    out.push(norm(x, 0.5));
  }
  return out;
};

// ------------------------------------------------------------------ bank
const COUNTS = {
  kn_swing: 3, kn_heavy: 2, kn_flesh: 2, kn_wall: 2, kn_draw: 1,
  gr_pin: 1, gr_spoon: 1, gr_bounce: 3, gr_throw: 1, gr_boom: 2, gr_far: 1,
  im_flesh: 3, im_head: 2, im_plate: 2, im_wall: 4, im_floor: 3, im_ceil: 2, whiz: 3,
  st_walk: 6, st_run: 5, st_land: 2, gear: 4, cloth: 3, sh_brass: 4, sh_hull: 2,
  mag_out_p: 1, mag_in_p: 1, slide_rel: 1, slide_rack: 1, mag_out_r: 1, mag_in_r: 1, ch_pull: 1, ch_rel: 1, bolt_catch: 1, mag_tap: 1,
  sh_insert: 3, pump_back: 1, pump_fwd: 1, rv_open: 1, rv_eject: 1, rv_load: 1, rv_close: 1,
  bolt_up: 1, bolt_back: 1, bolt_fwd: 1, bolt_down: 1, dry: 1, mode: 1, deploy_light: 1, deploy_heavy: 1, holster: 1, inspect: 1,
  ui_hit: 2, ui_head: 1, ui_armor: 1, ui_kill: 1, ui_killhs: 1, ui_streak: 1, ui_pickup: 1, ui_crate: 1, ui_beep: 1, ui_click: 1, ui_hover: 1, ui_toast: 1, ui_end: 1,
  hurt: 3, hurt_head: 1, heart: 1, breath: 2, death: 1,
  amb_thud: 1, amb_creak: 1, amb_steps: 1, amb_knock: 1, amb_drone: 1, amb_pop: 1, amb_scream: 1, ir: 1,
};

export function soundList() {
  const list = [];
  for (const w of Object.keys(GUNS)) { list.push(['fp_' + w, 3], ['np_' + w, 2], ['fr_' + w, 2]); }
  for (const [k, n] of Object.entries(COUNTS)) list.push([k, n]);
  return list;
}

export function synthOne(name, variant, sampleRate) {
  SR = sampleRate;
  rnd = mulberry32(hash(name) + variant * 7919);
  const m = /^(fp|np|fr)_(\w+)$/.exec(name);
  if (m) return gunshot(m[2], m[1] === 'fp' ? 'fp' : m[1] === 'np' ? 'near' : 'far');
  return R[name]();
}

export function synthBank(sampleRate, onProgress) {
  const out = {}, list = soundList();
  const total = list.reduce((s, [, n]) => s + n, 0);
  let done = 0;
  for (const [name, n] of list) {
    out[name] = [];
    for (let v = 0; v < n; v++) { out[name].push(synthOne(name, v, sampleRate)); done++; if (onProgress) onProgress(done / total, name); }
  }
  return out;
}

// First-person viewmodel: weapon poses, spring-driven recoil, keyframed procedural animations
// (draw, reload variants, pump, bolt, knife, inspect, grenade) that emit timed events for
// sounds and gameplay (ammo applied when the magazine seats, knife hit frame, grenade release...).
import * as THREE from 'three';
import { WEAPON_ORDER, WEAPONS } from './shared/weapons.js';
import { buildGun, buildGrenade, FPArms, decorateGun } from './models.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const smooth = (x) => x * x * (3 - 2 * x);
const easeOutBack = (x) => { const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

// keyframes: [[u, value], ...] with smoothstep between keys; values may be numbers or arrays
function kf(u, keys) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [u1, v1] = keys[i];
    if (u <= u1) {
      const [u0, v0] = keys[i - 1];
      const t = smooth((u - u0) / Math.max(1e-6, u1 - u0));
      if (typeof v0 === 'number') return v0 + (v1 - v0) * t;
      return v0.map((a, j) => a + (v1[j] - a) * t);
    }
  }
  return keys[keys.length - 1][1];
}

// hip pose, ADS eye distance to the sight point (generous eye relief keeps the gun low and the target visible),
// iron-sight hold (deg): the aligned sights sit this far under the aim point, so the target stands on top of the
// front post instead of behind it ("6 o'clock hold"; red dot / scope: none), muzzle flash size
const POSE = {
  pistol: { hip: [0.09, -0.165, -0.41], D: 0.6, hold: 1.0, flash: 0.14 },
  revolver: { hip: [0.09, -0.16, -0.41], D: 0.62, hold: 1.0, flash: 0.18 },
  smg: { hip: [0.08, -0.225, -0.44], D: 0.82, hold: 0.9, flash: 0.18 },
  shotgun: { hip: [0.08, -0.23, -0.5], D: 1.3, hold: 0.7, flash: 0.3 },
  rifle: { hip: [0.08, -0.23, -0.5], D: 1.1, hold: 1.0, flash: 0.24 },
  m4: { hip: [0.08, -0.225, -0.47], D: 0.36, hold: 0, flash: 0.2 },
  sniper: { hip: [0.08, -0.24, -0.5], D: 0.34, hold: 0, flash: 0.28 },
  knife: { hip: [0.11, -0.165, -0.3], D: 0.4, hold: 0, flash: 0 },
};
const X_AXIS = new THREE.Vector3(1, 0, 0);
// recoil feel: spring impulses (back/up m/s, pitch/yaw/roll rad/s), spring stiffness/damping, camera shake, fov punch
export const FEEL = {
  pistol: { back: 0.9, up: 0.12, pitch: 5.5, yaw: 0.8, roll: 1.2, k: 320, c: 22, cam: 0.08, fov: 0.5 },
  revolver: { back: 1.3, up: 0.25, pitch: 11, yaw: 1.2, roll: 2.2, k: 240, c: 18, cam: 0.2, fov: 1.0 },
  smg: { back: 0.55, up: 0.05, pitch: 1.6, yaw: 0.7, roll: 0.9, k: 420, c: 26, cam: 0.05, fov: 0.2 },
  shotgun: { back: 1.6, up: 0.2, pitch: 7, yaw: 1.4, roll: 2.4, k: 220, c: 16, cam: 0.32, fov: 1.4 },
  rifle: { back: 0.85, up: 0.08, pitch: 2.4, yaw: 1.0, roll: 1.6, k: 360, c: 24, cam: 0.12, fov: 0.4 },
  m4: { back: 0.7, up: 0.06, pitch: 1.9, yaw: 0.8, roll: 1.2, k: 380, c: 25, cam: 0.08, fov: 0.3 },
  sniper: { back: 1.9, up: 0.25, pitch: 8, yaw: 1.0, roll: 2.0, k: 200, c: 15, cam: 0.35, fov: 1.8 },
  knife: { back: 0, up: 0, pitch: 0, yaw: 0, roll: 0, k: 300, c: 22, cam: 0, fov: 0 },
};
const LOW = [-0.24, -0.58, -0.34]; // off-screen left hand (grabbing a fresh magazine / shell)

class Spring3 {
  constructor() { this.x = new THREE.Vector3(); this.v = new THREE.Vector3(); this.k = 300; this.c = 22; }
  step(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n, k = this.k, c = this.c, x = this.x, v = this.v;
    for (let i = 0; i < n; i++) {
      v.x += (-k * x.x - c * v.x) * h; v.y += (-k * x.y - c * v.y) * h; v.z += (-k * x.z - c * v.z) * h;
      x.x += v.x * h; x.y += v.y * h; x.z += v.z * h;
    }
  }
  reset() { this.x.set(0, 0, 0); this.v.set(0, 0, 0); }
}

// ------------------------------------------------------------------ animations
// f(u, vm, data) -> pose { p, r, mag, lh, rh, ...part offsets }; ev: [[u, event], ...]
const RELOAD_SND = {
  pistol: ['mag_out_p', 'mag_in_p', 'slide_rel'], smg: ['mag_out_r', 'mag_in_r', 'ch_pull'], rifle: ['mag_out_r', 'mag_in_r', 'ch_pull'],
  m4: ['mag_out_r', 'mag_in_r', 'bolt_catch'], bolt: ['mag_out_r', 'mag_in_r', null],
};
const ANIM = {
  draw: {
    f: (u) => { const e = easeOutBack(clamp(u, 0, 1)), k = 1 - e; return { p: [0.02 * k, -0.3 * k, 0.05 * k], r: [-0.9 * k, 0.25 * k, 0.35 * k] }; },
    ev: [[0, 'draw']],
  },
  holster: { f: (u) => { const k = smooth(u); return { p: [0.02 * k, -0.3 * k, 0.05 * k], r: [-0.9 * k, 0.2 * k, 0.3 * k] }; }, ev: [[0, 'snd:holster']] },
  reload: {
    f: (u, vm, d) => {
      const empty = d.empty, cls = vm.cls;
      const endU = empty ? 0.86 : 0.74;
      const tilt = kf(u, [[0, 0], [0.14, 1], [endU, 1], [1, 0]]);
      const pistol = cls === 'pistol';
      const bump = kf(u, [[0.6, 0], [0.63, 1], [0.7, 0]]);
      const pose = {
        p: pistol ? [-0.06 * tilt, 0.08 * tilt + 0.012 * bump, 0.06 * tilt] : [-0.09 * tilt, 0.135 * tilt + 0.012 * bump, 0.06 * tilt],
        r: pistol ? [0.2 * tilt + 0.06 * bump, 0.3 * tilt, -0.6 * tilt] : [0.08 * tilt + 0.06 * bump, 0.3 * tilt, -0.95 * tilt],
        mag: u < 0.14 ? 0 : u < 0.3 ? Math.pow((u - 0.14) / 0.16, 2) * 0.3 : u < 0.45 ? 0.26 : kf(u, [[0.45, 0.26], [0.61, 0.012], [0.63, 0]]),
        magVis: !(u > 0.3 && u < 0.45),
        lh: u < 0.14 ? { w: kf(u, [[0, 0], [0.13, 1]]), at: 'mag' }
          : u < 0.3 ? { w: 1, at: u < 0.18 ? 'mag' : 'pos', p: LOW }
            : u < 0.45 ? { w: 1, at: 'pos', p: LOW }
              : u < 0.7 ? { w: 1, at: 'mag' }
                : empty && u < 0.86 ? { w: 1, at: cls === 'm4' ? 'catch' : 'rack' }
                  : { w: kf(u, [[empty ? 0.86 : 0.7, 1], [1, 0]]), at: empty ? (cls === 'm4' ? 'catch' : 'rack') : 'mag' },
      };
      if (empty && cls !== 'bolt' && cls !== 'm4') pose.rack = u < 0.72 ? 0 : kf(u, [[0.72, 0], [0.77, 1], [0.8, 1], [0.82, 0]]);
      if (empty && pistol) pose.rack = u < 0.74 ? 1 : kf(u, [[0.74, 1], [0.76, 0]]);
      return pose;
    },
    ev: (d, vm) => {
      const s = RELOAD_SND[vm.cls] || RELOAD_SND.rifle, e = [[0.12, 'snd:' + s[0]], [0.2, 'snd:cloth'], [0.47, 'snd:gear'], [0.6, 'snd:' + s[1]], [0.61, 'ammo'], [0.67, 'snd:mag_tap']];
      if (d.empty && s[2]) e.push(vm.cls === 'pistol' ? [0.74, 'snd:slide_rel'] : vm.cls === 'm4' ? [0.76, 'snd:bolt_catch'] : [0.76, 'snd:ch_pull'], vm.cls === 'pistol' || vm.cls === 'm4' ? [0.9, 'snd:cloth'] : [0.81, 'snd:ch_rel']);
      return e;
    },
  },
  revolver: {
    f: (u) => {
      const tilt = kf(u, [[0, 0], [0.12, 1], [0.74, 1], [1, 0]]);
      const up = kf(u, [[0.2, 0], [0.26, 1], [0.34, 1], [0.42, -0.4], [0.62, -0.4], [0.72, 0]]);
      return {
        p: [-0.06 * tilt, 0.06 * tilt + 0.04 * up, 0.08 * tilt], r: [0.2 * tilt + 0.9 * up, 0.25 * tilt, -0.7 * tilt],
        crane: kf(u, [[0.12, 0], [0.2, 1], [0.66, 1], [0.72, 0]]),
        lh: u < 0.36 ? { w: kf(u, [[0, 0], [0.12, 1]]), at: 'mag' } : u < 0.5 ? { w: 1, at: 'pos', p: LOW } : { w: kf(u, [[0.72, 1], [1, 0]]), at: 'mag' },
      };
    },
    ev: () => [[0.13, 'snd:rv_open'], [0.26, 'snd:rv_eject'], [0.27, 'eject6'], [0.4, 'snd:cloth'], [0.54, 'snd:rv_load'], [0.56, 'ammo'], [0.7, 'snd:rv_close']],
  },
  sg_start: { f: (u) => { const k = smooth(u); return { p: [-0.05 * k, 0.07 * k, 0.08 * k], r: [0.3 * k, 0.25 * k, -0.8 * k], lh: { w: k, at: 'port' } }; }, ev: [[0.2, 'snd:cloth']] },
  sg_insert: {
    f: (u) => ({ p: [-0.05, 0.07 + kf(u, [[0.62, 0], [0.7, 0.008], [0.8, 0]]), 0.08], r: [0.3, 0.25, -0.8], lh: u < 0.35 ? { w: 1, at: u < 0.12 ? 'port' : 'pos', p: LOW } : { w: 1, at: 'port', off: kf(u, [[0.35, 0.12], [0.68, 0]]) }, shell: u > 0.3 && u < 0.7 }),
    ev: [[0.15, 'snd:cloth'], [0.66, 'snd:sh_insert'], [0.67, 'ammo']],
  },
  sg_end: { f: (u) => { const k = 1 - smooth(u); return { p: [-0.05 * k, 0.07 * k, 0.08 * k], r: [0.3 * k, 0.25 * k, -0.8 * k], lh: { w: k, at: 'port' } }; }, ev: [] },
  pump: {
    f: (u) => ({ pump: kf(u, [[0.12, 0], [0.38, 1], [0.46, 1], [0.7, 0]]), p: [0, kf(u, [[0, 0], [0.3, 0.01], [0.7, 0]]), kf(u, [[0.1, 0], [0.38, 0.02], [0.7, 0]])], r: [kf(u, [[0, 0], [0.35, 0.08], [0.8, 0]]), 0, kf(u, [[0, 0], [0.4, 0.1], [0.8, 0]])] }),
    ev: [[0.2, 'snd:pump_back'], [0.36, 'shell'], [0.55, 'snd:pump_fwd']],
  },
  bolt: {
    f: (u) => ({
      boltRot: kf(u, [[0.14, 0], [0.24, 1], [0.7, 1], [0.78, 0]]), boltPos: kf(u, [[0.24, 0], [0.42, 1], [0.5, 1], [0.66, 0]]),
      rh: { w: kf(u, [[0, 0], [0.13, 1], [0.8, 1], [1, 0]]), at: 'knob' },
      p: [-0.02 * kf(u, [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]), 0.035 * kf(u, [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]), 0.05 * kf(u, [[0, 0], [0.2, 1], [0.8, 1], [1, 0]])], r: [0.14 * kf(u, [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]), 0.1 * kf(u, [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]), 0.4 * kf(u, [[0, 0], [0.2, 1], [0.8, 1], [1, 0]])],
    }),
    ev: [[0.16, 'snd:bolt_up'], [0.28, 'snd:bolt_back'], [0.43, 'shell'], [0.54, 'snd:bolt_fwd'], [0.72, 'snd:bolt_down']],
  },
  knife_light: {
    f: (u, vm, d) => {
      const s = d.side;
      return {
        p: kf(u, [[0, [0, 0, 0]], [0.22, [0.09 * s, 0.08, 0.04]], [0.5, [-0.2 * s, -0.04, -0.12]], [1, [0, 0, 0]]]),
        r: kf(u, [[0, [0, 0, 0]], [0.22, [0.3, 0.6 * s, -0.8 * s]], [0.5, [-0.3, -1.0 * s, 0.85 * s]], [1, [0, 0, 0]]]),
      };
    },
    ev: [[0.08, 'snd:kn_swing'], [0.29, 'hit']],
  },
  knife_heavy: {
    f: (u) => ({
      p: kf(u, [[0, [0, 0, 0]], [0.33, [0.03, 0.07, 0.13]], [0.46, [-0.04, 0.0, -0.26]], [0.62, [-0.03, -0.01, -0.22]], [1, [0, 0, 0]]]),
      r: kf(u, [[0, [0, 0, 0]], [0.33, [0.55, 0.15, -0.25]], [0.46, [-0.4, 0, 0.05]], [0.62, [-0.35, 0, 0]], [1, [0, 0, 0]]]),
      lh: { w: kf(u, [[0, 0], [0.3, 1], [0.6, 1], [0.9, 0]]), at: 'pos', p: [-0.12, -0.26, -0.33] },
    }),
    ev: [[0.28, 'snd:kn_heavy'], [0.38, 'hit']],
  },
  inspect: {
    f: (u, vm) => {
      const knife = vm.cls === 'knife';
      return {
        p: kf(u, [[0, [0, 0, 0]], [0.18, [-0.08, 0.04, 0.06]], [0.5, [-0.07, 0.05, 0.06]], [0.62, [-0.02, 0.06, 0.02]], [0.82, [-0.03, 0.05, 0.03]], [1, [0, 0, 0]]]),
        r: kf(u, [[0, [0, 0, 0]], [0.18, [0.1, 0.9, 0.45]], [0.5, [0.15, 0.8, 0.5]], [0.62, [0.35, -0.3, knife ? -2.6 : -0.6]], [0.82, [0.3, -0.25, knife ? -3.0 : -0.5]], [1, [0, 0, knife ? -6.283 : 0]]]),
      };
    },
    ev: [[0.02, 'snd:inspect'], [0.55, 'snd:cloth'], [0.6, 'snd:mode']],
  },
  nade_pull: {
    f: (u) => ({ p: [0.02, -0.18 * smooth(u), 0.04 * smooth(u)], r: [-0.5 * smooth(u), 0, 0.2 * smooth(u)], lh: { w: 1, at: 'pos', p: kf(u, [[0, LOW], [0.5, [-0.13, -0.19, -0.38]], [1, [-0.12, -0.16, -0.36]]]), r: [0.3, 0.2, 0.9] }, nade: true }),
    ev: [[0.02, 'snd:cloth'], [0.55, 'snd:gr_pin']],
  },
  nade_hold: { f: (u, vm, d) => ({ p: [0.02, -0.18, 0.04], r: [-0.5, 0, 0.2], lh: { w: 1, at: 'pos', p: [-0.12, -0.16 + Math.sin(d.t * 3) * 0.004, -0.36] }, nade: true }), ev: [] },
  nade_throw: {
    f: (u) => ({
      p: kf(u, [[0, [0.02, -0.18, 0.04]], [0.55, [0.02, -0.2, 0.05]], [1, [0, 0, 0]]]), r: kf(u, [[0, [-0.5, 0, 0.2]], [0.55, [-0.55, 0, 0.2]], [1, [0, 0, 0]]]),
      lh: { w: kf(u, [[0.6, 1], [1, 0]]), at: 'pos', p: kf(u, [[0, [-0.12, -0.16, -0.36]], [0.28, [-0.27, -0.07, -0.26]], [0.45, [0.0, -0.05, -0.58]], [0.7, [-0.2, -0.55, -0.35]]]), r: [0.3, 0.2, 0.9] },
      nade: u < 0.42,
    }),
    ev: [[0.2, 'snd:gr_throw'], [0.42, 'release'], [0.5, 'snd:gr_spoon']],
  },
};

export class Viewmodel {
  constructor(scene, M) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.M = M;
    this.guns = {};
    for (const t of WEAPON_ORDER) {
      const g = buildGun(t, M);
      g.visible = false;
      const s = g.userData.sight, D = POSE[t].D, h = -THREE.MathUtils.degToRad(POSE[t].hold);
      // the whole gun is pitched down about the eye by the hold angle: sights stay aligned with the eye
      g.userData.ads = new THREE.Vector3(-s.x, -s.y, -D - s.z).applyAxisAngle(X_AXIS, h).toArray();
      g.userData.adsPitch = h;
      this.root.add(g);
      this.guns[t] = g;
    }
    this.nade = buildGrenade(M); this.nade.visible = false; this.root.add(this.nade);
    this.arms = new FPArms(M);
    this.root.add(this.arms.group);
    this.sp = new Spring3(); this.sr = new Spring3();
    this.anim = null;
    this.type = null;
    this.onEvent = () => {};
    this.v = new THREE.Vector3(); this.v2 = new THREE.Vector3();
    this.lh = { w: 0, p: new THREE.Vector3(), r: null };
    this.rh = { w: 0, p: new THREE.Vector3(), r: null };
    this.side = 1;
  }

  get gun() { return this.guns[this.type]; }
  get cls() { return WEAPONS[this.type]?.cls; }
  get busy() { return !!this.anim; }
  get animName() { return this.anim ? this.anim.name : null; }

  setWeapon(type) {
    this.type = type;
    for (const t of WEAPON_ORDER) this.guns[t].visible = t === type;
    const f = FEEL[type] || FEEL.rifle;
    this.sp.k = this.sr.k = f.k; this.sp.c = this.sr.c = f.c;
    this.sp.reset(); this.sr.reset();
    const hip = POSE[type].hip;
    this.gun.position.set(hip[0], hip[1] - 0.3, hip[2]); // never render a frame at the camera origin
    this.resetParts();
  }
  resetParts() {
    const d = this.gun.userData;
    if (d.slide) d.slide.position.x = 0;
    if (d.mag) { d.mag.position.set(0, 0, 0); d.mag.rotation.z = 0; d.mag.visible = true; }
    if (d.pump) d.pump.position.x = 0;
    if (d.charge) d.charge.position.x = 0;
    if (d.bolt) { d.bolt.position.x = 0; d.bolt.rotation.x = 0; }
    if (d.crane) d.crane.rotation.x = 0;
    if (d.shell) d.shell.visible = false;
    this.nade.visible = false;
  }

  // start an animation; dur in seconds. Events fire through onEvent(name, animName).
  play(name, dur, data = {}) {
    const A = ANIM[name];
    if (name === 'knife_light') { this.side = -this.side; data.side = this.side; }
    const ev = typeof A.ev === 'function' ? A.ev(data, this) : A.ev;
    this.anim = { name, A, t: 0, dur: Math.max(0.01, dur), data, ev, next: 0, hold: name === 'nade_hold' };
    this.resetParts();
  }
  stop() { this.anim = null; this.resetParts(); }

  kick(type, ads) {
    const f = FEEL[type] || FEEL.rifle, a = 1 - ads * 0.55, r = () => Math.random() * 2 - 1;
    this.sp.v.z += f.back * a;
    this.sp.v.y += f.up * a;
    this.sr.v.x += f.pitch * (1 - ads * 0.45);
    this.sr.v.y += r() * f.yaw * a;
    this.sr.v.z += r() * f.roll * a;
    this.cycleT = 0.07;
    if (this.gun.userData.cyl) this.cylRot = (this.cylRot || 0) + Math.PI / 3;
  }
  bump(pitch, back = 0) { this.sr.v.x += pitch; this.sp.v.z += back; }

  // st: { dt, time, ads, sprintK, bob, bobAmt, swayX, swayY, inertX, inertZ, crouchK, lean, block, land, alive, deathT, slideBack }
  update(dt, st) {
    this.sp.step(dt); this.sr.step(dt);
    // advance the animation and fire its events first: they may switch weapons or chain animations,
    // and the pose below must always be computed for whatever is current afterwards
    const an = this.anim;
    if (an) {
      an.t += dt;
      an.data.t = an.t;
      const u = an.hold ? 0.5 : Math.min(1, an.t / an.dur);
      while (this.anim === an && an.next < an.ev.length && an.ev[an.next][0] <= u) this.onEvent(an.ev[an.next++][1], an.name);
      if (this.anim === an && !an.hold && an.t >= an.dur) { this.anim = null; this.onEvent('done', an.name); }
    }
    const cur = this.anim;
    const pose = cur ? cur.A.f(cur.hold ? 0.5 : Math.min(1, cur.t / cur.dur), this, cur.data) : null;
    const g = this.gun, d = g.userData, type = this.type, P = POSE[type];
    const a = st.ads, sk = st.sprintK, bk = st.block, sway = 1 - a * 0.7, inert = 1 - a * 0.6;
    const bob = st.bob, bobAmt = st.bobAmt, dk = st.alive ? 0 : Math.min(1, st.deathT * 2);
    const ap = d.ads;
    const idle = Math.sin(st.time * 1.7) * 0.002 * (1 - a * 0.7);
    const pp = pose?.p || [0, 0, 0], pr = pose?.r || [0, 0, 0];
    const ka = 1 - a * 0.6; // recoil springs are softer on the sights
    g.position.set(
      lerp(P.hip[0], ap[0], a) + st.swayX * sway + Math.sin(bob) * 0.012 * bobAmt - 0.05 * sk + st.inertX * inert + pp[0] + this.sp.x.x * ka + st.lean * 0.015,
      lerp(P.hip[1], ap[1], a) + st.swayY * sway - Math.abs(Math.cos(bob)) * 0.012 * bobAmt - 0.04 * sk - 0.4 * dk + idle - st.land * 0.035 + pp[1] + this.sp.x.y * ka + 0.015 * bk,
      lerp(P.hip[2], ap[2], a) + 0.03 * sk + st.inertZ * inert + pp[2] + this.sp.x.z + 0.1 * bk,
    );
    g.rotation.set(
      this.sr.x.x * (1 - a * 0.3) - 0.42 * sk + st.swayY * 2 * sway + pr[0] + 0.3 * bk - 0.5 * dk + (d.adsPitch || 0) * a,
      st.swayX * 2.5 * sway + 0.62 * sk + (1 - a) * 0.03 + pr[1] + this.sr.x.y + 0.2 * bk,
      -st.swayX * 3 * sway + 0.18 * sk + 0.05 * st.crouchK * (1 - a) - st.inertX * 2 * inert + pr[2] + this.sr.x.z - st.lean * 0.12,
    );
    // animated parts
    this.cycleT = Math.max(0, (this.cycleT || 0) - dt);
    const cyc = this.cycleT > 0 ? Math.sin(Math.PI * (1 - this.cycleT / 0.07)) : 0;
    if (d.slide) d.slide.position.x = -Math.min(1, Math.max(cyc, st.slideBack ? 1 : 0, pose?.rack ?? 0)) * 0.028;
    if (d.mag) {
      const m = pose?.mag || 0, dir = d.magDir || [0, -1];
      d.mag.position.set(dir[0] * m, dir[1] * m, 0);
      d.mag.rotation.z = -(d.magRot || 0) * m;
      d.mag.visible = pose?.magVis ?? true;
    }
    if (d.charge) d.charge.position.x = -Math.max(pose?.rack || 0, type === 'rifle' ? cyc : 0) * (type === 'm4' ? 0.06 : 0.07);
    if (d.pump) d.pump.position.x = -(pose?.pump || 0) * 0.09;
    if (d.bolt) { d.bolt.rotation.x = -(pose?.boltRot || 0) * 1.1; d.bolt.position.x = -(pose?.boltPos || 0) * 0.075; }
    if (d.crane) d.crane.rotation.x = -(pose?.crane || 0) * 1.25;
    if (d.hammer) d.hammer.rotation.z = cyc * 0.5;
    if (d.cyl) d.cyl.rotation.x = damp(d.cyl.rotation.x, -(this.cylRot || 0), 30, dt);
    g.updateMatrixWorld(true);
    // hand targets
    this.lh.w = 0; this.rh.w = 0;
    if (pose?.lh) this.handTarget(this.lh, pose.lh, d);
    if (pose?.rh) this.handTarget(this.rh, pose.rh, d);
    if (d.shell) {
      d.shell.visible = !!pose?.shell;
      if (d.shell.visible) { d.shell.parent.updateMatrixWorld(true); d.shell.position.copy(d.shell.parent.worldToLocal(this.v.copy(this.lh.p))); }
    }
    this.arms.update(g, this.cls, { lh: this.lh, rh: this.rh });
    this.nade.visible = !!pose?.nade;
    if (this.nade.visible) {
      this.nade.position.copy(this.arms.lH.position).add(this.v.set(0.03, 0.03, -0.035).applyQuaternion(this.arms.lH.quaternion));
      this.nade.quaternion.copy(this.arms.lH.quaternion);
    }
  }

  handTarget(h, spec, d) {
    h.w = spec.w; h.r = spec.r || null;
    const v = h.p;
    if (spec.at === 'pos') v.set(spec.p[0], spec.p[1], spec.p[2]);
    else if (spec.at === 'mag' && d.mag) v.copy(d.magAnchor).applyMatrix4(d.mag.matrixWorld);
    else if (spec.at === 'mag' && d.crane) v.copy(d.magAnchor).applyMatrix4(d.crane.parent.matrixWorld);
    else if (spec.at === 'rack' && d.rack) v.copy(d.rack).applyMatrix4((d.charge || d.slide).matrixWorld);
    else if (spec.at === 'catch' && d.catchPt) v.copy(d.catchPt).applyMatrix4(d.mag.parent.matrixWorld);
    else if (spec.at === 'port' && d.port) { v.copy(d.port).applyMatrix4(d.pump.parent.matrixWorld); v.y -= spec.off || 0; v.x -= 0.02; }
    else if (spec.at === 'knob' && d.knob) v.copy(d.knob.position).applyMatrix4(d.bolt.matrixWorld);
    else h.w = 0;
  }

  // positions in viewmodel (camera) space
  muzzle(out) { return out.copy(this.gun.userData.muzzle).applyMatrix4(this.gun.matrixWorld); }
  ejectPort(out) { return out.copy(this.gun.userData.eject).applyMatrix4(this.gun.matrixWorld); }
  flashSize() { return this.gun.userData.suppressed ? 0.04 : POSE[this.type].flash; }
  // attachments on the first-person gun of a type (rebuilt only when they change)
  setAttachments(type, a) { const g = this.guns[type]; if (g && (g.userData.att | 0) !== (a | 0)) decorateGun(g, type, a, this.M); }
  laserPoint(out) { const d = this.gun?.userData; return d && d.laser ? out.copy(d.laser).applyMatrix4(this.gun.matrixWorld) : null; }
}

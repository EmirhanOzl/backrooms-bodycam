// BACKROOMS: BODYCAM — client
import * as THREE from 'three';
import { generateMap, CEIL, CRATE_H, VENDOR_H, raycast, rayInfo, lineOfSight, collide, hitNormal, findPath, cellCenter } from './shared/map.js';
import { WEAPONS, WEAPON_ORDER, GRENADE, MAX_NADES, dmgAt, zoneMul } from './shared/weapons.js';
import { PLAYER_R, EYE_STAND, EYE_CROUCH, HEAD_STAND, HEAD_CROUCH, HEAD_R, BODY_R, MAX_HP, MAX_ARMOR, F, RESPAWN_T, PROTECT_T } from './shared/core.js';
import { ATT, ATTACHMENTS, SHOP, VENDOR_R, magSize, reloadMul, fitsAtt, itemLabel, SUP_DMG, LASER_SPREAD } from './shared/items.js';
import { NADE_STEP, makeNade, stepNade, throwVelocity } from './shared/physics.js';
import { buildWorld, bakeMaterial } from './world.js';
import { gunMaterials, Soldier, mergedGunGeometry, mergedItemGeometry, prewarmModels } from './models.js';
import { Viewmodel, FEEL } from './viewmodel.js';
import { BodycamPost } from './post.js';
import { Particles, Decals, Tracers, MuzzleSprites, Shells, Motes, Lasers } from './effects.js';
import * as TX from './textures.js';
import { Sound } from './audio.js';
import { Net } from './net.js';
import { Hud, esc } from './hud.js';
import { Pad, BTN } from './gamepad.js';
import { shopIcons } from './icons.js';
import { settings, saveSettings, buildSettingsPanel, buildControls, keyLabel, ALT_KEYS } from './settings.js';
import { recordKill, recordDeath, recordMatch, addTime, saveCareer, careerHtml, resetCareer, randomTip } from './career.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const QUALITY = [{ scale: 0.6, msaa: 0, motes: 0 }, { scale: 0.85, msaa: 0, motes: 260 }, { scale: 1.0, msaa: 4, motes: 420 }];
const INTERP = 0.1;       // remote players are rendered this far in the past (snapshot interpolation)
const LOOKAHEAD = 0.03;   // remote events are scheduled on the audio clock slightly ahead for jitter-free rhythm
const LOCAL_LAT = 0.02;   // constant latency on our own gunshots keeps full-auto rhythm perfectly even at any fps
const STREAKS = { 2: 'ÇİFTE LEŞ', 3: 'ÜÇLÜ LEŞ', 5: 'DURDURULAMAZ', 7: 'EFSANEVİ', 10: 'SEVİYE 0\'IN KABUSU' };
const SLOT_ACTIONS = { slot1: 'primary', slot2: 'secondary', slot3: 'melee' };
const SLOT_ORDER = ['primary', 'secondary', 'melee'];
const SHELL_KIND = { pistol: 'pistol', smg: 'pistol', rifle: 'rifle', m4: 'rifle', sniper: 'rifle', shotgun: 'hull' };

function mkSlot(w, mag, res, a = 0) {
  const W = WEAPONS[w];
  return { w, a, mag: mag ?? (W.melee ? 0 : magSize(w, a)), res: res ?? W.reserve ?? 0, mode: W.modes[0], needsCycle: false };
}
const isInspect = (an) => an === 'inspect' || an === 'kn_inspect';
const slotMag = (s) => (WEAPONS[s.w].melee ? 1 : magSize(s.w, s.a));
// how an item lies on the carpet: height of its origin and tilt
const ITEM_REST = { weapon: [0.03, 0, Math.PI / 2], nade: [0, 0, 0], ammo: [0, 0, 0], med: [0, 0, 0], water: [0, 0, 0], armor: [0, 0, 0], cash: [0, 0, 0] };
const LAND_SOUND = { weapon: 'it_gun', ammo: 'it_box', med: 'it_soft', water: 'it_bottle', armor: 'it_soft', nade: 'gr_bounce', cash: 'it_cash' };

// ray vs crate box (axis-aligned approximation of the rotated crate); returns t or Infinity, sets rayCrate.ax
function rayCrate(o, d, cx, cz, tmax) {
  let t0 = 0, t1 = tmax, ax = -1;
  const slab = (oo, dd, lo, hi, a) => {
    if (Math.abs(dd) < 1e-8) return oo >= lo && oo <= hi;
    let ta = (lo - oo) / dd, tb = (hi - oo) / dd;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) { t0 = ta; ax = a; }
    if (tb < t1) t1 = tb;
    return t0 <= t1;
  };
  if (!slab(o.x, d.x, cx - 0.3, cx + 0.3, 0) || !slab(o.y, d.y, 0, CRATE_H, 1) || !slab(o.z, d.z, cz - 0.3, cz + 0.3, 2)) return Infinity;
  if (ax < 0 || t0 <= 0) return Infinity;
  rayCrate.ax = ax;
  return t0;
}

class Game {
  constructor() {
    this.canvas = $('view');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(1);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a2410);
    this.camera = new THREE.PerspectiveCamera(settings.fov, 16 / 9, 0.04, 70);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(70, 16 / 9, 0.01, 5);
    this.vmAmb = new THREE.AmbientLight(0xfff0d8, 1);
    this.vmDir = new THREE.DirectionalLight(0xfff4e0, 1.5);
    this.vmFlash = new THREE.PointLight(0xffb060, 0, 2.5, 2);
    this.vmFlash.position.set(0.05, -0.05, -0.6);
    this.vmScene.add(this.vmAmb, this.vmDir, this.vmFlash);

    this.flashlight = new THREE.SpotLight(0xfff1dc, 0, 34, 0.46, 0.6, 1.3);
    this.muzzleLight = new THREE.PointLight(0xffa850, 0, 14, 1.6);
    this.remoteLights = [0, 1].map(() => new THREE.PointLight(0xffa850, 0, 12, 1.6));
    this.boomLight = new THREE.PointLight(0xffa050, 0, 20, 1.4);
    // fixed pool of real spot lights for the two nearest remote flashlights (a fixed light count never recompiles shaders)
    this.remoteFlash = [0, 1].map(() => { const l = new THREE.SpotLight(0xfff1dc, 0, 26, 0.42, 0.6, 1.4); this.scene.add(l, l.target); return l; });
    this.scene.add(this.flashlight, this.flashlight.target, this.muzzleLight, this.boomLight, ...this.remoteLights);

    this.particles = new Particles(this.scene, 700);
    this.fire = new Particles(this.scene, 240, true);
    this.decals = new Decals(this.scene, 240);
    this.blood = new Decals(this.scene, 90, TX.bloodTexture(), 0xffffff);
    this.scorch = new Decals(this.scene, 12, TX.scorchTexture(), 0xffffff);
    this.tracers = new Tracers(this.scene);
    this.muzzles = new MuzzleSprites(this.scene, 10);
    this.vmMuzzle = new MuzzleSprites(this.vmScene, 3);
    this.shells = new Shells(this.vmScene);
    this.motes = new Motes(this.scene);
    this.lasers = new Lasers(this.scene, 8);
    this.sound = new Sound();
    this.hud = new Hud();
    this.hud.applyCrosshair(settings.xh);
    this.M = gunMaterials();
    this.vm = new Viewmodel(this.vmScene, this.M);
    this.vm.onEvent = (e, a) => this.onVmEvent(e, a);
    this.vm.root.visible = false;
    this.nadeGeo = mergedGunGeometry('nade').geo;

    this.keys = {};
    this.mouse = { l: false, r: false, dx: 0, dy: 0 };
    this.fresh = { l: false, r: false };
    this.locked = false;
    this.pad = new Pad();
    this.padPaused = false;
    this.state = 'boot';
    this.remotes = new Map();
    this.names = new Map();
    this.drops = new Map();
    this.corpses = [];
    this.nades = new Map();
    this.events = [];
    this.predHits = new Map();
    this.time = 0;
    this.srv = null; this.lastSnapT = null;
    this.cidSeq = 0;
    this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3(); this.v4 = new THREE.Vector3();
    this.fwd = new THREE.Vector3(); this.rgt = new THREE.Vector3(); this.upv = new THREE.Vector3(); this.dir = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.me = this.newMe();
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.frameCb = (t) => this.frame(t);
  }

  newMe() {
    return {
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, onGround: true,
      crouch: false, crouchK: 0, sprint: false, sprintK: 0, ads: 0, adsToggle: false, flash: false, alive: false,
      hp: MAX_HP, armor: 0, kills: 0, deaths: 0, hs: 0, streak: 0,
      inv: { primary: null, secondary: mkSlot('pistol'), melee: mkSlot('knife'), nades: 1 }, slot: 'secondary', pendingSlot: null,
      fireT: 0, burst: 0, reloading: false, cycling: false, slideBack: false, wantFire: false,
      bloom: 0, kickP: 0, kickY: 0, swayP: 0, swayYw: 0, trauma: 0, bob: 0, stepAcc: 0, roll: 0,
      swayX: 0, swayY: 0, deathT: 0, deathAt: 0, deathYaw: 0, killerPos: null, hurt: 0, beatT: 0, breathT: 0,
      lean: 0, leanOff: 0, shotIdx: 0, lastShotT: -9, land: 0, inertX: 0, inertZ: 0, block: 0,
      stamina: 1, exhausted: false, stamRegen: 0, breath: 1, holdBreath: false, fovPunch: 0,
      nadeHeld: false, cookT: 0, cooking: false, protectUntil: 0, cash: 0,
    };
  }
  cur() { return this.me.inv[this.me.slot]; }
  curType() { return this.cur().w; }

  // ------------------------------------------------------------------ boot / menu
  async boot() {
    this.applyQuality();
    this.loading(true, 'Kamera başlatılıyor…', 0.02);
    const soundP = this.sound.load((p) => this.loadProgress('Ses kütüphanesi sentezleniyor…', 0.05 + p * 0.6))
      .catch((e) => { console.warn('audio disabled', e); this.sound.ready = false; });
    await nextFrame();
    this.loadProgress('Seviye 0 üretiliyor, ışıklar pişiriliyor…', 0.2);
    await nextFrame();
    this.loadLevel((Math.random() * 1e9) | 0, 18);
    this.loadProgress('Modeller hazırlanıyor…', 0.4);
    await nextFrame();
    console.log('models ms', Math.round(prewarmModels()));
    await soundP;
    this.applyAudioSettings();
    this.loadProgress('Hazır', 1);
    this.enterMenu();
    await nextFrame();
    this.loading(false);
    this.last = performance.now();
    requestAnimationFrame(this.frameCb);
  }

  loading(on, text, p, cancel = false) {
    if (on && $('loading').classList.contains('hidden')) $('loadtip').textContent = randomTip();
    $('loading').classList.toggle('hidden', !on);
    $('loading').classList.toggle('fade', this.state !== 'boot');
    $('btnCancel').classList.toggle('hidden', !cancel);
    if (on) this.loadProgress(text, p);
  }
  loadProgress(text, p) {
    if (text) $('loadtext').textContent = text;
    if (p != null) $('loadfill').style.width = `${Math.round(p * 100)}%`;
  }

  enterMenu() {
    this.state = 'menu';
    this.hud.show(false);
    $('menu').classList.remove('hidden');
    $('pause').classList.add('hidden');
    $('stamp').classList.remove('hidden');
    this.hud.endScreen(null);
    this.vm.root.visible = false;
    this.flashlight.intensity = 0;
    this.buildAttract();
    if (document.pointerLockElement) document.exitPointerLock();
    this.sound.setHum?.(0.7);
  }

  // slow bodycam drift through the empty level behind the menu
  buildAttract() {
    const map = this.map, pts = [];
    let cell = (Math.random() * map.W * map.H) | 0;
    for (let i = 0; i < 8 && pts.length < 40; i++) {
      const goal = (Math.random() * map.W * map.H) | 0;
      const path = findPath(map, cell, goal);
      if (!path) continue;
      for (const c of path) {
        const [x, z] = cellCenter(map, c);
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(last.x - x, last.z - z) > 0.5) pts.push(new THREE.Vector3(x, 1.45, z));
      }
      cell = goal;
    }
    if (pts.length < 4) { pts.length = 0; const [x, z] = cellCenter(map, cell); for (let i = 0; i < 4; i++) pts.push(new THREE.Vector3(x + Math.cos(i * 1.6) * 1.2, 1.45, z + Math.sin(i * 1.6) * 1.2)); }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    this.attract = { curve, len: Math.max(1, curve.getLength()), u: 0, look: new THREE.Vector3() };
  }
  updateAttract(dt) {
    const A = this.attract, cam = this.camera;
    A.u += (dt * 1.05) / A.len;
    if (!(A.u < 0.98)) { this.buildAttract(); return; }
    A.curve.getPointAt(A.u, cam.position);
    A.curve.getPointAt(Math.min(1, A.u + 1.6 / A.len), this.v1);
    const t = this.time;
    cam.position.y = 1.45 + Math.abs(Math.sin(t * 2.1)) * 0.025;
    const yaw = Math.atan2(-(this.v1.x - cam.position.x), -(this.v1.z - cam.position.z));
    A.yaw = A.yaw == null ? yaw : A.yaw + angDiff(A.yaw, yaw) * (1 - Math.exp(-dt * 2.5));
    cam.rotation.set(-0.05 + Math.sin(t * 0.7) * 0.02, A.yaw + Math.sin(t * 0.45) * 0.06, Math.sin(t * 1.05) * 0.012);
    if (Math.abs(cam.fov - settings.fov) > 0.01) { cam.fov = settings.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    this.sound.listener(cam.position, this.v2.set(0, 0, -1).applyQuaternion(cam.quaternion), this.v3.set(0, 1, 0).applyQuaternion(cam.quaternion));
  }

  async start(mode) {
    if (this.starting) return;
    this.starting = true;
    this.sound.resume();
    this.sound.ui('ui_click', 0.5);
    this.loading(true, 'Bağlanılıyor…', 0.05);
    let net;
    try {
      net = mode === 'online' ? await Net.online(4000)
        : Net.offline({ bots: settings.bots + 1, difficulty: settings.diff, fragLimit: settings.frags, timeLimit: settings.time * 60, mode: settings.mode, light: settings.light }, !location.search.includes('noworker'));
    } catch {
      this.loadProgress('Sunucuya bağlanılamadı.', 0);
      setTimeout(() => this.loading(false), 1600);
      this.starting = false;
      return;
    }
    this.net = net;
    net.send({ t: 'join', name: settings.name });
    let welcome = null;
    const pending = [];
    for (let i = 0; i < 300 && !welcome && !net.closed; i++) {
      await new Promise((r) => setTimeout(r, 20));
      for (const m of net.poll()) { if (m.t === 'welcome') welcome = m; else if (welcome || m.t !== 'snap') pending.push(m); }
    }
    if (!welcome) { this.loadProgress('Sunucu yanıt vermedi.', 0); net.close(); setTimeout(() => this.loading(false), 1600); this.starting = false; return; }
    this.myId = welcome.id;
    this.mode = welcome.mode || 'ffa';
    this.myTeam = welcome.team ?? -1;
    this.teamScore = welcome.teamScore || [0, 0];
    this.fragLimit = welcome.fragLimit;
    this.timeLimit = welcome.timeLimit;
    this.tl = welcome.timeLimit; this.tlAt = this.time;
    this.srv = null; this.lastSnapT = null;
    this.loadProgress('Seviye 0\'a noclip yapılıyor…', 0.45);
    await nextFrame();
    this.loadLevel(welcome.seed, welcome.size, welcome.light);
    welcome.crates.forEach((o, i) => this.world.setCrateOpen(i, !!o, true));
    for (const d of welcome.drops) this.addDrop(d);
    this.me = this.newMe();
    this.me.cash = welcome.cash || 0;
    this.hud.cash(this.me.cash);
    this.setWeapon('secondary', true);
    this.hud.endScreen(null);
    this.hud.banner('');
    this.hud.death(false);
    for (const m of pending) this.onMsg(m);
    this.loadProgress('Işıklar ısınıyor…', 0.9);
    await nextFrame();
    this.warmup();
    this.state = 'game';
    this.starting = false;
    this.lostShown = false;
    $('menu').classList.add('hidden');
    this.hud.show(true);
    this.vm.root.visible = true;
    this.loading(false);
    this.sound.setHum?.(0.9);
    $('pause').classList.remove('hidden'); // hidden again once the pointer lock is granted
    this.padPaused = false; this.clickToResume = false;
    this.refreshPause(true);                 // offline: the match starts when the pointer lock is granted (or a gamepad is used)
    this.lock();
    this.sendT = 0; this.pingT = 0;
  }

  // Compile every shader the match can need now (hidden models, loot, lasers, flashlight beams...),
  // not the first time something shows up mid-fight.
  warmup() {
    const hidden = [];
    for (const sc of [this.scene, this.vmScene]) sc.traverse((o) => { if (!o.visible) { o.visible = true; hidden.push(o); } });
    const temp = new THREE.Group();
    const mat = bakeMaterial({ vertexColors: true, color: 0xffffff, shininess: 30, specular: 0x333333 }, { uniform: true, phong: true });
    temp.add(new THREE.Mesh(mergedItemGeometry('ammo'), mat), new THREE.Mesh(mergedGunGeometry('m4', 7).geo, mat));
    temp.position.set(this.map.size / 2, -5, this.map.size / 2);
    this.scene.add(temp);
    this.lasers.begin(); this.lasers.add(this.v1.set(0, -5, 0), this.v2.set(1, -5, 0), this.v1, 1); this.lasers.end();
    const t0 = performance.now();
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.vmScene, this.vmCamera);
    console.log('warmup ms', Math.round(performance.now() - t0));
    this.scene.remove(temp); mat.dispose();
    for (const o of hidden) o.visible = false;
    this.lasers.begin(); this.lasers.end();
  }

  quitToMenu() {
    saveCareer();
    if (this.net) this.net.close();
    this.net = null;
    for (const r of this.remotes.values()) this.scene.remove(r.model.root);
    this.remotes.clear(); this.names.clear(); this.events.length = 0;
    this.clearCorpses();
    for (const L of this.remoteFlash) L.intensity = 0;
    this.clearDrops(); this.clearNades(); this.closeShop(false);
    this.me = this.newMe();
    this.particles.clear(); this.fire.clear(); this.tracers.clear();
    $('score').classList.add('hidden');
    this.enterMenu();
  }

  // (Re)build the level for a seed; used at boot, at join and at every new match.
  loadLevel(seed, size, light = 'normal') {
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.group.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const k of ['map', 'bumpMap', 'lightMap']) m[k]?.dispose();
          m.dispose();
        }
      });
    }
    this.map = generateMap(seed, size, light);
    const t0 = performance.now();
    this.world = buildWorld(this.map, this.scene, this.renderer);
    console.log('world build ms', Math.round(performance.now() - t0));
    this.serial = 'X' + (seed >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 8);
    this.hud.clock(this.serial);
    this.decals.clear(); this.blood.clear(); this.scorch.clear();
    this.clearDrops(); this.clearNades(); this.closeShop(false); this.clearCorpses();
    this.nearCrate = -1; this.nearDrop = null; this.nearVendor = null;
    for (const r of this.remotes.values()) { r.buf.length = 0; }
  }

  applyQuality() {
    const q = QUALITY[settings.quality] || QUALITY[1];
    this.scale = q.scale;
    if (this.post) { this.post.rtScene.dispose(); this.post.rtA.dispose(); this.post.rtB.dispose(); }
    this.post = new BodycamPost(this.renderer, q.msaa);
    this.motes.points.visible = q.motes > 0;
    this.motes.points.geometry.setDrawRange(0, q.motes);
    this.resize();
  }
  applyAudioSettings() {
    this.sound.setVolumes({ master: settings.master, sfx: settings.sfx, amb: settings.amb, ui: settings.ui });
    this.sound.hrtf = settings.hrtf;
  }
  onSetting(k) {
    if (k === 'quality') this.applyQuality();
    if (k === 'xh') this.hud.applyCrosshair(settings.xh);
    if (['master', 'sfx', 'amb', 'ui', 'hrtf'].includes(k)) this.applyAudioSettings();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(320, Math.floor(innerWidth * dpr * (this.scale || 1)));
    const h = Math.max(180, Math.floor(innerHeight * dpr * (this.scale || 1)));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.vmCamera.aspect = w / h;
    this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
    this.updatePointScale();
  }
  updatePointScale() {
    const s = (this.post?.h || 720) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.particles.uniforms.uScale.value = this.fire.uniforms.uScale.value = this.motes.uniforms.uScale.value = s;
  }

  lock(onFail = () => this.refreshPause(true)) {
    if (this.state !== 'game' || this.locked) return;
    // newer Chrome returns a Promise that rejects during the post-ESC cooldown; older API returns void.
    // Raw (unaccelerated) input also avoids the occasional huge jump some mice report through the OS path.
    const c = this.canvas;
    const req = (opts) => { try { return Promise.resolve(opts ? c.requestPointerLock?.(opts) : c.requestPointerLock?.()); } catch (e) { return Promise.reject(e); } };
    req(settings.rawInput ? { unadjustedMovement: true } : null)
      .catch((e) => (e && e.name === 'NotSupportedError' ? req(null) : Promise.reject(e)))
      .catch(() => onFail());
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const resumeAudio = () => this.sound.resume();
    document.addEventListener('pointerdown', resumeAudio);
    document.addEventListener('keydown', resumeAudio);
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.mouse.l = this.mouse.r = false; this.keys = {}; this.me.nadeHeld = false; this.padPaused = false;
        if (!this.shopUnlock) this.pad.active = false;
      }
      this.shopUnlock = false;
      if (this.locked) this.clickToResume = false;
      if (this.locked && this.shop) this.closeShop(false); // clicked back into the game
      this.refreshPause(true);
    });
    document.addEventListener('pointerlockerror', () => { if (this.state === 'game') this.refreshPause(true); });
    document.addEventListener('visibilitychange', () => { if (this.state === 'game') this.net?.setPaused(document.hidden || this.isPaused()); });
    // Ctrl is crouch: guard against Ctrl+W closing the tab mid-match
    window.addEventListener('beforeunload', (e) => { saveCareer(); if (this.state === 'game' && !this.quitting) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('pagehide', () => saveCareer());
    this.canvas.addEventListener('click', () => this.lock());
    $('btnResume').onclick = () => { if (this.pad.active) { this.padPaused = false; this.refreshPause(); } else this.lock(); };
    $('btnQuit').onclick = () => { this.sound.ui('ui_click', 0.5); this.quitToMenu(); };
    $('btnPauseSettings').onclick = () => { $('settingsPause').appendChild($('settingsBox')); $('pauseMain').classList.add('hidden'); $('pauseSettings').classList.remove('hidden'); };
    $('btnPauseBack').onclick = () => this.showPauseMain();
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.state !== 'game') return;
      // drop the rare bogus jump some browsers / mice report (hundreds of pixels in one event out of nowhere)
      const mag = Math.abs(e.movementX) + Math.abs(e.movementY);
      const spike = mag > 300 && mag > (this.mouseAvg || 0) * 8 + 120;
      this.mouseAvg = (this.mouseAvg || 0) * 0.85 + Math.min(mag, 300) * 0.15;
      if (spike) return;
      const me = this.me;
      const zoom = this.camera.fov / settings.fov;
      const s = 0.0021 * settings.sens * zoom * (me.ads > 0.5 ? settings.adsSens : 1);
      me.yaw -= e.movementX * s;
      me.pitch = clamp(me.pitch - e.movementY * s * (settings.invertY ? -1 : 1), -1.45, 1.45);
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.l = true; this.fresh.l = true; }
      if (e.button === 2) { this.mouse.r = true; this.fresh.r = true; this.me.adsToggle = !this.me.adsToggle; }
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (!this.locked || this.state !== 'game' || this.shop) return;
      const me = this.me, owned = SLOT_ORDER.filter((s) => me.inv[s]);
      const i = owned.indexOf(me.pendingSlot || me.slot);
      this.equip(owned[(i + (e.deltaY > 0 ? 1 : -1) + owned.length) % owned.length]);
    });
    document.addEventListener('keydown', (e) => {
      if (this.state !== 'game') return;
      const act = this.actionOf(e.code);
      if (act === 'score' || e.code === 'Tab') e.preventDefault();
      if (act === 'score') { this.scoreOpen = true; this.renderScore(); return; }
      if (this.shop) { if (!e.repeat && this.shopKey(e.code, act)) e.preventDefault(); return; }
      if (!this.locked && this.clickToResume && e.code === 'Escape') { this.clickToResume = false; this.refreshPause(true); return; }
      if (!this.locked) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.ctrlKey || e.altKey) e.preventDefault();
      if (e.repeat) return;
      this.keys[e.code] = true;
      const me = this.me;
      if (!settings.holdCrouch && act === 'crouch') me.crouchToggle = !me.crouchToggle;
      if (!me.alive) return;
      if (act === 'reload') this.startReload();
      else if (act === 'use') this.interact();
      else if (act === 'flash') { me.flash = !me.flash; this.sound.ui('ui_click', 0.35); }
      else if (act === 'mode') this.cycleMode();
      else if (act === 'inspect') this.inspect();
      else if (act === 'nade') this.nadePress();
      else if (SLOT_ACTIONS[act]) this.equip(SLOT_ACTIONS[act]);
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      const act = this.actionOf(e.code);
      if (act === 'score') { this.scoreOpen = false; this.hud.scoreboard(false); }
      if (act === 'nade') this.me.nadeHeld = false;
    });
  }
  // key code -> action (player bindings plus fixed alternates like Ctrl for crouch)
  actionOf(code) {
    for (const a in settings.binds) if (settings.binds[a] === code) return a;
    for (const a in ALT_KEYS) if (ALT_KEYS[a].includes(code) && !Object.values(settings.binds).includes(code)) return a;
    return null;
  }
  down(a) { if (this.keys[settings.binds[a]]) return true; const alt = ALT_KEYS[a]; return !!alt && alt.some((c) => this.keys[c]); }
  // paused = no mouse lock and no gamepad in use, or paused from the gamepad's Menu button
  isPaused() { return this.state === 'game' && (this.padPaused || (!this.locked && !this.pad.active && !this.shop && !this.clickToResume)); }
  refreshPause(reset) {
    const paused = this.isPaused();
    const el = $('pause'), was = !el.classList.contains('hidden');
    el.classList.toggle('hidden', !paused);
    $('resume').classList.toggle('hidden', !(this.clickToResume && !this.locked && this.state === 'game'));
    if (paused && (!was || reset)) this.showPauseMain();
    if (paused) this.closeShop();
    this.net?.setPaused(paused);
  }
  fireHeld() { return this.mouse.l || this.padFire; }
  aimHeld() { return this.mouse.r || this.padAim; }

  updatePad(dt) {
    const P = this.pad, was = P.active;
    if (!P.poll()) { this.padMove = null; this.padFire = this.padAim = false; return; }
    const me = this.me;
    if (P.pressed(BTN.MENU)) { if (this.isPaused()) { this.padPaused = false; P.active = true; } else this.padPaused = true; }
    if (!was || P.pressed(BTN.MENU)) this.refreshPause();
    if (P.pressed(BTN.VIEW)) { this.scoreOpen = true; this.renderScore(); }
    if (P.released(BTN.VIEW)) { this.scoreOpen = false; this.hud.scoreboard(false); }
    if (this.isPaused()) { this.padMove = null; this.padFire = this.padAim = false; return; }
    this.padMove = [P.lx, P.ly];
    // look: quadratic response, scaled like the mouse on the sights, light friction over enemies
    const zoom = this.camera.fov / settings.fov, friction = this.aimOnFoe ? 0.6 : 1;
    const k = settings.sens * zoom * (me.ads > 0.5 ? settings.adsSens : 1) * friction;
    const cx = Math.sign(P.rx) * P.rx * P.rx, cy = Math.sign(P.ry) * P.ry * P.ry;
    if (me.alive) {
      me.yaw -= cx * 3.4 * k * dt;
      me.pitch = clamp(me.pitch - cy * 2.4 * k * dt * (settings.invertY ? -1 : 1), -1.45, 1.45);
    }
    this.mouse.dx += cx * 900 * dt * k; this.mouse.dy += cy * 700 * dt * k; // weapon sway follows the stick
    const fire = P.rt > 0.5, aim = P.lt > 0.4;
    if (fire && !this.padFire) this.fresh.l = true;
    if (aim && !this.padAim) { this.fresh.r = true; me.adsToggle = !me.adsToggle; }
    this.padFire = fire; this.padAim = aim;
    if (P.pressed(BTN.A)) this.padJump = true;
    if (P.pressed(BTN.B) && !this.shop) me.padCrouch = !me.padCrouch;
    if (P.pressed(BTN.L3)) me.padSprint = !me.padSprint;
    this.padLean = (P.down[BTN.RIGHT] ? 1 : 0) - (P.down[BTN.LEFT] ? 1 : 0);
    if (!me.alive) return;
    if (this.shop) {
      this.padJump = false;
      if (P.pressed(BTN.UP)) this.shopMove(-1);
      if (P.pressed(BTN.DOWN)) this.shopMove(1);
      if (P.pressed(BTN.A)) this.buySelected();
      if (P.pressed(BTN.B) || P.pressed(BTN.X)) this.closeShop();
      return;
    }
    if (P.pressed(BTN.X)) { if (this.nearDrop || this.nearCrate >= 0 || this.nearVendor) this.interact(); else this.startReload(); }
    if (P.pressed(BTN.Y)) this.equip(me.slot === 'primary' || !me.inv.primary ? 'secondary' : 'primary');
    if (P.pressed(BTN.LB)) this.equip(me.slot === 'melee' ? (me.inv.primary ? 'primary' : 'secondary') : 'melee');
    if (P.pressed(BTN.RB)) this.nadePress();
    if (P.released(BTN.RB)) me.nadeHeld = false;
    if (P.pressed(BTN.R3)) this.inspect();
    if (P.pressed(BTN.UP)) { me.flash = !me.flash; this.sound.ui('ui_click', 0.35); }
    if (P.pressed(BTN.DOWN)) this.cycleMode();
  }

  showPauseMain() {
    $('pauseMain').classList.remove('hidden'); $('pauseSettings').classList.add('hidden');
  }

  // ------------------------------------------------------------------ inventory & weapon states
  setWeapon(slot, instant) {
    const me = this.me;
    me.slot = slot; me.pendingSlot = null;
    me.reloading = false; me.cycling = false; me.burst = 0; me.slideBack = false;
    const type = this.curType();
    this.vm.setAttachments(type, this.cur().a);
    this.vm.setWeapon(type);
    me.slideBack = type === 'pistol' && this.cur().mag === 0;
    if (!instant) this.vm.play('draw', WEAPONS[type].draw);
  }
  equip(slot) {
    const me = this.me;
    if (!me.alive || !slot || !me.inv[slot]) return;
    if (slot === (me.pendingSlot || me.slot)) return;
    const an = this.vm.animName;
    if (an && an.startsWith('nade')) return;
    me.pendingSlot = slot; me.reloading = false; me.cycling = false; me.burst = 0;
    this.vm.play('holster', 0.15);
  }
  canAct() {
    const an = this.vm.animName;
    return this.me.alive && (!an || isInspect(an));
  }
  startReload() {
    const me = this.me, s = this.cur(), w = WEAPONS[s.w];
    if (!me.alive || w.melee || me.reloading || !this.canAct() || s.res <= 0) return;
    const cap = slotMag(s) + (w.chamber && s.mag > 0 ? 1 : 0);
    if (s.mag >= cap) return;
    if (this.vm.animName === 'inspect') this.vm.stop();
    me.reloading = true; me.burst = 0; me.wantFire = false;
    const mul = reloadMul(s.a);
    if (w.shell) { if (s.mag === 0) s.needsCycle = true; this.vm.play('sg_start', w.shell.start); }
    else if (w.cls === 'revolver') this.vm.play('revolver', w.reload);
    else {
      const empty = s.mag === 0;
      if (empty && w.cls === 'bolt') s.needsCycle = true;
      this.vm.play('reload', (empty ? w.reloadEmpty : w.reload) * mul, { empty: empty && w.cls !== 'bolt' });
    }
  }
  cycleMode() {
    const s = this.cur(), modes = WEAPONS[s.w].modes;
    if (modes.length < 2) return;
    s.mode = modes[(modes.indexOf(s.mode) + 1) % modes.length];
    this.sound.mech('mode', 0.5);
    this.hud.toast(`ATIŞ MODU: ${{ auto: 'OTOMATİK', burst: '3\'LÜ', semi: 'TEK' }[s.mode]}`);
  }
  inspect() {
    if (!this.canAct() || this.vm.animName || this.me.ads > 0.2) return;
    if (this.vm.cls === 'knife') this.vm.play('kn_inspect', 2.8); else this.vm.play('inspect', 2.3);
  }

  nadePress() {
    const me = this.me;
    me.nadeHeld = true;
    if (me.inv.nades <= 0 || !me.alive) { if (me.inv.nades <= 0) this.hud.toast('EL BOMBASI YOK', 'bad'); return; }
    const an = this.vm.animName;
    if (an && !isInspect(an) && an !== 'reload' && an !== 'sg_start' && an !== 'sg_insert' && an !== 'revolver') return;
    me.reloading = false; me.burst = 0; me.cooking = false; me.cookT = 0;
    this.vm.play('nade_pull', 0.36);
  }
  throwNade() {
    const me = this.me;
    const cook = me.cooking ? me.cookT : 0;
    me.cooking = false;
    if (me.inv.nades <= 0) return;
    me.inv.nades--;
    me.protectUntil = 0;
    const o = this.eyePos(new THREE.Vector3());
    const d = this.v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const v = throwVelocity([d.x, d.y, d.z], GRENADE.speed, [me.vel.x, me.vel.z]);
    const cid = ++this.cidSeq;
    this.net.send({ t: 'nade', o: [o.x, o.y, o.z], v, cook, cid });
    if (GRENADE.fuse - cook > 0.05) this.addNade('c' + cid, { o: [o.x, o.y, o.z], v, fuse: GRENADE.fuse - cook, by: this.myId, elapsed: 0 });
  }

  interact() {
    const me = this.me;
    if (!me.alive) return;
    if (this.shop) { this.closeShop(); return; }
    if (this.time - (this.lastUse || 0) < 0.3) return;
    this.lastUse = this.time;
    const d = this.nearDrop;
    if (d) {
      if (d.k !== 'weapon' && !this.useful(d)) { this.hud.toast(this.fullText(d), 'bad'); this.sound.ui('ui_nope', 0.4); return; }
      this.net.send({ t: 'pickup', id: d.id });
      return;
    }
    if (this.nearCrate >= 0) { this.net.send({ t: 'open', id: this.nearCrate }); return; }
    if (this.nearVendor) this.openShop(this.nearVendor);
  }
  // would a consumable do anything for us right now?
  useful(d) {
    const me = this.me;
    switch (d.k) {
      case 'ammo': return ['primary', 'secondary'].some((k) => me.inv[k] && me.inv[k].res < WEAPONS[me.inv[k].w].maxReserve);
      case 'nade': return me.inv.nades < MAX_NADES;
      case 'med': case 'water': return me.hp < MAX_HP;
      case 'armor': return me.armor < MAX_ARMOR;
      default: return true;
    }
  }
  fullText(d) { return { ammo: 'MERMİN DOLU', nade: 'EN FAZLA 2 EL BOMBASI', med: 'SAĞLIĞIN DOLU', water: 'SAĞLIĞIN DOLU', armor: 'ZIRHIN DOLU' }[d.k] || ''; }

  // ------------------------------------------------------------------ vending machine
  // The machine menu frees the mouse cursor: goods are clicked. The match keeps running (it is not a pause).
  openShop(v) {
    this.shop = { v, sel: this.shop?.sel ?? 0, flash: -1 };
    const me = this.me;
    me.adsToggle = false; me.nadeHeld = false; this.mouse.l = this.mouse.r = false;
    this.sound.ui('ui_click', 0.4);
    if (this.locked) { this.shopUnlock = true; document.exitPointerLock(); }
    this.renderShop();
  }
  // relock: called from a click / key press, so the pointer can be captured again right away
  closeShop(relock = true) {
    if (!this.shop) return;
    this.shop = null;
    this.hud.shop(null);
    this.sound.ui('ui_click', 0.3);
    if (relock && !this.locked && !this.pad.active && this.state === 'game') this.lock(); // refreshes on pointerlockchange / error
    else this.refreshPause();
  }
  // Esc cannot re-capture the mouse by itself (browsers only allow that from a click or a normal key), so the
  // match simply goes on with a small "click to continue" note instead of the pause menu.
  closeShopToGame() {
    if (!this.shop) return;
    this.clickToResume = !this.pad.active && this.state === 'game';
    this.closeShop(false);
    if (this.clickToResume) this.lock(() => this.refreshPause());
  }
  shopMove(dir) {
    if (!this.shop) return;
    this.shop.sel = (this.shop.sel + dir + SHOP.length) % SHOP.length;
    this.sound.ui('ui_hover', 0.3);
    this.renderShop();
  }
  shopKey(code, act) {
    if (code === 'ArrowUp' || code === 'ArrowLeft') { this.shopMove(-1); return true; }
    if (code === 'ArrowDown' || code === 'ArrowRight') { this.shopMove(1); return true; }
    if (code === 'Enter' || code === 'NumpadEnter') { this.buyIndex(this.shop.sel); return true; }
    const n = /^(Digit|Numpad)(\d)$/.exec(code);
    if (n) { const i = (+n[2] + 9) % 10; if (i < SHOP.length) this.buyIndex(i); return true; }
    if (code === 'Escape') { this.closeShopToGame(); return true; }
    if (act === 'use' || code === 'Backspace') { this.closeShop(); return true; }
    return false;
  }
  // why an item can't be bought right now ('' = it can)
  shopBlock(it) {
    const me = this.me;
    if (me.cash < it.price) return 'PARA YETMİYOR';
    if (it.k === 'att') {
      const s = this.cur();
      if (WEAPONS[s.w].melee) return 'ELİNDE SİLAH YOK';
      if (!fitsAtt(s.w, it.a)) return `${WEAPONS[s.w].short} İÇİN YOK`;
      if ((s.a | 0) & it.a) return 'ZATEN TAKILI';
    }
    if (it.k === 'weapon') { const held = me.inv[WEAPONS[it.w].slot]; if (held && held.w === it.w) return 'ZATEN SENDE'; }
    return '';
  }
  buySelected() { if (this.shop) this.buyIndex(this.shop.sel); }
  buyIndex(i) {
    if (!this.shop || !SHOP[i]) return;
    this.shop.sel = i;
    const it = SHOP[i], why = this.shopBlock(it);
    if (why) { this.hud.toast(why, 'bad'); this.sound.ui('ui_nope', 0.4); this.renderShop(); return; }
    if (this.time - (this.lastBuy || 0) < 0.25) return;
    this.lastBuy = this.time;
    this.shop.flash = i;
    this.net.send({ t: 'buy', id: it.id, v: this.shop.v.id, w: this.curType() });
    this.renderShop();
    this.shop.flash = -1;
  }
  renderShop() {
    if (!this.shop) return;
    this.shopIcons ||= shopIcons(this.renderer, SHOP);
    const items = SHOP.map((it, i) => ({ ...it, i, why: this.shopBlock(it), desc: it.k === 'att' ? ATTACHMENTS.find((x) => x.bit === it.a)?.desc : '' }));
    this.hud.shop({ items, sel: this.shop.sel, flash: this.shop.flash, cash: this.me.cash, weapon: WEAPONS[this.curType()].short, pad: this.pad.active && !this.locked, icons: this.shopIcons }, this.shopHandlers ||= {
      buy: (i) => this.buyIndex(i),
      close: () => this.closeShop(),
      hover: () => this.sound.ui('ui_hover', 0.2),
    });
  }

  onVmEvent(e, anim) {
    const me = this.me, s = this.cur(), w = WEAPONS[s.w];
    if (e.startsWith('snd:')) { this.sound.mech(e.slice(4), 0.55); return; }
    switch (e) {
      case 'draw':
        if (w.cls === 'knife') this.sound.mech('kn_draw', 0.45);
        else this.sound.mech(w.slot === 'primary' ? 'deploy_heavy' : 'deploy_light', 0.5);
        return;
      case 'ammo':
        if (anim === 'sg_insert') { if (s.res > 0 && s.mag < slotMag(s)) { s.mag++; s.res--; } return; }
        {
          const cap = slotMag(s) + (w.chamber && s.mag > 0 ? 1 : 0), take = Math.min(cap - s.mag, s.res);
          s.mag += take; s.res -= take;
          me.slideBack = false;
        }
        return;
      case 'shell': {
        this.shells.eject(this.vm.ejectPort(this.v2), SHELL_KIND[s.w] || 'rifle');
        this.sound.play(s.w === 'shotgun' ? 'sh_hull' : 'sh_brass', { cat: 'mech', vol: 0.16, when: this.sound.now() + 0.45 + Math.random() * 0.15 });
        return;
      }
      case 'eject6':
        for (let i = 0; i < 6; i++) this.shells.eject(this.vm.ejectPort(this.v2).add(this.v3.set((Math.random() - 0.5) * 0.02, 0, 0)), 'pistol', -0.4);
        return;
      case 'hit': this.knifeHit(anim === 'knife_heavy'); return;
      case 'release': this.throwNade(); return;
      case 'done': this.onAnimDone(anim); return;
    }
  }
  onAnimDone(anim) {
    const me = this.me, s = this.cur(), w = WEAPONS[s.w];
    switch (anim) {
      case 'holster':
        if (me.pendingSlot) this.setWeapon(me.pendingSlot);
        return;
      case 'draw':
        if (s.needsCycle && s.mag > 0) { me.cycling = true; this.vm.play(w.cls === 'bolt' ? 'bolt' : 'pump', w.cycle); }
        return;
      case 'reload': case 'revolver':
        me.reloading = false;
        if (s.needsCycle && s.mag > 0) { me.cycling = true; this.vm.play('bolt', w.cycle); }
        return;
      case 'sg_start': case 'sg_insert':
        if (s.mag < slotMag(s) && s.res > 0 && !(me.wantFire && s.mag > 0)) this.vm.play('sg_insert', w.shell.per);
        else this.vm.play('sg_end', w.shell.end);
        return;
      case 'sg_end':
        me.reloading = false; me.wantFire = false;
        if (s.needsCycle && s.mag > 0) { me.cycling = true; this.vm.play('pump', w.cycle); }
        return;
      case 'pump': case 'bolt':
        me.cycling = false; s.needsCycle = false;
        return;
      case 'nade_pull':
        if (me.nadeHeld) { me.cooking = true; me.cookT = 0; this.vm.play('nade_hold', 1); } else this.vm.play('nade_throw', 0.45);
        return;
      case 'nade_throw': case 'inspect':
        // a throw may have interrupted a pump / bolt cycle: chamber a round before the gun is usable again
        if (s.needsCycle && s.mag > 0 && w.cycle) { me.cycling = true; this.vm.play(w.cls === 'bolt' ? 'bolt' : 'pump', w.cycle); }
        return;
    }
  }

  // ------------------------------------------------------------------ messages
  // Server clock estimate, anchored to the newest snapshot (robust to tick/frame hitches and tab throttling)
  serverNow() { return this.srv ?? 0; }
  updateClock(dt) {
    if (this.lastSnapT == null) return;
    const est = this.lastSnapT + Math.min(0.25, performance.now() / 1000 - this.lastSnapAt);
    if (this.srv == null || Math.abs(est - this.srv) > 0.5) this.srv = est;
    else this.srv += dt + (est - this.srv) * Math.min(1, dt * 5);
  }
  schedule(ts, fn) {
    const due = ts + INTERP;
    this.events.push({ due, fn });
  }

  onMsg(m) {
    const me = this.me;
    switch (m.t) {
      case 'roster': {
        const ids = new Set();
        for (const p of m.list) {
          ids.add(p.id);
          this.names.set(p.id, p);
          if (p.id === this.myId) { this.myTeam = p.team ?? -1; continue; }
          if (this.remotes.has(p.id)) continue;
          const model = new Soldier(p.color, 'pistol');
          model.root.visible = false;
          this.scene.add(model.root);
          this.remotes.set(p.id, { id: p.id, model, buf: [], x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, stepAcc: 0, flags: 0, w: 0, alive: false, kills: 0, deaths: 0, hs: 0, hp: 100, ar: 0, lean: 0 });
        }
        for (const r of this.remotes.values()) r.model.setFriendly(this.isFriend(r.id));
        for (const [id, r] of this.remotes) if (!ids.has(id)) { this.scene.remove(r.model.root); this.remotes.delete(id); }
        return;
      }
      case 'snap': {
        if (this.lastSnapT == null || m.st >= this.lastSnapT) { this.lastSnapT = m.st; this.lastSnapAt = performance.now() / 1000; }
        this.tl = m.tl; this.tlAt = this.time;
        if (m.ts) this.teamScore = m.ts;
        for (const s of m.ps) {
          const [id, x, y, z, yaw, pitch, f, w, hp, ar, k, d, hs, att] = s;
          if (id === this.myId) {
            me.kills = k; me.deaths = d; me.hs = hs;
            if (me.alive) { me.hp = hp; me.armor = ar; }
            continue;
          }
          const r = this.remotes.get(id);
          if (!r) continue;
          r.kills = k; r.deaths = d; r.hs = hs; r.ar = ar; r.att = att | 0;
          if (r.buf.length && hp < r.buf[r.buf.length - 1].hp && f & F.ALIVE) r.model.flinch(Math.min(1, (r.buf[r.buf.length - 1].hp - hp) / 40));
          r.buf.push({ t: m.st, x, y, z, yaw, pitch, f, w, hp });
          if (r.buf.length > 40) r.buf.shift();
        }
        return;
      }
      case 'spawn':
        me.pos.set(m.x, 0, m.z); me.vel.set(0, 0, 0); me.vy = 0;
        me.yaw = m.yaw; me.pitch = 0; me.alive = true; me.hp = MAX_HP; me.armor = 0; me.deathT = 0; me.hurt = 0;
        me.kickP = me.kickY = 0; me.stamina = 1; me.exhausted = false; me.breath = 1; me.ads = 0; me.adsToggle = false; me.streak = 0;
        me.protectUntil = this.time + PROTECT_T; me.nadeHeld = false; me.cooking = false;
        if (m.cash != null) { me.cash = m.cash; this.hud.cash(me.cash); }
        this.closeShop(false); me.dp = null;
        me.inv = { primary: m.inv?.p ? mkSlot(m.inv.p) : null, secondary: mkSlot(m.inv?.s || 'pistol'), melee: mkSlot('knife'), nades: m.inv?.n ?? 1 };
        this.vm.stop();
        this.setWeapon(me.inv.primary ? 'primary' : 'secondary');
        this.hud.death(false);
        this.sound.ui('ui_beep', 0.4);
        return;
      case 'shot': this.schedule(m.ts, (when) => this.remoteShot(m, when)); return;
      case 'swing': this.schedule(m.ts, (when) => {
        const r = this.remotes.get(m.id);
        if (!r || !r.model.root.visible) return;
        r.model.action(m.h ? 'heavy' : 'swing');
        this.sound.play(m.h ? 'kn_heavy' : 'kn_swing', { cat: 'mech', pos: this.v1.set(r.x, r.y + 1.3, r.z), vol: 0.6, ref: 1.5, when, occl: this.occluded(this.v1) });
      }); return;
      case 'nade': {
        const local = m.by === this.myId && this.nades.get('c' + m.cid);
        if (local) { this.nades.delete('c' + m.cid); local.id = m.id; this.nades.set(m.id, local); return; }
        const r = this.remotes.get(m.by);
        if (r) r.model.action('throw');
        this.addNade(m.id, { o: m.o, v: m.v, fuse: m.fuse, by: m.by, elapsed: Math.max(0, this.serverNow() - m.ts) });
        return;
      }
      case 'boom': {
        const n = this.nades.get(m.id);
        if (n) this.removeNade(m.id);
        this.explosion(this.v4.set(m.p[0], m.p[1], m.p[2]));
        return;
      }
      case 'hurt': this.onHurt(m); return;
      case 'hit': {
        const pred = this.predHits.get(m.id);
        const predicted = pred != null && this.time - pred < 0.6;
        if (m.kill) {
          const h = m.zone === 'h';
          if (settings.hitmarks) this.hud.hitmarker(h ? 'killh' : 'kill');
          this.sound.ui(h ? 'ui_killhs' : 'ui_kill', 0.7);
        } else if (!predicted) {
          if (settings.hitmarks) this.hud.hitmarker(m.plate ? 'plate' : m.zone === 'h' ? 'h' : 'b');
          this.sound.ui(m.zone === 'h' ? 'ui_head' : m.plate ? 'ui_armor' : 'ui_hit', 0.5);
        }
        return;
      }
      case 'kill': this.onKill(m); return;
      case 'crate': {
        this.world.setCrateOpen(m.id, !!m.open);
        const c = this.map.crates[m.id];
        if (m.open) {
          if (m.by === this.myId) this.sound.ui('ui_crate', 0.6);
          else this.sound.play('ui_crate', { cat: 'misc', pos: this.v1.set(c.x, 0.3, c.z), vol: 0.8, ref: 2, occl: this.occluded(this.v1) });
        }
        return;
      }
      case 'loot': this.applyLoot(m); return;
      case 'got': {
        const W = WEAPONS[m.w], a = m.a | 0;
        this.sound.ui('ui_pickup', 0.6);
        if (m.ammo) {
          const s = me.inv[m.slot];
          if (s) {
            s.res = Math.min(W.maxReserve, s.res + W.mag);
            this.hud.toast(`+${W.mag} ${W.short} MERMİSİ`);
            if (a !== (s.a | 0)) { s.a = a; if (me.slot === m.slot) this.vm.setAttachments(s.w, a); }
          }
          return;
        }
        me.inv[m.slot] = mkSlot(m.w, magSize(m.w, a), W.mag, a);
        this.hud.toast(`+ ${W.label}${a ? ' · ' + ATTACHMENTS.filter((x) => a & x.bit).map((x) => x.label).join(' · ') : ''}`);
        if (me.slot === m.slot) { this.vm.stop(); this.setWeapon(m.slot); } else this.equip(m.slot);
        return;
      }
      case 'cash': {
        me.cash = m.cash;
        this.hud.cash(me.cash, m.add);
        if (m.lines) { this.hud.payout(m.lines, m.add); this.sound.ui('ui_cash', 0.55, this.sound.now() + 0.18); }
        this.renderShop();
        return;
      }
      case 'att': {
        me.cash = m.cash; this.hud.cash(me.cash);
        for (const k of ['primary', 'secondary']) {
          const s = me.inv[k];
          if (!s || s.w !== m.w) continue;
          s.a = m.a;
          if (me.slot === k) this.vm.setAttachments(s.w, s.a);
        }
        const A = ATTACHMENTS.filter((x) => m.a & x.bit).map((x) => x.label);
        this.hud.toast(`${WEAPONS[m.w].short}: ${A.join(' · ')}`, 'kill');
        this.sound.mech('att_on', 0.6);
        if (!this.vm.animName && me.ads < 0.2) this.inspect();
        this.renderShop();
        return;
      }
      case 'nobuy':
        this.hud.toast(m.why === 'cash' ? 'PARA YETMİYOR' : m.why === 'has' ? 'ZATEN TAKILI' : 'BU SİLAHA UYMUYOR', 'bad');
        this.sound.ui('ui_nope', 0.4);
        return;
      case 'vend': {
        const v = this.map.vendors[m.v];
        if (!v) return;
        const p = this.v1.set(v.x + v.nx * 0.4, 0.5, v.z + v.nz * 0.4);
        this.sound.play('vend', { cat: 'misc', pos: p, vol: m.by === this.myId ? 0.8 : 0.6, ref: 2, occl: this.occluded(p) });
        return;
      }
      case 'drop': this.addDrop(m.d); return;
      case 'undrop': this.removeDrop(m.id); return;
      case 'match':
        this.endData = m; this.endAt = this.time;
        this.hud.endScreen(m, this.myId, this.myTeam);
        recordMatch(m.mode === 'tdm' ? m.winnerTeam === this.myTeam : m.winner === this.myId, m.table.find((r) => r.id === this.myId));
        this.sound.ui('ui_end', 0.6);
        me.ads = 0;
        return;
      case 'reset':
        this.endData = null;
        this.hud.endScreen(null);
        this.hud.banner('');
        this.fragLimit = m.fragLimit ?? this.fragLimit; this.timeLimit = m.timeLimit ?? this.timeLimit;
        this.loadLevel(m.seed, m.size, m.light);
        this.warmup();
        this.hud.toast('YENİ SEVİYE');
        return;
      case 'pong': this.ping = Math.round(performance.now() - m.c); return;
    }
  }

  applyLoot(m) {
    const me = this.me, L = m.loot;
    if (m.cash != null) { const add = m.cash - me.cash; me.cash = m.cash; this.hud.cash(me.cash, add > 0 ? add : 0); }
    if (L.k === 'cash') { this.sound.ui('ui_cash', 0.45); this.hud.toast(`+$${L.v}`, 'cash'); this.renderShop(); return; }
    this.sound.ui('ui_pickup', 0.55);
    if (L.k === 'ammo') {
      const owned = ['primary', 'secondary'].filter((s) => me.inv[s]);
      owned.sort((a, b) => me.inv[a].res / WEAPONS[me.inv[a].w].maxReserve - me.inv[b].res / WEAPONS[me.inv[b].w].maxReserve);
      const curOk = me.slot !== 'melee' && me.inv[me.slot].res < WEAPONS[me.inv[me.slot].w].maxReserve * 0.6;
      const s = me.inv[curOk ? me.slot : owned[0]], W = WEAPONS[s.w], add = Math.ceil(slotMag(s) * 1.5);
      s.res = Math.min(W.maxReserve, s.res + add);
      this.hud.toast(`+${add} ${W.short} MERMİSİ`);
    } else if (L.k === 'nade') { me.inv.nades = L.n; this.hud.toast(`+ ${GRENADE.label}`); }
    else if (L.k === 'med') { me.hp = m.hp; this.hud.toast(`+${L.v} SAĞLIK · İLK YARDIM`); }
    else if (L.k === 'water') { me.hp = m.hp; this.hud.toast(`+${L.v} SAĞLIK · BADEM SUYU`); this.sound.play('it_bottle', { cat: 'ui', vol: 0.3 }); }
    else if (L.k === 'armor') { me.armor = m.armor; this.hud.toast(`+${L.v} ZIRH · PLAKA`); }
  }

  onHurt(m) {
    const me = this.me;
    me.hp = m.hp; me.armor = m.armor; me.hurtAt = this.time;
    const head = m.zone === 'h';
    me.hurt = Math.min(1, me.hurt + m.dmg / (head ? 22 : 35));
    me.trauma = Math.min(1, me.trauma + 0.25 + m.dmg / 120 + (head ? 0.3 : 0));
    const dx = m.from[0] - me.pos.x, dz = m.from[1] - me.pos.z;
    const rel = angDiff(me.yaw, Math.atan2(-dx, -dz));
    me.kickP += (head ? 0.06 : 0.025) * (0.6 + Math.random() * 0.6);
    me.kickY += Math.sin(rel) * -0.03 + (Math.random() - 0.5) * 0.02;
    if (m.zone !== 'x') this.sound.hurt(m.zone, m.dmg);
    else this.sound.ui('hurt', 0.8);
    if (m.by !== this.myId) this.hud.damage(rel, m.dmg);
    this.pad.rumble(0.35 + m.dmg / 80, 0.3, 140 + m.dmg * 3);
    this.post.final.uniforms.uFlash.value = Math.max(this.post.final.uniforms.uFlash.value, head ? 0.25 : 0);
  }

  isFriend(id) { return this.mode === 'tdm' && id !== this.myId && this.names.get(id)?.team === this.myTeam; }

  onKill(m) {
    const me = this.me;
    if (m.ts) this.teamScore = m.ts;
    const zone = m.z, kn = this.names.get(m.k)?.name || '?', vn = this.names.get(m.v)?.name || '?';
    this.hud.feed(m.k, m.v, m.w, zone, this.myId, this.names, this.mode === 'tdm' ? this.myTeam : null);
    if (m.v === this.myId) {
      me.alive = false; me.deathAt = this.time; me.hp = 0; me.ads = 0; me.nadeHeld = false; me.cooking = false; me.reloading = false;
      this.closeShop(false);
      me.deathYaw = me.yaw;
      me.killerPos = m.k !== m.v ? m.kp : null;
      // the body camera goes where the body goes
      const im = m.im || [0, 0, 0];
      me.dp = { x: me.pos.x, y: me.pos.y + lerp(EYE_STAND, EYE_CROUCH, me.crouchK), z: me.pos.z, vx: im[0] * 0.8, vy: im[1] * 0.6, vz: im[2] * 0.8, spin: Math.hypot(im[0], im[2]) * 0.25 };
      this.vm.stop();
      const dist = m.kp ? Math.round(Math.hypot(m.kp[0] - me.pos.x, m.kp[1] - me.pos.z)) : 0;
      const wl = m.w === 'nade' ? GRENADE.label : WEAPONS[m.w]?.label || m.w;
      const tag = zone === 'h' ? ' · KAFADAN' : zone === 'back' ? ' · SIRTTAN' : '';
      this.hud.death(true, m.k === m.v ? 'Kendini öldürdün.' : `${kn} seni indirdi.`, m.k === m.v ? wl : `${wl} · ${dist} m${tag}`);
      this.sound.ui('death', 0.7);
    } else {
      const r = this.remotes.get(m.v);
      if (r) this.spawnCorpse(r, m);
    }
    if (m.v === this.myId) recordDeath();
    if (m.k === this.myId && m.v !== this.myId) {
      recordKill(m.w, zone);
      me.streak = m.s;
      const extra = zone === 'h' ? ' · KAFADAN' : zone === 'back' ? ' · SIRTTAN' : m.w === 'nade' ? ' · PATLAMA' : '';
      this.hud.toast(`+1 LEŞ  ${vn}${extra}`, zone === 'h' || zone === 'back' ? 'hs' : 'kill');
      if (STREAKS[m.s]) { this.hud.streak(STREAKS[m.s]); this.sound.ui('ui_streak', 0.5, this.sound.now() + 0.25); }
    }
  }

  // ------------------------------------------------------------------ bodies
  // The victim's model stays behind as a body thrown by the killing blow; the player gets a fresh model.
  spawnCorpse(r, m) {
    const old = r.model, n = this.names.get(r.id);
    r.model = new Soldier(n?.color || '#333', 'pistol');
    r.model.root.visible = false;
    r.model.setFriendly(this.isFriend(r.id));
    this.scene.add(r.model.root);
    r.hideUntil = this.serverNow() + 0.05; // interpolation still shows it alive for a moment
    let [vx, vy, vz] = m.im || [0, 0, 0];
    if (!m.im && m.kp) { const dx = r.x - m.kp[0], dz = r.z - m.kp[1], L = Math.hypot(dx, dz) || 1; vx = (dx / L) * 1.5; vz = (dz / L) * 1.5; vy = 0.3; }
    const hs = Math.hypot(vx, vz), ux = hs > 0.01 ? vx / hs : Math.sin(r.yaw), uz = hs > 0.01 ? vz / hs : Math.cos(r.yaw);
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    const body = {
      model: old, x: r.x, y: r.y + 0.95, z: r.z, yaw: r.yaw, dir: Math.atan2(ux * c - uz * s, ux * s + uz * c),
      th: 0.02, w: Math.min(5.5, 0.7 + hs * 0.7 + vy * 0.2 + (m.z === 'h' ? 0.8 : 0)), vx, vy, vz, air: 0, t: 0, head: m.z === 'h',
      seed: Math.random() * 6, twist: (Math.random() - 0.5) * 0.7, fade: 0, landed: false, still: false,
    };
    old.root.visible = true;
    this.corpses.push(body);
    const alive = this.corpses.filter((b) => !b.fade);
    if (alive.length > 8) alive[0].fade = 0.001;
  }
  updateCorpses(dt) {
    const cp = this.camera.position;
    for (const b of this.corpses) {
      if (b.fade) {
        b.fade += dt;
        b.model.root.position.y -= dt * 0.35;
        if (b.fade > 1.3) b.dead = true;
        continue;
      }
      if (b.still) continue;
      b.t += dt;
      const up = Math.abs(Math.cos(b.th)), h = 0.17 + 0.78 * up;
      b.vy -= 9.8 * dt;
      const p = { x: b.x + b.vx * dt, z: b.z + b.vz * dt };
      collide(this.map, p, 0.26);
      // bounce off walls
      const px = p.x - (b.x + b.vx * dt), pz = p.z - (b.z + b.vz * dt), pl = Math.hypot(px, pz);
      if (pl > 1e-4) { const nx = px / pl, nz = pz / pl, vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= 1.35 * vn * nx; b.vz -= 1.35 * vn * nz; b.w *= 0.7; } }
      b.x = p.x; b.z = p.z; b.y += b.vy * dt;
      const ground = b.y <= h;
      if (ground) {
        if (b.vy < -2.2) {
          if (Math.hypot(b.x - cp.x, b.z - cp.z) < 30) this.sound.play('st_land', { cat: 'imp', pos: this.v1.set(b.x, 0.2, b.z), vol: Math.min(0.9, -b.vy * 0.12), ref: 2, occl: this.occluded(this.v1) });
          b.w *= 0.4; // the impact kills most of the spin
        }
        b.y = h;
        if (b.vy < 0) { b.vy = -b.vy * 0.18; if (b.vy < 0.5) b.vy = 0; }
        const f = Math.exp(-(up < 0.3 ? 5 : 2) * dt); b.vx *= f; b.vz *= f;
      }
      b.air = damp(b.air, ground ? 0 : 1, 7, dt);
      // topple on the feet, spin freely in the air, settle flat (on the back or the front) on the carpet
      if (ground && up < 0.3) {
        const tgt = Math.round((b.th - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
        b.w *= Math.exp(-14 * dt);
        b.th += (tgt - b.th) * Math.min(1, dt * 10);
        if (!b.landed) {
          b.landed = true;
          const q = this.v1.set(b.x, 0.2, b.z);
          if (q.distanceTo(cp) < 30) this.sound.play('st_land', { cat: 'imp', pos: q, vol: 0.6, ref: 2, occl: this.occluded(q) });
          this.particles.dust(q, this.v2.set(0, 1, 0), clamp(this.world.sampleLight(b.x, b.z), 0.2, 1.1), 'floor');
          this.blood.add(this.v3.set(b.x, 0.003, b.z), this.v2.set(0, 1, 0), 0.7 + Math.random() * 0.4);
        }
      } else if (ground) {
        // topple over whichever end touches the carpet (feet or head), never balance on it
        const sn = Math.sin(b.th), fall = sn * Math.sign(Math.cos(b.th));
        b.w = b.w * Math.exp(-1.5 * dt) + (11 * fall + (Math.abs(sn) < 0.2 ? Math.sign(b.w || 1) * 3 : 0)) * dt;
      }
      b.th += b.w * dt;
      if (b.landed && ground && Math.hypot(b.vx, b.vz) < 0.03 && b.air < 0.02 && b.t > 1.5) b.still = true;
      b.model.ragdoll(dt, b, this.world.sampleLight(b.x, b.z) * 0.95 + 0.03);
    }
    if (this.corpses.some((b) => b.dead)) {
      for (const b of this.corpses) if (b.dead) { this.scene.remove(b.model.root); b.model.mat.dispose(); }
      this.corpses = this.corpses.filter((b) => !b.dead);
    }
  }
  clearCorpses() {
    for (const b of this.corpses) { this.scene.remove(b.model.root); b.model.mat.dispose(); }
    this.corpses = [];
  }

  // ------------------------------------------------------------------ world items
  // items on the carpet; ones thrown out of a crate / body / machine fly there first (d.f = launch point)
  addDrop(d) {
    if (this.drops.has(d.id)) return;
    d.k ||= 'weapon';
    const geo = d.k === 'weapon' ? mergedGunGeometry(d.w, d.a | 0).geo : mergedItemGeometry(d.k, d.v);
    const mat = bakeMaterial({ vertexColors: true, color: 0xffffff, shininess: 30, specular: 0x333333 }, { uniform: true, phong: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.order = 'YXZ';
    const rest = ITEM_REST[d.k] || ITEM_REST.ammo;
    const e = { ...d, mesh, baseL: this.world.sampleLight(d.x, d.z) * 0.95 + 0.04, restY: d.k === 'weapon' ? (WEAPONS[d.w].slot === 'primary' ? 0.03 : 0.022) : rest[0], rest };
    if (d.f) {
      const from = new THREE.Vector3(d.f[0], d.f[1], d.f[2]), dist = Math.hypot(d.x - from.x, d.z - from.z);
      e.fly = { from, t: 0, T: 0.48 + dist * 0.1, h: 0.28 + dist * 0.22, sx: (Math.random() < 0.5 ? -1 : 1) * (1 + ((Math.random() * 2) | 0)), sz: Math.random() < 0.5 ? -1 : 1, bounce: 0 };
      mesh.position.copy(from);
    } else mesh.position.set(d.x, e.restY, d.z);
    mesh.rotation.set(rest[1], d.yaw, rest[2]);
    this.scene.add(mesh);
    this.drops.set(d.id, e);
    this.setItemLight(e, 0);
  }
  setItemLight(e, boost) {
    const L = Math.max(0.12, e.baseL) * (1 + boost);
    e.mesh.material.userData.uLight.value.setRGB(L, L * 0.96, L * 0.85);
  }
  updateDrops(dt) {
    const cp = this.camera.position;
    for (const d of this.drops.values()) {
      const m = d.mesh, f = d.fly;
      if (f) {
        f.t += dt;
        const u = Math.min(1, f.t / f.T), e = u;
        m.position.set(lerp(f.from.x, d.x, e), lerp(f.from.y, d.restY, u) + Math.sin(Math.PI * u) * f.h, lerp(f.from.z, d.z, e));
        // tumble, ending exactly in the resting pose
        const spin = (1 - u) * (1 - u);
        m.rotation.set(d.rest[1] + spin * Math.PI * 2 * f.sx, d.yaw + spin * 1.5 * f.sz, d.rest[2] + spin * Math.PI * f.sz);
        if (u >= 1) {
          d.fly = null; d.hop = 0.16;
          const p = this.v1.set(d.x, 0.05, d.z);
          if (p.distanceTo(cp) < 30) this.sound.play(LAND_SOUND[d.k] || 'it_soft', { cat: 'imp', pos: p, vol: 0.55, ref: 1.6, occl: this.occluded(p) });
          this.particles.dust(p, this.v2.set(0, 1, 0), clamp(d.baseL, 0.2, 1.1), 'floor');
        }
      } else if (d.hop > 0) {
        d.hop = Math.max(0, d.hop - dt);
        const k = d.hop / 0.16;
        m.position.y = d.restY + Math.sin(Math.PI * (1 - k)) * 0.035 * k;
      }
      // a soft glint so loot reads on the carpet; stronger on the one being looked at
      const dist = Math.hypot(d.x - cp.x, d.z - cp.z);
      const pulse = dist < 10 ? 0.22 * (0.5 + 0.5 * Math.sin(this.time * 3.2 + d.id)) : 0;
      this.setItemLight(d, d === this.nearDrop ? 0.7 : pulse);
    }
  }
  removeDrop(id) {
    const d = this.drops.get(id);
    if (!d) return;
    this.scene.remove(d.mesh); d.mesh.material.dispose();
    this.drops.delete(id);
    if (this.nearDrop === d) this.nearDrop = null;
  }
  clearDrops() { for (const id of [...this.drops.keys()]) this.removeDrop(id); }

  addNade(id, { o, v, fuse, by, elapsed }) {
    const g = makeNade(o, v);
    const mesh = new THREE.Mesh(this.nadeGeo, bakeMaterial({ vertexColors: true, color: 0xffffff, shininess: 20, specular: 0x222222 }, { uniform: true, phong: true }));
    this.scene.add(mesh);
    const n = { id, g, fuse, by, acc: 0, mesh, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0), dead: 0 };
    let steps = Math.min(Math.floor(elapsed / NADE_STEP), Math.floor(fuse / NADE_STEP));
    while (steps-- > 0) { stepNade(this.map, g); n.fuse -= NADE_STEP; }
    mesh.position.set(g.x, g.y, g.z);
    this.nades.set(id, n);
  }
  removeNade(id) { const n = this.nades.get(id); if (!n) return; this.scene.remove(n.mesh); n.mesh.material.dispose(); this.nades.delete(id); }
  clearNades() { for (const id of [...this.nades.keys()]) this.removeNade(id); }
  updateNades(dt) {
    const cp = this.camera.position, warn = [];
    for (const [id, n] of this.nades) {
      const g = n.g;
      n.acc += dt;
      while (n.acc >= NADE_STEP && n.fuse > 0) {
        n.acc -= NADE_STEP;
        stepNade(this.map, g);
        n.fuse -= NADE_STEP;
        if (g.bounce > 1.3) this.sound.play('gr_bounce', { cat: 'imp', pos: this.v1.set(g.x, g.y, g.z), vol: Math.min(0.9, g.bounce / 8), ref: 1.5, occl: this.occluded(this.v1) });
      }
      if (n.fuse <= 0 && (n.dead += dt) > 1.2) { this.removeNade(id); continue; }
      n.mesh.position.set(g.x, g.y, g.z);
      const sp = Math.hypot(g.vx, g.vz);
      n.mesh.rotation.x += n.spin.x * dt * Math.min(1, sp / 3); n.mesh.rotation.y += n.spin.y * dt * Math.min(1, sp / 3);
      if (!n.lit || (n.lit -= dt) <= 0) { n.lit = 0.2; const L = this.world.sampleLight(g.x, g.z) * 0.95 + 0.05; n.mesh.material.userData.uLight.value.setRGB(L, L * 0.96, L * 0.85); }
      const d = Math.hypot(g.x - cp.x, g.z - cp.z);
      if (d < 9 && this.me.alive && n.fuse > 0) warn.push([angDiff(this.me.yaw, Math.atan2(-(g.x - cp.x), -(g.z - cp.z))), 1 - d / 9]);
    }
    this.hud.nades(warn);
  }

  explosion(p) {
    const cp = this.camera.position, dist = p.distanceTo(cp), occl = this.occluded(p);
    this.sound.explosion(p, dist, occl);
    this.fire.fireball(p);
    const light = clamp(this.world.sampleLight(p.x, p.z), 0.2, 1.2);
    this.particles.explosionSmoke(p, light);
    this.scorch.add(this.v1.set(p.x, 0.003, p.z), this.v2.set(0, 1, 0), 1.7 + Math.random() * 0.5);
    this.boomLight.position.set(p.x, Math.max(0.5, p.y + 0.4), p.z);
    this.boomLight.intensity = 90;
    const k = clamp(1 - dist / 16, 0, 1) * (occl ? 0.4 : 1);
    this.me.trauma = Math.min(1, this.me.trauma + k * 1.1);
    if (k > 0.05) this.pad.rumble(k, k * 0.8, 200 + k * 400);
    const u = this.post.final.uniforms;
    if (!occl) u.uFlash.value = Math.max(u.uFlash.value, clamp(1 - dist / 12, 0, 1) * 1.6);
  }

  // ------------------------------------------------------------------ shooting
  // world + remote players + crates; skipRemotes for remote-shot visuals
  trace(o, d, maxD, skipRemotes = false) {
    const res = this.traceRes || (this.traceRes = { t: 0, kind: null, id: null, zone: null, n: new THREE.Vector3() });
    res.t = maxD; res.kind = null; res.id = null; res.zone = null; res.n.set(0, 1, 0);
    const hl = Math.hypot(d.x, d.z);
    if (hl > 1e-5) {
      let t2 = raycast(this.map, o.x, o.z, d.x / hl, d.z / hl, maxD * hl), kind = 'wall';
      const b = rayInfo.box >= 0 ? this.map.boxes[rayInfo.box] : null;
      if (b && b.kind === 3) {
        if (o.y + (d.y * t2) / hl > VENDOR_H) { b.off = true; t2 = raycast(this.map, o.x, o.z, d.x / hl, d.z / hl, maxD * hl); b.off = false; }
        else kind = 'metal';
      }
      if (t2 / hl < res.t) { res.t = t2 / hl; res.kind = kind; res.n.set(hitNormal[0], 0, hitNormal[1]); }
    }
    if (d.y < 0) { const t = -o.y / d.y; if (t < res.t) { res.t = t; res.kind = 'floor'; res.n.set(0, 1, 0); } }
    if (d.y > 0) { const t = (CEIL - o.y) / d.y; if (t < res.t) { res.t = t; res.kind = 'ceil'; res.n.set(0, -1, 0); } }
    // crates (axis-aligned approximation)
    const hl2 = d.x * d.x + d.z * d.z;
    if (hl2 > 1e-6) {
      for (const c of this.map.crates) {
        const ex = c.x - o.x, ez = c.z - o.z, along = (ex * d.x + ez * d.z) / hl2;
        if (along < -0.5 || along > res.t + 0.5) continue;
        if (ex * ex + ez * ez - along * along * hl2 > 0.25) continue;
        const t = rayCrate(o, d, c.x, c.z, res.t);
        if (t < res.t) { res.t = t; res.kind = 'crate'; res.n.set(0, 0, 0).setComponent(rayCrate.ax, -Math.sign(rayCrate.ax === 0 ? d.x : rayCrate.ax === 1 ? d.y : d.z)); }
      }
    }
    if (skipRemotes) return res;
    for (const r of this.remotes.values()) {
      if (!r.alive || !r.model.root.visible) continue;
      const cr = r.flags & F.CROUCH;
      const lo = r.lean * 0.3, rx = Math.cos(r.yaw) * lo, rz = -Math.sin(r.yaw) * lo;
      const hy = r.y + (cr ? HEAD_CROUCH : HEAD_STAND) - Math.abs(r.lean) * 0.05;
      const ox = o.x - r.x - rx, oy = o.y - hy, oz = o.z - r.z - rz;
      const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - HEAD_R * HEAD_R, disc = b * b - c;
      if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < res.t) { res.t = t; res.kind = 'player'; res.id = r.id; res.zone = 'h'; } }
      const a2 = d.x * d.x + d.z * d.z;
      if (a2 < 1e-8) continue;
      const bx0 = o.x - r.x - rx * 0.4, bz0 = o.z - r.z - rz * 0.4;
      const bx = bx0 * d.x + bz0 * d.z, cx = bx0 * bx0 + bz0 * bz0 - BODY_R * BODY_R, dd = bx * bx - a2 * cx;
      if (dd <= 0) continue;
      const t = (-bx - Math.sqrt(dd)) / a2;
      if (t <= 0 || t >= res.t) continue;
      const y = o.y + d.y * t - r.y;
      if (y > 0.05 && y < (cr ? 1.02 : 1.45)) { res.t = t; res.kind = 'player'; res.id = r.id; res.zone = y < (cr ? 0.5 : 0.86) ? 'l' : 'b'; }
    }
    return res;
  }

  impact(res, o, d, silentDecal, withSound) {
    const p = this.v2.copy(o).addScaledVector(d, res.t);
    const light = clamp(this.world.sampleLight(p.x, p.z) + (this.me.flash ? 0.3 : 0), 0.08, 1.4);
    const dist = p.distanceTo(this.camera.position);
    if (res.kind === 'player') {
      const head = res.zone === 'h';
      this.particles.blood(p, d, light, head);
      if (withSound) this.sound.impact(head ? 'head' : 'player', p, dist);
      // spatter on whatever is behind the victim
      const kind = res.kind, pp = this.v3.copy(p);
      const r2 = this.trace(pp, d, 2.6, true);
      if (r2.kind && r2.kind !== 'ceil') this.blood.add(this.v4.copy(pp).addScaledVector(d, r2.t), r2.n, (head ? 0.45 : 0.3) + Math.random() * 0.25);
      res.kind = kind;
      return;
    }
    if (!res.kind) return;
    if (withSound) this.sound.impact(res.kind === 'crate' ? 'wall' : res.kind === 'metal' ? 'plate' : res.kind, p, dist, this.occluded(p));
    if (!silentDecal) this.decals.add(p, res.n, res.kind === 'floor' ? 0.07 : 0.085);
    this.particles.dust(p, res.n, res.kind === 'wall' ? light * 1.2 : res.kind === 'ceil' ? light * 1.4 : light * 0.9, res.kind === 'metal' ? 'wall' : res.kind);
    if (res.kind !== 'floor' && Math.random() < (res.kind === 'metal' ? 0.7 : 0.15)) this.particles.sparks(p, res.n);
  }

  eyePos(out) {
    const me = this.me;
    return out.set(me.pos.x + Math.cos(me.yaw) * me.leanOff, me.pos.y + lerp(EYE_STAND, EYE_CROUCH, me.crouchK) - Math.abs(me.leanOff) * 0.12, me.pos.z - Math.sin(me.yaw) * me.leanOff);
  }
  vmToWorld(v) { return this.camera.localToWorld(v); }

  shoot(overdue) {
    const me = this.me, s = this.cur(), type = s.w, w = WEAPONS[type];
    s.mag--;
    me.protectUntil = 0;
    const o = this.eyePos(this.v1);
    const pitch = me.pitch + me.kickP + me.swayP, yaw = me.yaw + me.kickY + me.swayYw;
    const base = this.fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = this.rgt.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = this.upv.crossVectors(right, base);
    const ads = w.scope ? smoothstep(0.75, 0.98, me.ads) : me.ads;
    const sup = !!((s.a | 0) & ATT.SUP);
    const spread = this.aimSpread(s, w);
    me.bloom = Math.min(1.6, me.bloom + (w.modes[0] === 'auto' ? 0.28 : 0.4));
    const hits = new Map(), rank = { l: 0, b: 1, h: 2 };
    const muzzleW = this.vmToWorld(this.vm.muzzle(this.v3));
    const origin = o.clone();
    for (let i = 0; i < w.pellets; i++) {
      const r = spread * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
      const d = this.dir.copy(base).addScaledVector(right, Math.cos(th) * r).addScaledVector(up, Math.sin(th) * r).normalize();
      const res = this.trace(origin, d, w.range);
      if (res.kind === 'player' && !this.isFriend(res.id)) {
        const h = hits.get(res.id) || { id: res.id, dmg: 0, zone: 'l' };
        h.dmg += dmgAt(w, res.t) * zoneMul(w, res.zone) * (sup ? SUP_DMG : 1);
        if (rank[res.zone] > rank[h.zone]) h.zone = res.zone;
        hits.set(res.id, h);
      }
      const t = res.t;
      if (i === 0 && Math.random() < (w.modes[0] === 'auto' ? 0.4 : 0.25)) {
        const end = this.v4.copy(origin).addScaledVector(d, t);
        const td = end.sub(muzzleW); const len = td.length();
        if (len > 1) this.tracers.add(muzzleW, td.divideScalar(len), len);
      }
      this.impact(res, origin, d, i > 4, i < 2);
    }
    this.net.send({ t: 'shoot', w: type, o: [origin.x, origin.y, origin.z].map((v) => +v.toFixed(3)), d: [base.x, base.y, base.z].map((v) => +v.toFixed(4)), hits: [...hits.values()].map((h) => ({ id: h.id, dmg: Math.round(h.dmg * 10) / 10, zone: h.zone })) });
    // instant (predicted) hit feedback; the server confirms kills
    let best = null;
    for (const h of hits.values()) {
      const r = this.remotes.get(h.id);
      if (!r || r.flags & F.PROTECT) continue;
      this.predHits.set(h.id, this.time);
      r.model.flinch(Math.min(1, h.dmg / 40), Math.random() < 0.5 ? -1 : 1);
      const kind = h.zone === 'h' ? 'h' : h.zone === 'b' && r.ar > 0 ? 'plate' : 'b';
      if (!best || kind === 'h') best = kind;
    }
    if (best) {
      if (settings.hitmarks) this.hud.hitmarker(best);
      this.sound.ui(best === 'h' ? 'ui_head' : best === 'plate' ? 'ui_armor' : 'ui_hit', 0.5, this.sound.now() + 0.03);
    }
    // recoil: vertical climb grows through a burst, horizontal follows a per-burst wave
    if (this.time - me.lastShotT > 0.35) { me.shotIdx = 0; me.patSeed = Math.random() * 6.28; }
    me.lastShotT = this.time;
    const n = me.shotIdx++;
    const k = w.recoil * (1 - 0.35 * ads) * (me.crouch ? 0.75 : 1) * (1 + Math.min(n, 8) * 0.06);
    const hd = (n < 2 ? (Math.random() - 0.5) * 0.4 : Math.sin(n * 0.7 + me.patSeed) * 0.9 + (Math.random() - 0.5) * 0.5) * w.hRecoil * (1 - 0.3 * ads);
    me.pitch = clamp(me.pitch + k * 0.5, -1.45, 1.45);
    me.kickP += k * 0.7;
    me.kickY += hd;
    me.yaw += hd * 0.6;
    const fl = FEEL[type];
    this.pad.rumble(0.1 + fl.cam * 1.4, 0.25 + fl.cam, 50 + fl.cam * 220);
    this.vm.kick(type, me.ads);
    me.trauma = Math.min(1, me.trauma + fl.cam);
    me.fovPunch += fl.fov;
    this.post.final.uniforms.uFlash.value = Math.max(this.post.final.uniforms.uFlash.value, sup ? 0.05 : 0.3);
    if (this.scopeK < 0.6 && !sup) { this.vmMuzzle.fire(this.vm.muzzle(this.v2), this.vm.flashSize(), 0.045); this.vmFlash.intensity = 6; }
    this.muzzleLight.position.copy(muzzleW);
    this.muzzleLight.intensity = sup ? 0 : 22;
    this.muzzleT = 0.05;
    this.sound.shot(type, { fp: true, sup, when: this.sound.now() + Math.max(0, LOCAL_LAT - overdue) });
    this.particles.smoke(muzzleW, base, sup ? 0.5 : 0.8, type === 'shotgun' || type === 'sniper' ? 6 : sup ? 2 : 3, type === 'shotgun' ? 2 : 1);
    if (w.cycle) { s.needsCycle = true; me.cycling = true; this.vm.play(w.cls === 'bolt' ? 'bolt' : 'pump', w.cycle); }
    else if (w.cls !== 'revolver') {
      this.shells.eject(this.vm.ejectPort(this.v2), SHELL_KIND[type]);
      this.sound.play('sh_brass', { cat: 'mech', vol: 0.14, when: this.sound.now() + 0.4 + Math.random() * 0.2 });
    }
    if (s.mag === 0 && type === 'pistol') me.slideBack = true;
  }

  // cone half-angle (rad) of the weapon in hand right now; the crosshair opens by the same amount
  aimSpread(s = this.cur(), w = WEAPONS[s.w]) {
    const me = this.me;
    if (w.melee) return 0.01;
    const ads = w.scope ? smoothstep(0.75, 0.98, me.ads) : me.ads;
    const las = (s.a | 0) & ATT.LAS ? lerp(LASER_SPREAD, 1, ads) : 1;
    const moving = Math.min(1, Math.hypot(me.vel.x, me.vel.z) / 3.3);
    return (lerp(w.spread, w.adsSpread, ads) * (me.crouch ? 0.8 : 1) + moving * w.moveSpread * (1 - ads * 0.5) * (las < 1 ? 0.7 : 1) + (me.onGround ? 0 : 0.06) + me.bloom * w.spread * 0.7) * las;
  }

  knifeHit(heavy) {
    const me = this.me, o = this.eyePos(this.v1).clone();
    const k = WEAPONS.knife;
    let best = null, bestT = 1e9, bestZone = 'b';
    const yaw = me.yaw, pitch = me.pitch;
    for (const dy of [-0.35, -0.17, 0, 0.17, 0.35]) for (const dp of [-0.2, 0, 0.15]) {
      const d = this.dir.set(-Math.sin(yaw + dy) * Math.cos(pitch + dp), Math.sin(pitch + dp), -Math.cos(yaw + dy) * Math.cos(pitch + dp));
      const res = this.trace(o, d, k.range + 0.25);
      if (res.kind === 'player' && res.t < bestT && !this.isFriend(res.id)) { best = res.id; bestT = res.t; bestZone = res.zone; }
    }
    if (best) {
      const r = this.remotes.get(best);
      this.net.send({ t: 'stab', id: best });
      const d = this.dir.set(r.x - me.pos.x, 0, r.z - me.pos.z).normalize();
      const back = (-d.x * -Math.sin(r.yaw) - d.z * -Math.cos(r.yaw)) < -0.35;
      const p = this.v2.set(r.x, r.y + (bestZone === 'h' ? 1.55 : 1.15), r.z).addScaledVector(d, -0.2);
      this.particles.blood(p, d, clamp(this.world.sampleLight(p.x, p.z), 0.2, 1.2), back);
      this.sound.play('kn_flesh', { cat: 'imp', pos: p, vol: 0.9, ref: 2 });
      if (!(r.flags & F.PROTECT)) {
        this.predHits.set(best, this.time);
        if (settings.hitmarks) this.hud.hitmarker(back ? 'h' : 'b');
        this.sound.ui(back ? 'ui_head' : 'ui_hit', 0.5);
        r.model.flinch(1, 1);
      }
      this.vm.bump(-3, 0.3);
      me.trauma = Math.min(1, me.trauma + 0.12);
      this.pad.rumble(0.45, 0.3, 90);
      return;
    }
    const d = this.dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const res = this.trace(o, d, k.range, true);
    if (res.kind) {
      const p = this.v2.copy(o).addScaledVector(d, res.t);
      this.sound.play('kn_wall', { cat: 'imp', pos: p, vol: 0.7, ref: 2 });
      this.particles.sparks(p, res.n, 7);
      this.particles.dust(p, res.n, clamp(this.world.sampleLight(p.x, p.z), 0.2, 1.2), res.kind);
      this.decals.add(p, res.n, 0.05);
      this.vm.bump(-5, 0.6);
      me.trauma = Math.min(1, me.trauma + 0.1);
    }
  }

  remoteShot(m, when) {
    const r = this.remotes.get(m.id);
    const o = new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
    const d = new THREE.Vector3(m.d[0], m.d[1], m.d[2]).normalize();
    const w = WEAPONS[m.w] || WEAPONS.pistol;
    const res = this.trace(o, d, w.range, true);
    const hitT = res.t, hitKind = res.kind;
    let mz = o;
    if (r && r.model.root.visible) { r.model.root.updateMatrixWorld(true); mz = r.model.muzzleWorld(new THREE.Vector3()); }
    const cp = this.camera.position, dist = mz.distanceTo(cp), sup = !!m.s;
    this.sound.shot(m.w, { pos: mz, dist, occl: this.occluded(mz), when, sup });
    if (dist < 70) {
      if (!sup) {
        this.muzzles.fire(mz, m.w === 'pistol' ? 0.3 : m.w === 'shotgun' ? 0.6 : 0.45);
        const L = this.remoteLights[(this.rl = ((this.rl || 0) + 1) % 2)];
        L.position.copy(mz); L.intensity = 18;
      }
      const end = o.clone().addScaledVector(d, hitT);
      const td = end.clone().sub(mz), len = td.length();
      if (Math.random() < (sup ? 0.25 : 0.6) && len > 1) this.tracers.add(mz, td.divideScalar(len), len);
      if (hitKind && hitT < w.range - 0.1) { res.t = hitT; res.kind = hitKind; this.impact(res, o, d, false, end.distanceTo(cp) < 16); }
      // supersonic crack / whiz when a round passes close to us
      const toMe = this.v1.copy(cp).sub(o), along = toMe.dot(d);
      if (along > 0 && along < hitT + 0.5 && this.me.alive) {
        const miss = toMe.addScaledVector(d, -along).length();
        if (miss < 1.8) this.sound.whiz(this.v2.copy(o).addScaledVector(d, along), 1 - miss / 1.8, when);
      }
    }
  }

  // true if walls block the straight line between the listener and a world point
  occluded(p) {
    const c = this.camera.position;
    return !lineOfSight(this.map, c.x, c.z, p.x, p.z);
  }

  // ------------------------------------------------------------------ frame
  frame(now) {
    requestAnimationFrame(this.frameCb);
    const raw = (now - this.last) / 1000, dt = clamp(raw, 0, 0.05);
    this.last = now;
    if (raw > 0.12 && this.state === 'game') { (this.hitches ||= []).push({ t: +this.time.toFixed(1), ms: Math.round(raw * 1000) }); if (this.hitches.length > 30) this.hitches.shift(); }
    this.time += dt;
    this.fpsN = (this.fpsN || 0) + 1;
    if (!this.fpsAt) this.fpsAt = now;
    if (now - this.fpsAt >= 500) { this.fps = Math.round((this.fpsN * 1000) / (now - this.fpsAt)); this.fpsAt = now; this.fpsN = 0; this.hud.fps(settings.fps, this.fps); }
    if (this.state === 'menu' || this.state === 'boot') {
      if (this.map) {
        this.updateAttract(dt);
        this.world.update(dt, this.time);
        this.updateAmbience(dt);
        this.motes.update(this.time, this.camera.position, this.v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion), clamp(this.world.sampleLight(this.camera.position.x, this.camera.position.z), 0, 1.5), false);
        this.hudT = (this.hudT || 0) - dt;
        if (this.hudT <= 0) { this.hudT = 0.25; this.hud.clock(this.serial); }
        this.postUniforms(dt, { ads: 0, scope: 0, hurt: 0, low: 0, dead: 0 });
        this.post.render(this.scene, this.camera, this.vmScene, this.vmCamera);
      }
      return;
    }
    if (this.state !== 'game') return;
    addTime(dt);
    if ((this.careerT = (this.careerT || 0) + dt) > 15) { this.careerT = 0; saveCareer(); }
    for (const m of this.net.poll()) this.onMsg(m);
    if (this.net.closed && !this.lostShown) { this.lostShown = true; this.hud.banner('SUNUCU BAĞLANTISI KOPTU'); }
    this.updateClock(dt);
    this.runEvents();

    this.updatePad(dt);
    this.updatePlayer(dt);
    this.updateWeapon(dt);
    this.updateCamera(dt);
    this.updateViewmodel(dt);
    this.updateRemotes(dt);
    this.updateRemoteFlashlights();
    this.updateNades(dt);
    this.updateDrops(dt);
    this.updateCorpses(dt);
    this.updateLasers();
    this.world.update(dt, this.time);
    this.particles.update(dt); this.fire.update(dt); this.tracers.update(dt); this.muzzles.update(dt); this.vmMuzzle.update(dt); this.shells.update(dt);
    this.boomLight.intensity = Math.max(0, this.boomLight.intensity - dt * 350);
    this.updateAmbience(dt);
    this.updateHud(dt);
    this.sendInput(dt);
    const me = this.me;
    this.postUniforms(dt, {
      ads: me.ads, scope: this.scopeK || 0, hurt: me.hurt, low: me.alive ? clamp((40 - me.hp) / 40, 0, 1) : 0,
      dead: me.alive ? 0 : Math.min(1, (this.time - me.deathAt) * 1.5),
    });
    this.renderer.info.reset();
    this.post.render(this.scene, this.camera, this.vmScene, this.vmCamera);
    this.mouse.dx = this.mouse.dy = 0;
    this.fresh.l = this.fresh.r = false;
  }

  runEvents() {
    if (!this.events.length) return;
    const now = this.serverNow();
    this.events.sort((a, b) => a.due - b.due);
    let i = 0;
    for (; i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.due > now + LOOKAHEAD) break;
      ev.fn(this.sound.now() + clamp(ev.due - now, 0, LOOKAHEAD));
    }
    if (i) this.events.splice(0, i);
  }

  sendInput(dt) {
    const me = this.me;
    this.sendT -= dt;
    if (this.sendT <= 0 && me.alive) {
      this.sendT = 0.05;
      const f = (me.crouch ? F.CROUCH : 0) | (me.flash ? F.FLASH : 0) | (Math.hypot(me.vel.x, me.vel.z) > 0.5 ? F.MOVE : 0) | (me.sprint ? F.SPRINT : 0)
        | (me.reloading ? F.RELOAD : 0) | (me.lean < -0.3 ? F.LEAN_L : 0) | (me.lean > 0.3 ? F.LEAN_R : 0) | (me.ads > 0.5 ? F.ADS : 0);
      this.net.send({ t: 'in', p: [+me.pos.x.toFixed(3), +me.pos.y.toFixed(3), +me.pos.z.toFixed(3)], yw: +me.yaw.toFixed(3), pt: +me.pitch.toFixed(3), f, w: this.curType() });
    }
    if (this.net.online && (this.pingT -= dt) <= 0) { this.pingT = 2; this.net.send({ t: 'ping', c: performance.now() }); }
  }

  postUniforms(dt, s) {
    const u = this.post.final.uniforms;
    u.uTime.value = this.time;
    u.uHurt.value = s.hurt; u.uLow.value = s.low; u.uDead.value = s.dead;
    u.uFlash.value = Math.max(0, u.uFlash.value - dt * 8);
    u.uLens.value = settings.lens;
    u.uExposure.value = settings.bright;
    u.uScope.value = s.scope;
    u.uK.value = lerp(0.34, 0.2, s.ads);
    u.uZoom.value = lerp(1, lerp(0.79, 0.86, s.ads), settings.lens);
    u.uSway.value.set(this.me.swayYw * 2, -this.me.swayP * 2).multiplyScalar(s.scope);
    if (settings.blur && s.scope < 0.5) {
      const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect);
      const cam = this.camera;
      const yaw = cam.rotation.y, pitch = cam.rotation.x;
      const dyaw = angDiff(this.prevYaw ?? yaw, yaw), dp = pitch - (this.prevPitch ?? pitch);
      this.prevYaw = yaw; this.prevPitch = pitch;
      const bx = clamp(-dyaw / hf * 0.6, -0.04, 0.04), by = clamp(dp / THREE.MathUtils.degToRad(this.camera.fov) * 0.6, -0.04, 0.04);
      u.uBlur.value.set(Math.abs(bx) > 0.002 ? bx : 0, Math.abs(by) > 0.002 ? by : 0);
    } else { u.uBlur.value.set(0, 0); this.prevYaw = this.camera.rotation.y; this.prevPitch = this.camera.rotation.x; }
  }

  updatePlayer(dt) {
    const me = this.me;
    me.hurt = Math.max(0, me.hurt - dt * 1.2);
    me.trauma = Math.max(0, me.trauma - dt * 1.8);
    if (!me.alive) { me.deathT = Math.min(1, me.deathT + dt * 1.6); me.vel.set(0, 0, 0); this.nearCrate = -1; this.nearDrop = null; this.nearVendor = null; return; }
    const w = WEAPONS[this.curType()];
    const pm = this.padMove;
    const f = clamp((this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0) - (pm ? pm[1] : 0), -1, 1);
    const s = clamp((this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0) + (pm ? pm[0] : 0), -1, 1);
    const stick = pm ? Math.min(1, Math.hypot(pm[0], pm[1])) : 0;
    if (me.padSprint && (!pm || pm[1] > -0.5)) me.padSprint = false; // stick sprint ends when you stop pushing forward
    me.crouch = (settings.holdCrouch ? this.down('crouch') : !!me.crouchToggle) || !!me.padCrouch;
    if (me.crouch && me.padSprint) me.padCrouch = false;
    const shift = this.down('sprint') || !!me.padSprint;
    if (me.exhausted && me.stamina > 0.3) me.exhausted = false;
    me.sprint = shift && f > 0 && !me.crouch && me.ads < 0.3 && me.onGround && !me.reloading && !me.exhausted && !(this.vm.animName || '').startsWith('knife');
    if (me.sprint) {
      me.stamina -= dt / 6.5; me.stamRegen = 0.9;
      if (me.stamina <= 0) { me.stamina = 0; me.exhausted = true; }
    } else if ((me.stamRegen -= dt) <= 0) me.stamina = Math.min(1, me.stamina + dt / 4);
    // hold breath while scoped
    const scoped = (this.scopeK || 0) > 0.6;
    me.holdBreath = scoped && shift && me.breath > 0;
    if (me.holdBreath) me.breath = Math.max(0, me.breath - dt / 4.5); else me.breath = Math.min(1, me.breath + dt / (scoped ? 6 : 2.5));
    // lean: camera slides sideways around cover, limited by nearby walls
    const leanT = me.sprint ? 0 : clamp((this.down('leanR') ? 1 : 0) - (this.down('leanL') ? 1 : 0) + (this.padLean || 0), -1, 1);
    me.lean = damp(me.lean, leanT, 9, dt);
    if (Math.abs(me.lean) > 0.01) {
      const sgn = Math.sign(me.lean), rx = Math.cos(me.yaw) * sgn, rz = -Math.sin(me.yaw) * sgn;
      const room = clamp(raycast(this.map, me.pos.x, me.pos.z, rx, rz, 0.8) - 0.2, 0, 0.4);
      me.leanOff = me.lean * Math.min(0.4, room);
    } else me.leanOff = 0;
    let speed = me.crouch ? 1.8 : me.sprint ? 5.6 : 3.3;
    if (stick > 0 && !this.down('forward') && !this.down('back') && !this.down('left') && !this.down('right')) speed *= Math.max(0.35, stick); // analog walk
    speed *= (w.moveMul || 1) * (1 - me.ads * 0.35) * (1 - Math.abs(me.lean) * 0.35);
    const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    let wx = -sy * f + cy * s, wz = -cy * f - sy * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx = wx / wl * speed; wz = wz / wl * speed; }
    const acc = me.onGround ? 11 : 1.5;
    me.vel.x = damp(me.vel.x, wx, acc, dt);
    me.vel.z = damp(me.vel.z, wz, acc, dt);
    const jump = this.down('jump') || this.padJump;
    this.padJump = false;
    if (jump && me.onGround && !me.crouch && me.stamina > 0.08) { me.vy = 3.9; me.onGround = false; me.stamina -= 0.08; me.stamRegen = 0.9; }
    me.vy -= 13 * dt;
    me.pos.y += me.vy * dt;
    if (me.pos.y <= 0) {
      if (!me.onGround && me.vy < -3) { me.trauma = Math.min(1, me.trauma + 0.15); me.land = Math.min(1, -me.vy / 6); this.sound.play('st_land', { cat: 'step', vol: 0.4 }); }
      me.pos.y = 0; me.vy = 0; me.onGround = true;
    }
    const p = { x: me.pos.x + me.vel.x * dt, z: me.pos.z + me.vel.z * dt };
    // other operators are solid
    for (const r of this.remotes.values()) {
      if (!r.alive || !r.model.root.visible) continue;
      const dx = p.x - r.x, dz = p.z - r.z, d = Math.hypot(dx, dz), min = PLAYER_R * 2;
      if (d < min && d > 1e-4) { p.x += (dx / d) * (min - d); p.z += (dz / d) * (min - d); }
    }
    collide(this.map, p, PLAYER_R);
    me.pos.x = p.x; me.pos.z = p.z;
    me.crouchK = damp(me.crouchK, me.crouch ? 1 : 0, 10, dt);
    me.sprintK = damp(me.sprintK, me.sprint ? 1 : 0, 8, dt);
    const hs = Math.hypot(me.vel.x, me.vel.z);
    if (me.onGround) {
      me.bob += hs * dt * (me.sprint ? 1.75 : 2.2);
      me.stepAcc += hs * dt;
      if (me.stepAcc > (me.sprint ? 2.1 : 1.6)) {
        me.stepAcc = 0;
        this.sound.step(null, { run: me.sprint, vol: me.crouch ? 0.05 : me.sprint ? 0.28 : 0.16 });
        if (!me.crouch && Math.random() < (me.sprint ? 0.6 : 0.25)) this.sound.play('gear', { cat: 'step', vol: me.sprint ? 0.2 : 0.1 });
        if (!me.crouch) this.net.send({ t: 'step', run: me.sprint ? 1 : 0 });
      }
    }
    // weapon pulled back when hugging a wall
    const fx = -sy, fz = -cy;
    const wallD = raycast(this.map, me.pos.x, me.pos.z, fx, fz, 1.2);
    me.block = damp(me.block, clamp((0.72 - wallD) / 0.35, 0, 1) * (1 - me.ads * 0.6), 10, dt);
    this.findInteractable();
    // walking over health, armor, grenades, ammo and money takes them when they are useful;
    // a gun is taken the same way when its slot is empty (or it is the one in hand and you need its ammo)
    for (const d of this.drops.values()) {
      if (d.fly || this.time < (d.tryAt || 0)) continue;
      const dx = d.x - me.pos.x, dz = d.z - me.pos.z;
      if (Math.abs(dx) > 1.1 || Math.abs(dz) > 1.1 || Math.hypot(dx, dz) > (d.k === 'weapon' ? 0.8 : 1.0)) continue;
      if (d.k === 'weapon') {
        const W = WEAPONS[d.w], held = me.inv[W.slot];
        if (held && !(held.w === d.w && held.res < W.maxReserve)) continue;
      } else if (!this.useful(d)) continue;
      d.tryAt = this.time + 0.5;
      this.net.send({ t: 'pickup', id: d.id });
    }
    if (this.shop && (!this.nearShop(this.shop.v) || this.endData)) this.closeShop(false);
  }

  // what the player is looking at within reach: an item on the carpet, a crate or a vending machine
  // what the player is turned toward within reach: an item on the carpet, a crate or a vending machine.
  // Only the heading counts (no need to look down at the floor and lose your aim); looking at the ceiling uses nothing.
  findInteractable() {
    const me = this.me, px = me.pos.x, pz = me.pos.z, fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    let kind = 0, target = null, bestS = 1;
    if (me.pitch < 0.6) {
      for (const d of this.drops.values()) {
        if (d.fly) continue;
        // guns first: the rest is taken by walking over it anyway
        const sc = this.useScore(px, pz, fx, fz, d.x, d.z, 1.9, d.k === 'weapon' ? 0.3 : 0.2) + (d.k === 'weapon' ? 0 : 0.15);
        if (sc < bestS) { bestS = sc; kind = 1; target = d; }
      }
      const cr = this.map.crates;
      for (let i = 0; i < cr.length; i++) {
        if (this.world.crateState[i].target) continue;
        const sc = this.useScore(px, pz, fx, fz, cr[i].x, cr[i].z, 2.0, 0.4);
        if (sc < bestS) { bestS = sc; kind = 2; target = i; }
      }
    }
    for (const v of this.map.vendors) {
      if (!this.nearShop(v)) continue;
      const sc = this.useScore(px, pz, fx, fz, v.x + v.nx * 0.33, v.z + v.nz * 0.33, 2.8, 0.6);
      if (sc < bestS) { bestS = sc; kind = 3; target = v; }
    }
    this.nearDrop = kind === 1 ? target : null;
    this.nearCrate = kind === 2 ? target : -1;
    this.nearVendor = kind === 3 ? target : null;
  }
  // < 1: inside a generous cone around the heading (wider for close / big things); 9: out of reach or behind a wall
  useScore(px, pz, fx, fz, x, z, reach, radius) {
    const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz);
    if (d > reach) return 9;
    if (d < 0.35) return 0.2 + d; // right at your feet
    const c = (dx * fx + dz * fz) / d;
    if (c <= 0) return 9;
    const sc = Math.acos(Math.min(1, c)) / (Math.atan(radius / d) + 0.45) + d * 0.08;
    if (sc >= 1 || raycast(this.map, px, pz, dx / d, dz / d, d) < d - 0.05) return 9;
    return sc;
  }
  nearShop(v) {
    const me = this.me, dx = me.pos.x - (v.x + v.nx * 0.6), dz = me.pos.z - (v.z + v.nz * 0.6);
    return Math.hypot(dx, dz) < VENDOR_R + 0.4 && dx * v.nx + dz * v.nz > -0.3;
  }

  updateWeapon(dt) {
    const me = this.me, s = this.cur(), type = s.w, w = WEAPONS[type];
    me.fireT = Math.max(me.fireT - dt, -dt);
    me.bloom = Math.max(0, me.bloom - dt * (w.modes[0] === 'auto' ? 2.2 : 3));
    me.kickP = damp(me.kickP, 0, 9, dt); me.kickY = damp(me.kickY, 0, 9, dt);
    me.fovPunch = damp(me.fovPunch, 0, 12, dt);
    this.muzzleT = (this.muzzleT || 0) - dt;
    if (this.muzzleT <= 0) this.muzzleLight.intensity = 0;
    this.vmFlash.intensity = Math.max(0, this.vmFlash.intensity - dt * 120);
    for (const L of this.remoteLights) L.intensity = Math.max(0, L.intensity - dt * 400);
    const an = this.vm.animName;
    // ADS
    const wantAds = settings.holdAds ? this.aimHeld() : me.adsToggle;
    const blockAds = !me.alive || me.sprint || w.melee || me.reloading || (an && (an === 'holster' || an.startsWith('nade') || an === 'inspect' || (an === 'bolt')));
    me.ads = damp(me.ads, wantAds && !blockAds ? 1 : 0, w.scope ? 11 : 14, dt);
    if (!settings.holdAds && (blockAds && (me.sprint || w.melee))) me.adsToggle = false;
    // scoped sway
    this.scopeK = w.scope ? smoothstep(0.72, 0.97, me.ads) : 0;
    const swayAmp = this.scopeK * (me.holdBreath ? 0.12 : me.breath < 0.05 ? 1.8 : 1) * (me.crouch ? 0.6 : 1) * (1 + Math.min(1, Math.hypot(me.vel.x, me.vel.z) / 2));
    const t = this.time;
    me.swayP = (Math.sin(t * 0.9) * 0.0035 + Math.sin(t * 1.73 + 1) * 0.0017) * swayAmp;
    me.swayYw = (Math.cos(t * 0.71) * 0.0045 + Math.sin(t * 1.31) * 0.0015) * swayAmp;
    // grenade cooking
    if (me.cooking) {
      me.cookT += dt;
      if (me.cookT >= GRENADE.fuse - 0.02) { me.cookT = GRENADE.fuse; this.throwNade(); this.vm.play('nade_throw', 0.45); }
      else if (!me.nadeHeld && an === 'nade_hold') this.vm.play('nade_throw', 0.45);
    }
    if (!me.alive || this.isPaused() || this.endData || this.shop) return;
    // knife
    if (w.melee) {
      if (!an || isInspect(an)) {
        if (this.fresh.r) this.melee(true);
        else if (this.fireHeld()) this.melee(false);
      }
      return;
    }
    // semi-auto clicks are buffered briefly so a click during the cooldown / pump / bolt is not lost
    if (this.fresh.l) me.trigQ = this.time;
    const press = this.time - (me.trigQ ?? -9) < 0.18;
    // shotgun: pressing fire during a shell reload stops after the current shell
    if (me.reloading && w.shell && this.fresh.l && s.mag > 0) me.wantFire = true;
    if (isInspect(an) && (this.fresh.l || this.aimHeld())) this.vm.stop();
    const ready = !this.vm.animName && !me.reloading && !me.cycling && !s.needsCycle && me.sprintK < 0.35;
    if (!ready) { if (this.fresh.l && !this.vm.animName && s.mag === 0 && !me.reloading) this.startReload(); return; }
    if (press && s.mode === 'burst' && me.burst <= 0) { me.burst = 3; me.trigQ = -9; }
    const want = s.mode === 'auto' ? this.fireHeld() : s.mode === 'burst' ? me.burst > 0 : press;
    if (!want) return;
    let shots = 0;
    while (me.fireT <= 0 && shots < 4) {
      if (s.mag <= 0) {
        if (press || this.fresh.l) { this.sound.mech('dry', 0.5); this.startReload(); me.trigQ = -9; }
        me.burst = 0;
        break;
      }
      this.shoot(-me.fireT);
      shots++;
      me.fireT += 60 / w.rpm;
      if (s.mode === 'burst') { if (--me.burst <= 0) { me.fireT += 0.12; break; } }
      else if (s.mode !== 'auto') { me.trigQ = -9; break; }
      if (this.vm.animName) break;
    }
  }

  melee(heavy) {
    const me = this.me, k = WEAPONS.knife;
    this.vm.play(heavy ? 'knife_heavy' : 'knife_light', heavy ? k.heavyT : k.light);
    this.net.send({ t: 'swing', h: heavy ? 1 : 0 });
    me.protectUntil = 0;
    if (heavy) { const f = this.v1.set(-Math.sin(me.yaw), 0, -Math.cos(me.yaw)); me.vel.addScaledVector(f, 2.2); }
  }

  updateCamera(dt) {
    const me = this.me, cam = this.camera, s = this.cur(), w = WEAPONS[s.w];
    const eye = lerp(EYE_STAND, EYE_CROUCH, me.crouchK);
    const hs = Math.hypot(me.vel.x, me.vel.z);
    const bobAmt = Math.min(1, hs / 5) * (1 - me.ads * 0.6) * (me.onGround ? 1 : 0.2);
    const shake = settings.shake;
    const bx = Math.sin(me.bob) * 0.022 * bobAmt * shake, by = -Math.abs(Math.cos(me.bob)) * 0.034 * bobAmt * shake;
    const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    const t = this.time, tr = me.trauma * me.trauma * shake;
    const sx = (Math.sin(t * 37.1) + Math.sin(t * 23.3)) * 0.02 * tr, syw = (Math.sin(t * 31.7) + Math.sin(t * 19.9)) * 0.02 * tr, sz = Math.sin(t * 27.3) * 0.03 * tr;
    const breathe = Math.sin(t * 1.7) * 0.0025;
    me.land = damp(me.land, 0, 5, dt);
    if (me.alive) {
      this.eyePos(cam.position);
      cam.position.x += cy * bx; cam.position.z -= sy * bx;
      cam.position.y += by - me.land * 0.07;
      const strafe = me.vel.x * cy - me.vel.z * sy;
      me.roll = damp(me.roll, (-strafe * 0.011 + Math.sin(me.bob) * 0.013 * bobAmt) * shake - me.lean * 0.22, 8, dt);
      cam.rotation.set(me.pitch + me.kickP + me.swayP + sx + breathe * (1 - this.scopeK) - me.land * 0.03, me.yaw + me.kickY + me.swayYw + syw, me.roll + sz);
    } else {
      const k = me.deathT, e = k * k * (3 - 2 * k);
      if (me.killerPos && this.time - me.deathAt > 0.7) {
        const want = Math.atan2(-(me.killerPos[0] - me.pos.x), -(me.killerPos[1] - me.pos.z));
        me.deathYaw += angDiff(me.deathYaw, want) * (1 - Math.exp(-dt * 1.8));
      }
      const dp = me.dp;
      if (dp) {
        // the chest camera flies with the body, then lies on the carpet
        dp.vy -= 9.8 * dt;
        const q = { x: dp.x + dp.vx * dt, z: dp.z + dp.vz * dt };
        collide(this.map, q, 0.2);
        dp.x = q.x; dp.z = q.z; dp.y = Math.min(CEIL - 0.15, Math.max(0.28, dp.y + dp.vy * dt));
        if (dp.y <= 0.28) { dp.vy = Math.max(0, dp.vy); const f = Math.exp(-6 * dt); dp.vx *= f; dp.vz *= f; }
        if (dp.y >= CEIL - 0.15 && dp.vy > 0) dp.vy = 0;
        if (dp.y > 0.3) dp.spinA = (dp.spinA || 0) + dp.spin * dt;
        cam.position.set(dp.x, dp.y, dp.z);
      } else cam.position.set(me.pos.x, me.pos.y + lerp(eye, 0.28, e), me.pos.z);
      cam.rotation.set(lerp(me.pitch, 0.25, e) + (dp?.spinA || 0), me.deathYaw, lerp(0, 1.25, e));
    }
    const adsF = w.scope ? lerp(1, w.adsFov, this.scopeK) * lerp(1, 0.92, me.ads) : lerp(1, w.adsFov || 1, me.ads);
    const fov = settings.fov * adsF + me.fovPunch * (1 - this.scopeK);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); this.updatePointScale(); }
    const vfov = 70; // the viewmodel is never magnified on the sights: it would cover the target
    if (Math.abs(this.vmCamera.fov - vfov) > 0.01) { this.vmCamera.fov = vfov; this.vmCamera.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    // flashlight (chest mounted, slightly right)
    const fl = this.flashlight;
    fl.intensity = me.flash && me.alive ? 40 : 0;
    fl.position.copy(cam.position).add(this.v1.set(0.12, -0.05, 0).applyQuaternion(cam.quaternion));
    fl.target.position.copy(cam.position).add(this.v1.set(0, 0, -10).applyQuaternion(cam.quaternion));
    fl.target.updateMatrixWorld();
    this.sound.listener(cam.position, this.v2.set(0, 0, -1).applyQuaternion(cam.quaternion), this.v3.set(0, 1, 0).applyQuaternion(cam.quaternion));
  }

  updateViewmodel(dt) {
    const me = this.me, hs = Math.hypot(me.vel.x, me.vel.z), a = me.ads;
    const bobAmt = Math.min(1, hs / 5) * (1 - a * 0.85) * (me.onGround ? 1 : 0.3);
    me.swayX = damp(me.swayX, clamp(-this.mouse.dx * 0.00035, -0.04, 0.04), 10, dt);
    me.swayY = damp(me.swayY, clamp(this.mouse.dy * 0.00035 * (settings.invertY ? -1 : 1), -0.04, 0.04), 10, dt);
    const cyw = Math.cos(me.yaw), syw = Math.sin(me.yaw);
    me.inertX = damp(me.inertX, clamp(-(me.vel.x * cyw - me.vel.z * syw) * 0.006, -0.03, 0.03), 7, dt);
    me.inertZ = damp(me.inertZ, clamp((me.vel.x * syw + me.vel.z * cyw) * 0.005, -0.03, 0.03), 7, dt);
    this.vm.root.visible = this.scopeK < 0.6 && !(!me.alive && me.deathT > 0.6);
    this.vm.update(dt, {
      time: this.time, ads: a, sprintK: me.sprintK, bob: me.bob, bobAmt, swayX: me.swayX, swayY: me.swayY, inertX: me.inertX, inertZ: me.inertZ,
      crouchK: me.crouchK, lean: me.lean, block: me.block, land: me.land, alive: me.alive, deathT: me.deathT, slideBack: me.slideBack,
    });
    // lighting of the viewmodel follows the local baked light
    const L = this.world.sampleLight(me.pos.x, me.pos.z);
    this.vmAmb.intensity = 0.25 + L * 0.9 + (me.flash ? 0.25 : 0);
    this.vmDir.intensity = 0.3 + L * 1.6;
    this.q.copy(this.camera.quaternion).invert();
    this.vmDir.position.set(0.3, 1, 0.2).applyQuaternion(this.q);
  }

  updateRemotes(dt) {
    const rt = this.serverNow() - INTERP;
    const cp = this.camera.position;
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (!b.length) { r.model.root.visible = false; continue; }
      while (b.length > 2 && b[1].t <= rt) b.shift();
      const s0 = b[0], s1 = b[1] || b[0];
      let k = 0;
      if (b.length > 1 && rt > s0.t) k = Math.min(1, (rt - s0.t) / Math.max(1e-3, s1.t - s0.t));
      if (Math.hypot(s1.x - s0.x, s1.z - s0.z) > 4) k = k < 0.5 ? 0 : 1; // respawn teleport
      const ox = r.x, oz = r.z;
      r.x = lerp(s0.x, s1.x, k); r.y = lerp(s0.y, s1.y, k); r.z = lerp(s0.z, s1.z, k);
      r.yaw = s0.yaw + angDiff(s0.yaw, s1.yaw) * k; r.pitch = lerp(s0.pitch, s1.pitch, k);
      const S = k < 0.5 ? s0 : s1;
      const was = r.flags;
      r.flags = S.f; r.alive = !!(S.f & F.ALIVE); r.w = S.w;
      const moved = Math.hypot(r.x - ox, r.z - oz);
      r.speed = damp(r.speed, moved < 3 ? moved / Math.max(dt, 1e-4) : 0, 10, dt);
      r.lean = damp(r.lean, r.flags & F.LEAN_L ? -1 : r.flags & F.LEAN_R ? 1 : 0, 9, dt);
      const dist = Math.hypot(r.x - cp.x, r.z - cp.z);
      r.model.root.visible = dist < 62 && r.alive && !(rt < (r.hideUntil ?? -1));
      if (!r.model.root.visible) continue;
      r.model.setWeapon(WEAPON_ORDER[r.w] || 'pistol', r.att | 0);
      const L = this.world.sampleLight(r.x, r.z) * 0.95 + 0.03;
      r.model.update(dt, { x: r.x, y: r.y, z: r.z, yaw: r.yaw, pitch: r.pitch, crouch: !!(r.flags & F.CROUCH), speed: r.alive ? r.speed : 0, alive: r.alive, flash: r.flags & F.FLASH, lean: r.lean, reload: r.flags & F.RELOAD, sprint: r.flags & F.SPRINT }, L);
      if (r.alive && ((r.flags ^ was) & F.FLASH) && dist < 15) this.sound.play('ui_click', { cat: 'mech', pos: this.v1.set(r.x, r.y + 1.2, r.z), vol: 0.35, ref: 1.2, occl: this.occluded(this.v1) });
      // hear enemies reload
      if (r.alive && (r.flags & F.RELOAD) && !(was & F.RELOAD) && dist < 25) {
        const p = this.v1.set(r.x, r.y + 1.1, r.z), occl = this.occluded(p), now = this.sound.now();
        this.sound.mech('mag_out_r', 0.35, p, now);
        this.sound.play('mag_in_r', { cat: 'mech', pos: p, vol: 0.35, ref: 1.5, occl, when: now + 1.1 });
      }
      if (r.alive && r.speed > 1 && !(r.flags & F.CROUCH) && r.y < 0.05) {
        r.stepAcc += r.speed * dt;
        if (r.stepAcc > 1.7) {
          r.stepAcc = 0;
          const sp = this.v1.set(r.x, 0.1, r.z);
          if (dist < 32) this.sound.step(sp, { run: r.speed > 4.2, vol: r.speed > 4.2 ? 0.55 : 0.35, occl: this.occluded(sp) });
        }
      }
    }
  }

  // laser sights: ours along the view, others' along their aim (it gives them away)
  updateLasers() {
    const L = this.lasers, me = this.me, cp = this.camera.position;
    L.begin();
    const s = this.cur();
    if (this.state === 'game' && me.alive && (s.a | 0) & ATT.LAS && !WEAPONS[s.w].melee && me.sprintK < 0.5 && this.scopeK < 0.6 && !this.vm.animName?.startsWith('nade')) {
      const e = this.vm.laserPoint(this.v1);
      if (e) {
        // zeroed on the crosshair: the dot shows where a hip-fired round goes
        this.camera.localToWorld(e);
        const dir = this.v2.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const res = this.trace(cp, dir, 60);
        const hit = this.v3.copy(cp).addScaledVector(dir, res.t - 0.02);
        e.lerp(hit, Math.min(0.5, 0.35 / Math.max(0.5, e.distanceTo(hit))));
        L.add(e, hit, cp, 0.22);
      }
    }
    for (const r of this.remotes.values()) {
      if (!r.alive || !((r.att | 0) & ATT.LAS) || !r.model.root.visible || r.flags & F.SPRINT) continue;
      if (Math.hypot(r.x - cp.x, r.z - cp.z) > 45) continue;
      const g = r.model.gun, d = g.userData;
      if (!d.laser) continue;
      const e = this.v1.copy(d.laser).applyMatrix4(g.matrixWorld);
      const dir = this.v2.set(-Math.sin(r.yaw) * Math.cos(r.pitch), Math.sin(r.pitch), -Math.cos(r.yaw) * Math.cos(r.pitch));
      const res = this.trace(e, dir, 60, true);
      L.add(e, this.v3.copy(e).addScaledVector(dir, res.t - 0.02), cp, 0.4);
    }
    L.end();
  }

  // the two nearest remote flashlights get real spot lights (aimed from the gun muzzle)
  updateRemoteFlashlights() {
    const cp = this.camera.position, list = [];
    for (const r of this.remotes.values()) {
      if (!r.alive || !(r.flags & F.FLASH) || !r.model.root.visible) continue;
      const d = Math.hypot(r.x - cp.x, r.z - cp.z);
      if (d < 32) list.push([d, r]);
    }
    list.sort((a, b) => a[0] - b[0]);
    this.remoteFlash.forEach((L, i) => {
      const r = list[i] && list[i][1];
      if (!r) { L.intensity = 0; return; }
      r.model.muzzleWorld(L.position);
      const fx = -Math.sin(r.yaw) * Math.cos(r.pitch), fy = Math.sin(r.pitch), fz = -Math.cos(r.yaw) * Math.cos(r.pitch);
      L.target.position.set(L.position.x + fx * 10, L.position.y + fy * 10, L.position.z + fz * 10);
      L.target.updateMatrixWorld();
      L.intensity = 32;
    });
  }

  // positional buzz of the nearest flickering troffer + random far-off noises of the level
  updateAmbience(dt) {
    const cp = this.camera.position;
    let best = null, bd = 14;
    for (const fl of this.world.flickers) {
      const d = Math.hypot(fl.f.x - cp.x, fl.f.z - cp.z);
      if (d < bd) { bd = d; best = fl; }
    }
    this.sound.buzz(best ? this.v1.set(best.f.x, CEIL - 0.1, best.f.z) : null, best ? (best.on ? 1 : 0.15) : 0);
    let vb = null, vd = 9;
    for (const v of this.map.vendors) { const d = Math.hypot(v.x - cp.x, v.z - cp.z); if (d < vd) { vd = d; vb = v; } }
    this.sound.vendHum(vb ? this.v1.set(vb.x, 1.2, vb.z) : null, vb && !this.occluded(this.v1) ? 1 : 0.35);
    this.ambT = (this.ambT ?? 10) - dt;
    if (this.ambT <= 0) {
      this.ambT = 12 + Math.random() * 26;
      const a = Math.random() * Math.PI * 2, r = 25 + Math.random() * 20;
      this.sound.distant(this.v1.set(cp.x + Math.cos(a) * r, 1.5, cp.z + Math.sin(a) * r));
    }
    if (this.state === 'game') {
      const light = clamp(this.world.sampleLight(cp.x, cp.z), 0, 1.5);
      this.motes.update(this.time, cp, this.v2.set(0, 0, -1).applyQuaternion(this.camera.quaternion), light, this.me.flash && this.me.alive);
    }
  }

  // ------------------------------------------------------------------ HUD
  updateHud(dt) {
    const me = this.me, s = this.cur(), w = WEAPONS[s.w], hud = this.hud;
    this.hudT = (this.hudT || 0) - dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      hud.clock(this.serial);
      let lead = me.kills;
      for (const r of this.remotes.values()) lead = Math.max(lead, r.kills);
      hud.match(this.endData ? 0 : Math.max(0, this.tl - (this.time - this.tlAt)), me.kills, me.deaths, lead, this.fragLimit, this.mode === 'tdm' ? { score: this.teamScore, mine: this.myTeam } : null);
      hud.vitals(me.hp, me.armor, me.holdBreath || (this.scopeK > 0.6) ? me.breath : me.stamina);
      hud.weapon(s.w, s.mode, s.mag, s.res, me.reloading, w.mag || 1);
      hud.slots(me.inv, me.pendingSlot || me.slot);
      hud.protect(me.alive && this.time < me.protectUntil);
      const useKey = this.pad.active && !this.locked ? 'X' : keyLabel(settings.binds.use);
      const d = this.nearDrop;
      if (this.shop || !me.alive) hud.prompt(null);
      else if (d && d.k === 'weapon') {
        const W = WEAPONS[d.w], held = me.inv[W.slot], a = d.a | 0;
        const att = a ? ` <span class="att">${ATTACHMENTS.filter((x) => a & x.bit).map((x) => esc(x.label)).join(' · ')}</span>` : '';
        hud.prompt(`<b>[${useKey}]</b> ${esc(W.label)} al${att}${held && held.w !== d.w ? ` <span style="opacity:.6">(${esc(WEAPONS[held.w].short)} bırakılır)</span>` : held ? ' <span style="opacity:.6">(mermi)</span>' : ''}`);
      } else if (d) {
        const label = esc(itemLabel(d));
        hud.prompt(this.useful(d) ? `<b>[${useKey}]</b> ${label} <span style="opacity:.6">· üzerinden geçerek de alınır</span>` : `${label} <span style="opacity:.6">· ${this.fullText(d).toLowerCase()}</span>`);
      } else if (this.nearCrate >= 0) hud.prompt(`<b>[${useKey}]</b> Sandığı aç`);
      else if (this.nearVendor) hud.prompt(`<b>[${useKey}]</b> Badem suyu otomatı <span class="cashc">$${me.cash}</span>`);
      else hud.prompt(null);
      if (!me.alive) hud.respawn(Math.max(0, RESPAWN_T - (this.time - me.deathAt)));
      if (this.scoreOpen) this.renderScore();
      if (this.endData) hud.endCount(this.endData.next - (this.time - this.endAt));
      if (me.alive && me.ads < 0.9) {
        const cam = this.camera, dir = this.v1.set(0, 0, -1).applyQuaternion(cam.quaternion);
        const res = this.trace(cam.position, dir, 40);
        hud.aimName(res.kind === 'player' ? this.names.get(res.id)?.name || '' : '', res.kind === 'player' && this.isFriend(res.id));
        this.aimOnFoe = res.kind === 'player' && !this.isFriend(res.id);
      } else hud.aimName('');
    }
    this.updateCrosshair();
    hud.cook(me.cooking ? me.cookT / GRENADE.fuse : 0);
    if (me.alive && me.hp < 35) {
      me.beatT -= dt;
      if (me.beatT <= 0) { me.beatT = 0.85; this.sound.ui('heart', 0.6); }
    }
    // heavy breathing: while out of stamina, or for a few seconds after a bad hit (not endlessly while hurt)
    const winded = me.stamina < 0.4 ? 1 - me.stamina / 0.4 : 0;
    const shaken = me.hp < 25 && this.time - (me.hurtAt ?? -99) < 6 ? 0.6 : 0;
    const need = me.alive && !this.isPaused() ? Math.max(winded, shaken) : 0;
    if (need > 0) {
      me.breathT -= dt;
      if (me.breathT <= 0) { me.breathT = 1.8 - need * 0.8; this.sound.ui('breath', 0.12 + 0.2 * need); }
    } else me.breathT = 0.3;
  }

  updateCrosshair() {
    const me = this.me, s = this.cur(), w = WEAPONS[s.w], xh = settings.xh;
    const sights = me.ads > 0.5 && !w.melee;
    // scope and red dot bring their own reticle; iron sights keep a faint dot on the aim point
    const on = xh.show && me.alive && !this.shop && !this.endData && !(sights && (w.scope || s.w === 'm4'));
    this.hud.crosshair(on);
    if (!on) return;
    // the lines open by how much wider than the resting cone the weapon shoots right now
    const fov = THREE.MathUtils.degToRad(this.camera.fov), zoom = Math.max(0.5, this.post.final.uniforms.uZoom.value);
    const px = (a) => (Math.tan(a) / Math.tan(fov / 2)) * (innerHeight / 2) / zoom;
    const extra = xh.dynamic && !w.melee ? clamp(px(this.aimSpread(s, w)) - px(w.spread * (me.crouch ? 0.8 : 1)), 0, 80) : 0;
    const mode = sights ? 'ads' : !xh.lines || w.melee ? 'dot' : 'cross';
    this.hud.crosshairState(mode, xh.gap + extra, me.sprintK > 0.5 || me.reloading);
  }

  renderScore() {
    const rows = [{ id: this.myId, name: settings.name, k: this.me.kills, d: this.me.deaths, hs: this.me.hs, bot: false, alive: this.me.alive, team: this.myTeam }];
    for (const r of this.remotes.values()) { const n = this.names.get(r.id); rows.push({ id: r.id, name: n?.name || '?', k: r.kills, d: r.deaths, hs: r.hs, bot: n?.bot, alive: r.alive, team: n?.team ?? -1 }); }
    rows.sort((a, b) => b.k - a.k || a.d - b.d);
    this.hud.scoreboard(true, rows, this.myId, this.fragLimit, this.net?.online ? this.ping : null, this.mode === 'tdm' ? { score: this.teamScore, mine: this.myTeam } : null);
  }
}

// ------------------------------------------------------------------ menu wiring
const game = new Game();
window.__game = game;
buildSettingsPanel($('settingsBox'), (k) => game.onSetting(k));
$('controlsBox').classList.add('controlsHost');
buildControls($('controlsBox'), (k) => game.onSetting(k));
$('settingsHome').appendChild($('settingsBox'));
for (const b of document.querySelectorAll('#nav button[data-p]')) {
  b.onclick = () => {
    game.sound.resume();
    game.sound.ui('ui_click', 0.4);
    document.querySelectorAll('#nav button[data-p]').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.menu-right .panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'p-' + b.dataset.p));
    if (b.dataset.p === 'settings') $('settingsHome').appendChild($('settingsBox'));
    if (b.dataset.p === 'profile') $('careerBox').innerHTML = careerHtml();
  };
  b.onmouseenter = () => game.sound.ui('ui_hover', 0.3);
}
if (location.search.includes('desktop')) {
  $('btnExit').classList.remove('hidden');
  $('btnExit').onclick = () => { saveCareer(); window.close(); };
}
$('bots').value = settings.bots; $('botsv').textContent = settings.bots;
$('diff').value = settings.diff; $('frags').value = settings.frags; $('mtime').value = settings.time; $('gmode').value = settings.mode;
const modeLabel = () => { $('fragsLabel').textContent = settings.mode === 'tdm' ? 'Takım skor limiti' : 'Leş limiti'; };
modeLabel();
$('gmode').onchange = () => { settings.mode = $('gmode').value; saveSettings(); modeLabel(); };
$('glight').value = settings.light;
$('glight').onchange = () => { settings.light = $('glight').value; saveSettings(); };
$('bots').oninput = () => { settings.bots = +$('bots').value; $('botsv').textContent = settings.bots; saveSettings(); };
$('diff').onchange = () => { settings.diff = +$('diff').value; saveSettings(); };
$('frags').onchange = () => { settings.frags = +$('frags').value; saveSettings(); };
$('mtime').onchange = () => { settings.time = +$('mtime').value; saveSettings(); };
$('btnCareerReset').onclick = () => { if (confirm('Tüm kariyer istatistikleri silinsin mi?')) { resetCareer(); $('careerBox').innerHTML = careerHtml(); } };
let onlineOk = false;
$('btnOffline').onclick = () => game.start('offline');
$('btnOnline').onclick = () => { if (onlineOk) game.start('online'); };
if (location.protocol.startsWith('http')) {
  Net.online(1500).then(async (n) => {
    n.close(); onlineOk = true;
    $('btnOnline').disabled = false;
    const host = location.hostname;
    const loopback = host === 'localhost' || host === '[::1]' || /^127\./.test(host);
    const privateNetwork = loopback || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    let addresses = [location.origin];
    if (loopback) {
      try {
        const info = await (await fetch('/info')).json();
        if (info.lan?.length) addresses = info.lan.map((ip) => `http://${ip}:${info.port}`);
      } catch { /* keep the current address */ }
    }
    const message = privateNetwork ? 'Sunucu aktif. Aynı ağdaki arkadaşların şu adresi açabilir:' : 'Sunucu aktif. Discord\'da arkadaşlarınla şu adresi paylaş:';
    $('onlineInfo').innerHTML = `${message}<br><b class="addr">${esc(addresses[0])}</b>${addresses.length > 1 ? `<br><span class="small">${addresses.slice(1).map(esc).join(' · ')}</span>` : ''}`;
  }).catch(() => { $('onlineInfo').textContent = 'Sunucuya bağlanılamadı. Birazdan tekrar dene veya sayfayı yenile.'; });
} else $('onlineInfo').textContent = 'Çok oyunculu oynamak için oyunu bir web adresinden aç.';
game.boot().catch((e) => { console.error(e); $('loadtext').textContent = 'Başlatma hatası: ' + e.message; });

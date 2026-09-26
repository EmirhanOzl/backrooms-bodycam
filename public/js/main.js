// BACKROOMS: BODYCAM — client
import * as THREE from 'three';
import { generateMap, CEIL, raycast, lineOfSight, collide, hitNormal } from './shared/map.js';
import { WEAPONS, WEAPON_ORDER, dmgAt, zoneMul } from './shared/weapons.js';
import { PLAYER_R, EYE_STAND, EYE_CROUCH, HEAD_STAND, HEAD_CROUCH, HEAD_R, BODY_R, MAX_HP } from './shared/core.js';
import { buildWorld } from './world.js';
import { gunMaterials, buildGun, FPArms, Soldier } from './models.js';
import { BodycamPost } from './post.js';
import { Particles, Decals, Tracers, MuzzleSprites, Shells } from './effects.js';
import { Sound } from './audio.js';
import { Net } from './net.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

const QUALITY = [{ scale: 0.6, msaa: 0 }, { scale: 0.85, msaa: 0 }, { scale: 1.0, msaa: 4 }];
const SHORT = { pistol: 'G17', smg: 'MP5', shotgun: 'M870', rifle: 'AK-47' };
// viewmodel poses in camera space (meters)
const POSE = {
  pistol: { hip: [0.085, -0.17, -0.44], ads: [0.0, -0.062, -0.4] },
  smg: { hip: [0.075, -0.235, -0.46], ads: [0.0, -0.093, -0.4] },
  shotgun: { hip: [0.075, -0.24, -0.54], ads: [0.0, -0.073, -0.48] },
  rifle: { hip: [0.075, -0.24, -0.54], ads: [0.0, -0.089, -0.48] },
};

const settings = Object.assign({ name: 'Gezgin', sens: 1, quality: 1, xhair: true, vol: 0.8 }, JSON.parse(localStorage.getItem('brbc') || '{}'));
const saveSettings = () => localStorage.setItem('brbc', JSON.stringify(settings));

class Game {
  constructor() {
    this.canvas = $('view');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(1);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a2410);
    this.camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.04, 70);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(80, 16 / 9, 0.01, 5);
    this.vmAmb = new THREE.AmbientLight(0xfff0d8, 1);
    this.vmDir = new THREE.DirectionalLight(0xfff4e0, 1.5);
    this.vmFlash = new THREE.PointLight(0xffb060, 0, 2.5, 2);
    this.vmFlash.position.set(0.05, -0.05, -0.6);
    this.vmScene.add(this.vmAmb, this.vmDir, this.vmFlash);

    this.flashlight = new THREE.SpotLight(0xfff1dc, 0, 34, 0.46, 0.6, 1.3);
    this.muzzleLight = new THREE.PointLight(0xffa850, 0, 14, 1.6);
    this.remoteLights = [0, 1].map(() => new THREE.PointLight(0xffa850, 0, 12, 1.6));
    this.scene.add(this.flashlight, this.flashlight.target, this.muzzleLight, ...this.remoteLights);

    this.particles = new Particles(this.scene);
    this.decals = new Decals(this.scene);
    this.tracers = new Tracers(this.scene);
    this.muzzles = new MuzzleSprites(this.scene, 10);
    this.vmMuzzle = new MuzzleSprites(this.vmScene, 3);
    this.shells = new Shells(this.vmScene);
    this.sound = new Sound();

    this.keys = {};
    this.mouse = { l: false, r: false, dx: 0, dy: 0 };
    this.locked = false;
    this.playing = false;
    this.remotes = new Map();
    this.names = new Map();
    this.time = 0;
    this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3();
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
  }

  // ------------------------------------------------------------------ setup
  async start(mode) {
    const load = $('loading');
    load.classList.remove('hidden');
    $('loadpct').textContent = 'bağlanılıyor…';
    try { this.sound.init(); this.sound.setVolume(settings.vol); } catch (e) { console.warn('audio disabled', e); this.sound.ctx = null; }
    try {
      this.net = mode === 'online' ? await Net.online(4000) : Net.offline({ bots: +$('bots').value + 1, difficulty: +$('diff').value, fragLimit: 20 });
    } catch {
      $('loadpct').textContent = 'sunucuya bağlanılamadı';
      return;
    }
    this.net.send({ t: 'join', name: settings.name });
    let welcome = null;
    const pending = [];
    for (let i = 0; i < 300 && !welcome; i++) {
      await new Promise((r) => setTimeout(r, 20));
      for (const m of this.net.poll()) { if (m.t === 'welcome') welcome = m; else pending.push(m); }
    }
    if (!welcome) { $('loadpct').textContent = 'sunucu yanıt vermedi'; return; }
    this.myId = welcome.id;
    this.fragLimit = welcome.fragLimit;
    $('loadpct').textContent = 'ışıklar pişiriliyor…';
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    this.loadLevel(welcome.seed, welcome.size);
    welcome.crates.forEach((o, i) => this.world.setCrateOpen(i, !!o, true));

    // first-person rig
    const M = gunMaterials();
    this.vm = new THREE.Group();
    this.vmScene.add(this.vm);
    this.vmGuns = {};
    for (const t of WEAPON_ORDER) { const g = buildGun(t, M); g.visible = false; this.vm.add(g); this.vmGuns[t] = g; }
    this.arms = new FPArms(M);
    this.vm.add(this.arms.group);

    this.me = {
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, onGround: true,
      crouch: false, crouchK: 0, sprint: false, sprintK: 0, ads: 0, flash: false, alive: false,
      hp: MAX_HP, armor: 0, kills: 0, deaths: 0,
      inv: {}, weapon: 'pistol', fireT: 0, reloadT: 0, switchT: 0, bloom: 0,
      kickP: 0, kickY: 0, vmKick: 0, pumpT: 0, trauma: 0, bob: 0, stepAcc: 0, roll: 0,
      swayX: 0, swayY: 0, deathT: 0, deathAt: 0, hurt: 0, beatT: 0,
      lean: 0, leanOff: 0, shotIdx: 0, lastShotT: -9, land: 0, inertX: 0, inertZ: 0,
    };
    this.resetInventory();
    this.applyQuality();
    for (const m of pending) this.onMsg(m);

    this.renderer.info.autoReset = false;
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.vmScene, this.vmCamera);
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('xhair').style.display = settings.xhair ? '' : 'none';
    this.playing = true;
    $('pause').classList.remove('hidden'); // hidden again by pointerlockchange once the lock is granted
    this.lock();
    this.last = performance.now();
    this.sendT = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  // (Re)build the level for a seed; used at join and at every new match.
  loadLevel(seed, size) {
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.group.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const k of ['map', 'bumpMap', 'lightMap']) o.material[k]?.dispose();
        o.material.dispose();
      });
    }
    this.map = generateMap(seed, size);
    const t0 = performance.now();
    this.world = buildWorld(this.map, this.scene, this.renderer);
    console.log('world build ms', Math.round(performance.now() - t0));
    $('serial').textContent = 'X' + (seed >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 8);
    this.decals.clear();
    this.nearCrate = -1;
    for (const r of this.remotes.values()) r.has = false;
  }

  applyQuality() {
    const q = QUALITY[settings.quality] || QUALITY[1];
    this.scale = q.scale;
    this.post = new BodycamPost(this.renderer, q.msaa);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(320, Math.floor(innerWidth * dpr * (this.scale || 1)));
    const h = Math.max(180, Math.floor(innerHeight * dpr * (this.scale || 1)));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.vmCamera.aspect = w / h;
    this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
    this.particles.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  lock() {
    if (!this.playing || this.locked) return;
    // newer Chrome returns a Promise that rejects during the post-ESC cooldown; older API returns void
    Promise.resolve(this.canvas.requestPointerLock?.()).catch(() => $('pause').classList.remove('hidden'));
  }

  bindInput() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      $('pause').classList.toggle('hidden', this.locked || !this.playing);
      if (!this.locked) { this.mouse.l = this.mouse.r = false; this.keys = {}; }
    });
    document.addEventListener('pointerlockerror', () => { if (this.playing) $('pause').classList.remove('hidden'); });
    // Ctrl is crouch: guard against Ctrl+W closing the tab mid-match
    window.addEventListener('beforeunload', (e) => { if (this.playing && !this.quitting) { e.preventDefault(); e.returnValue = ''; } });
    this.canvas.addEventListener('click', () => this.lock());
    $('btnResume').onclick = () => this.lock();
    $('btnQuit').onclick = () => { this.quitting = true; location.reload(); };
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.me) return;
      const s = 0.0021 * settings.sens * (1 - this.me.ads * 0.3);
      this.me.yaw -= e.movementX * s;
      this.me.pitch = clamp(this.me.pitch - e.movementY * s, -1.45, 1.45);
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.l = true; this.triggerFresh = true; }
      if (e.button === 2) this.mouse.r = true;
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (!this.locked || !this.me) return;
      const owned = WEAPON_ORDER.filter((w) => this.me.inv[w]);
      const i = owned.indexOf(this.me.weapon);
      this.switchTo(owned[(i + (e.deltaY > 0 ? 1 : -1) + owned.length) % owned.length]);
    });
    document.addEventListener('keydown', (e) => {
      if (!this.playing) return;
      if (e.code === 'Tab') { e.preventDefault(); $('score').classList.remove('hidden'); this.renderScore(); return; }
      if (!this.locked) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.ctrlKey) e.preventDefault();
      if (e.repeat) return;
      this.keys[e.code] = true;
      const me = this.me;
      if (e.code === 'KeyR') this.startReload();
      if (e.code === 'KeyF') this.interact();
      if (e.code === 'KeyT') { me.flash = !me.flash; this.sound.toggle(); }
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (n >= 0) this.switchTo(WEAPON_ORDER[n]);
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'Tab') $('score').classList.add('hidden');
    });
  }

  resetInventory() {
    const me = this.me;
    me.inv = { pistol: { mag: WEAPONS.pistol.mag, res: WEAPONS.pistol.reserve } };
    me.weapon = null;
    this.switchTo('pistol', true);
  }

  switchTo(type, silent) {
    const me = this.me;
    if (!type || !me.inv[type] || me.weapon === type) return;
    me.weapon = type;
    me.switchT = 0.45; me.reloadT = 0; me.pumpT = 0;
    for (const t of WEAPON_ORDER) this.vmGuns[t].visible = t === type;
    if (!silent) this.sound.deploy();
    this.renderSlots();
  }

  startReload() {
    const me = this.me, w = WEAPONS[me.weapon], inv = me.inv[me.weapon];
    if (!me.alive || me.reloadT > 0 || me.switchT > 0 || inv.mag >= w.mag || inv.res <= 0) return;
    me.reloadT = w.reload;
    this.sound.reload(me.weapon, w.reload);
  }

  interact() {
    const i = this.nearCrate;
    if (i == null || i < 0 || !this.me.alive) return;
    if (this.time - (this.lastOpen || 0) < 0.3) return;
    this.lastOpen = this.time;
    this.net.send({ t: 'open', id: i });
  }

  // ------------------------------------------------------------------ messages
  onMsg(m) {
    const me = this.me;
    switch (m.t) {
      case 'roster': {
        const ids = new Set();
        for (const p of m.list) {
          ids.add(p.id);
          this.names.set(p.id, p);
          if (p.id === this.myId || this.remotes.has(p.id)) continue;
          const model = new Soldier(p.color, 'pistol');
          this.scene.add(model.root);
          this.remotes.set(p.id, { id: p.id, model, has: false, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, tx: 0, ty: 0, tz: 0, tyaw: 0, tpitch: 0, speed: 0, stepAcc: 0, flags: 0, w: 0, alive: false, kills: 0, deaths: 0, hp: 100, lean: 0 });
        }
        for (const [id, r] of this.remotes) if (!ids.has(id)) { this.scene.remove(r.model.root); this.remotes.delete(id); }
        break;
      }
      case 'snap':
        for (const s of m.ps) {
          const [id, x, y, z, yaw, pitch, f, w, hp, ar, k, d] = s;
          if (id === this.myId) {
            me.kills = k; me.deaths = d;
            if (me.alive) { me.hp = hp; me.armor = ar; }
            continue;
          }
          const r = this.remotes.get(id);
          if (!r) continue;
          if (!r.has || Math.hypot(x - r.x, z - r.z) > 5) { r.x = x; r.y = y; r.z = z; r.yaw = yaw; r.pitch = pitch; }
          r.has = true;
          r.tx = x; r.ty = y; r.tz = z; r.tyaw = yaw; r.tpitch = pitch; r.flags = f; r.w = w; r.kills = k; r.deaths = d;
          r.alive = !!(f & 1);
          if (r.alive && hp < r.hp) r.model.flinch(Math.min(1, (r.hp - hp) / 40));
          r.hp = hp;
        }
        break;
      case 'spawn':
        me.pos.set(m.x, 0, m.z); me.vel.set(0, 0, 0); me.vy = 0;
        me.yaw = m.yaw; me.pitch = 0; me.alive = true; me.hp = MAX_HP; me.armor = 0; me.deathT = 0; me.hurt = 0;
        me.kickP = me.kickY = 0;
        this.resetInventory();
        $('death').classList.add('hidden');
        break;
      case 'shot': this.remoteShot(m); break;
      case 'hurt': {
        me.hp = m.hp; me.armor = m.armor;
        const head = m.zone === 'h';
        me.hurt = Math.min(1, me.hurt + m.dmg / (head ? 22 : 35));
        me.trauma = Math.min(1, me.trauma + 0.25 + m.dmg / 120 + (head ? 0.3 : 0));
        const dx = m.from[0] - me.pos.x, dz = m.from[1] - me.pos.z;
        const rel = angDiff(me.yaw, Math.atan2(-dx, -dz));
        // aim punch: shoved away from the incoming round
        me.kickP += (head ? 0.06 : 0.025) * (0.6 + Math.random() * 0.6);
        me.kickY += Math.sin(rel) * -0.03 + (Math.random() - 0.5) * 0.02;
        this.sound.hurt(m.zone, m.dmg);
        const el = $('dmgdir');
        el.style.transition = 'none'; el.style.opacity = 1; el.style.transform = `rotate(${-rel}rad)`;
        requestAnimationFrame(() => { el.style.transition = 'opacity 1.2s'; el.style.opacity = 0; });
        break;
      }
      case 'hit': {
        this.sound.hit(m.kill, m.zone, m.plate);
        const h = $('hitmark');
        const cls = (m.kill ? ' kill' : '') + (m.zone === 'h' ? ' head' : '') + (m.plate ? ' plate' : '');
        h.className = 'show' + cls;
        clearTimeout(this.hitTimer);
        this.hitTimer = setTimeout(() => { h.className = 'fade' + cls; }, m.kill ? 280 : m.zone === 'h' ? 160 : 90);
        break;
      }
      case 'kill': {
        const kn = this.names.get(m.k)?.name || '?', vn = this.names.get(m.v)?.name || '?';
        const div = document.createElement('div');
        if (m.k === this.myId || m.v === this.myId) div.className = 'me';
        div.innerHTML = m.k === m.v ? `${esc(vn)} ☠` : `${esc(kn)} <span class="${m.h ? 'hs' : ''}">[${SHORT[m.w] || m.w}${m.h ? ' ⌖' : ''}]</span> ${esc(vn)}`;
        $('feed').prepend(div);
        while ($('feed').children.length > 6) $('feed').lastChild.remove();
        if (m.v === this.myId) {
          me.alive = false; me.deathAt = this.time; me.hp = 0;
          $('death').classList.remove('hidden');
          $('killer').textContent = m.k === m.v ? 'Kendini vurdun.' : `${kn} seni ${SHORT[m.w] || ''} ile indirdi${m.h ? ' (kafadan)' : ''}.`;
        }
        if (m.k === this.myId && m.v !== this.myId) this.toast(m.h ? '+1 LEŞ · KAFADAN' : '+1 LEŞ');
        break;
      }
      case 'crate': {
        this.world.setCrateOpen(m.id, !!m.open);
        const c = this.map.crates[m.id];
        if (m.open) this.sound.crate(m.by === this.myId ? null : this.v1.set(c.x, 0.3, c.z));
        break;
      }
      case 'loot': this.applyLoot(m); break;
      case 'match':
        $('banner').textContent = `${m.name} MAÇI KAZANDI`;
        break;
      case 'reset':
        $('banner').textContent = '';
        this.loadLevel(m.seed, m.size);
        this.renderer.compile(this.scene, this.camera);
        this.toast('YENİ SEVİYE');
        break;
    }
  }

  applyLoot(m) {
    const me = this.me, L = m.loot;
    this.sound.pickup();
    if (L.k === 'weapon') {
      const w = WEAPONS[L.w];
      if (me.inv[L.w]) { me.inv[L.w].res = Math.min(w.maxReserve, me.inv[L.w].res + w.mag * 2); this.toast(`+${w.mag * 2} ${SHORT[L.w]} MERMİSİ`); }
      else { me.inv[L.w] = { mag: w.mag, res: w.mag * 2 }; this.toast(`+ ${w.label}`); this.switchTo(L.w); }
    } else if (L.k === 'ammo') {
      const owned = WEAPON_ORDER.filter((t) => me.inv[t]);
      owned.sort((a, b) => me.inv[a].res / WEAPONS[a].maxReserve - me.inv[b].res / WEAPONS[b].maxReserve);
      const t = owned.includes(me.weapon) && me.inv[me.weapon].res < WEAPONS[me.weapon].maxReserve * 0.6 ? me.weapon : owned[0];
      const w = WEAPONS[t], add = Math.ceil(w.mag * 1.5);
      me.inv[t].res = Math.min(w.maxReserve, me.inv[t].res + add);
      this.toast(`+${add} ${SHORT[t]} MERMİSİ`);
    } else if (L.k === 'med') { me.hp = m.hp; this.toast('+50 SAĞLIK · İLK YARDIM'); }
    else if (L.k === 'armor') { me.armor = m.armor; this.toast('+50 ZIRH · PLAKA'); }
    this.renderSlots();
  }

  toast(text) {
    const d = document.createElement('div');
    d.textContent = text;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 2300);
  }

  // ------------------------------------------------------------------ shooting
  trace(o, d, maxD, skipRemotes = false) {
    const res = { t: maxD, kind: null, id: null, zone: null, n: new THREE.Vector3() };
    const hl = Math.hypot(d.x, d.z);
    if (hl > 1e-5) {
      const t2 = raycast(this.map, o.x, o.z, d.x / hl, d.z / hl, maxD * hl);
      if (t2 / hl < res.t) { res.t = t2 / hl; res.kind = 'wall'; res.n.set(hitNormal[0], 0, hitNormal[1]); }
    }
    if (d.y < 0) { const t = -o.y / d.y; if (t < res.t) { res.t = t; res.kind = 'floor'; res.n.set(0, 1, 0); } }
    if (d.y > 0) { const t = (CEIL - o.y) / d.y; if (t < res.t) { res.t = t; res.kind = 'ceil'; res.n.set(0, -1, 0); } }
    if (skipRemotes) return res;
    for (const r of this.remotes.values()) {
      if (!r.alive || !r.has) continue;
      const cr = r.flags & 2;
      // leaning shifts the upper body sideways along the remote's right vector
      const lo = r.lean * 0.3, rx = Math.cos(r.yaw) * lo, rz = -Math.sin(r.yaw) * lo;
      const hy = r.y + (cr ? HEAD_CROUCH : HEAD_STAND) - Math.abs(r.lean) * 0.05;
      const ox = o.x - r.x - rx, oy = o.y - hy, oz = o.z - r.z - rz;
      const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - HEAD_R * HEAD_R, disc = b * b - c;
      if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < res.t) { res.t = t; res.kind = 'player'; res.id = r.id; res.zone = 'h'; } }
      // torso + legs cylinder (torso follows the lean a little)
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
    if (withSound && res.kind) this.sound.impact(res.kind, p, res.t);
    if (res.kind === 'player') { this.particles.blood(p, d, light); return; }
    if (!res.kind) return;
    if (!silentDecal) this.decals.add(p, res.n, res.kind === 'floor' ? 0.07 : 0.085);
    this.particles.dust(p, res.n, res.kind === 'wall' ? light * 1.2 : res.kind === 'ceil' ? light * 1.4 : light * 0.8);
    if (Math.random() < 0.15) this.particles.sparks(p, res.n);
  }

  eyePos(out) {
    const me = this.me;
    return out.set(me.pos.x + Math.cos(me.yaw) * me.leanOff, me.pos.y + lerp(EYE_STAND, EYE_CROUCH, me.crouchK) - Math.abs(me.leanOff) * 0.12, me.pos.z - Math.sin(me.yaw) * me.leanOff);
  }

  shoot() {
    const me = this.me, type = me.weapon, w = WEAPONS[type], inv = me.inv[type];
    inv.mag--;
    me.fireT = 60 / w.rpm;
    const cam = this.camera;
    const o = this.eyePos(this.v1);
    const pitch = me.pitch + me.kickP, yaw = me.yaw + me.kickY;
    const base = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new THREE.Vector3().crossVectors(right, base);
    const moving = Math.min(1, Math.hypot(me.vel.x, me.vel.z) / 3.3);
    const spread = lerp(w.spread, w.adsSpread, me.ads) * (me.crouch ? 0.8 : 1) + moving * w.moveSpread * (1 - me.ads * 0.5) + (me.onGround ? 0 : 0.06) + me.bloom * w.spread * 0.7;
    me.bloom = Math.min(1.6, me.bloom + (w.auto ? 0.28 : 0.4));
    const hits = new Map(), rank = { l: 0, b: 1, h: 2 };
    const muzzleW = this.vmMuzzleWorld(this.v3);
    for (let i = 0; i < w.pellets; i++) {
      const r = spread * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
      const d = base.clone().addScaledVector(right, Math.cos(th) * r).addScaledVector(up, Math.sin(th) * r).normalize();
      const res = this.trace(o, d, w.range);
      if (res.kind === 'player') {
        const h = hits.get(res.id) || { id: res.id, dmg: 0, zone: 'l' };
        h.dmg += dmgAt(w, res.t) * zoneMul(w, res.zone);
        if (rank[res.zone] > rank[h.zone]) h.zone = res.zone;
        hits.set(res.id, h);
      }
      this.impact(res, o, d, i > 4, i === 0);
      if (i === 0 && Math.random() < (w.auto ? 0.4 : 0.25)) {
        const end = o.clone().addScaledVector(d, res.t);
        const td = end.clone().sub(muzzleW); const len = td.length();
        this.tracers.add(muzzleW, td.divideScalar(len), len);
      }
    }
    this.net.send({ t: 'shoot', w: type, o: [o.x, o.y, o.z].map((v) => +v.toFixed(3)), d: [base.x, base.y, base.z].map((v) => +v.toFixed(4)), hits: [...hits.values()].map((h) => ({ id: h.id, dmg: Math.round(h.dmg * 10) / 10, zone: h.zone })) });
    // recoil: vertical climb grows through a burst, horizontal follows a per-burst wave
    if (this.time - me.lastShotT > 0.35) { me.shotIdx = 0; me.patSeed = Math.random() * 6.28; }
    me.lastShotT = this.time;
    const n = me.shotIdx++;
    const k = w.recoil * (1 - 0.35 * me.ads) * (me.crouch ? 0.75 : 1) * (1 + Math.min(n, 8) * 0.06);
    const hd = (n < 2 ? (Math.random() - 0.5) * 0.4 : Math.sin(n * 0.7 + me.patSeed) * 0.9 + (Math.random() - 0.5) * 0.5) * w.hRecoil * (1 - 0.3 * me.ads);
    me.pitch = clamp(me.pitch + k * 0.5, -1.45, 1.45);
    me.kickP += k * 0.7;
    me.kickY += hd;
    me.yaw += hd * 0.6;
    me.vmKick = Math.min(1.4, me.vmKick + 1);
    me.trauma = Math.min(1, me.trauma + (w.pellets > 1 ? 0.35 : type === 'rifle' ? 0.16 : 0.1));
    this.post.final.uniforms.uFlash.value = 0.35;
    this.vmMuzzle.fire(this.vmGuns[type].localToWorld(this.v2.copy(this.vmGuns[type].userData.muzzle)), type === 'pistol' ? 0.14 : 0.22);
    this.vmFlash.intensity = 6;
    this.muzzleLight.position.copy(muzzleW);
    this.muzzleLight.intensity = 22;
    this.muzzleT = 0.05;
    this.sound.shot(type);
    this.particles.smoke(muzzleW, base, 0.8);
    if (type === 'shotgun') { me.pumpT = 0.001; this.sound.pump(0.28); }
    else this.shells.eject(this.vmGuns[type].localToWorld(this.v2.set(0.03, 0.05, -0.05)), type === 'rifle');
    this.world.lastShot = this.time;
  }

  vmMuzzleWorld(out) {
    // viewmodel lives in camera space → transform muzzle into the world
    const g = this.vmGuns[this.me.weapon];
    g.updateMatrixWorld(true);
    out.copy(g.userData.muzzle).applyMatrix4(g.matrixWorld);
    return this.camera.localToWorld(out);
  }

  remoteShot(m) {
    const r = this.remotes.get(m.id);
    const o = new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
    const d = new THREE.Vector3(m.d[0], m.d[1], m.d[2]).normalize();
    const w = WEAPONS[m.w] || WEAPONS.pistol;
    const res = this.trace(o, d, w.range, true);
    let mz = o;
    if (r && r.has) { r.model.root.updateMatrixWorld(true); mz = r.model.muzzleWorld(new THREE.Vector3()); }
    const cp = this.camera.position, dist = mz.distanceTo(cp);
    this.sound.shot(m.w, mz, dist, this.occluded(mz));
    if (dist < 60) {
      this.muzzles.fire(mz, m.w === 'pistol' ? 0.3 : 0.45);
      const L = this.remoteLights[(this.rl = ((this.rl || 0) + 1) % 2)];
      L.position.copy(mz); L.intensity = 18;
      const end = o.clone().addScaledVector(d, res.t);
      const td = end.clone().sub(mz), len = td.length();
      if (Math.random() < 0.6) this.tracers.add(mz, td.divideScalar(len), len);
      if (res.kind && res.t < w.range - 0.1) this.impact(res, o, d, false, end.distanceTo(cp) < 14);
      // supersonic crack / whiz when a round passes close to us
      const toMe = this.v1.copy(cp).sub(o), along = toMe.dot(d);
      if (along > 0 && along < res.t + 0.5) {
        const miss = toMe.addScaledVector(d, -along).length();
        if (miss < 1.6) this.sound.whiz(this.v2.copy(o).addScaledVector(d, along), 1 - miss / 1.6);
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
    if (!this.playing) return;
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    for (const m of this.net.poll()) this.onMsg(m);
    if (this.net.closed && !this.lostShown) { this.lostShown = true; $('banner').textContent = 'SUNUCU BAĞLANTISI KOPTU'; }

    this.updatePlayer(dt);
    this.updateWeapon(dt);
    this.updateCamera(dt);
    this.updateViewmodel(dt);
    this.updateRemotes(dt);
    this.world.update(dt, this.time);
    this.particles.update(dt); this.tracers.update(dt); this.muzzles.update(dt); this.vmMuzzle.update(dt); this.shells.update(dt);
    this.updateAmbience(dt);
    this.updateHud(dt);

    this.sendT -= dt;
    if (this.sendT <= 0 && this.me.alive) {
      this.sendT = 0.05;
      const me = this.me;
      const f = (me.crouch ? 2 : 0) | (me.flash ? 4 : 0) | (Math.hypot(me.vel.x, me.vel.z) > 0.5 ? 8 : 0) | (me.sprint ? 16 : 0) | (me.reloadT > 0 ? 32 : 0) | (me.lean < -0.3 ? 64 : 0) | (me.lean > 0.3 ? 128 : 0);
      this.net.send({ t: 'in', p: [+me.pos.x.toFixed(3), +me.pos.y.toFixed(3), +me.pos.z.toFixed(3)], yw: +me.yaw.toFixed(3), pt: +me.pitch.toFixed(3), f, w: me.weapon });
    }
    // post uniforms
    const u = this.post.final.uniforms, me = this.me;
    u.uTime.value = this.time;
    u.uHurt.value = me.hurt;
    u.uLow.value = me.alive ? clamp((40 - me.hp) / 40, 0, 1) : 0;
    u.uDead.value = me.alive ? 0 : Math.min(1, (this.time - me.deathAt) * 1.5);
    u.uFlash.value = Math.max(0, u.uFlash.value - dt * 8);
    u.uK.value = lerp(0.34, 0.2, me.ads);
    u.uZoom.value = lerp(0.79, 0.86, me.ads);
    const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect);
    const dyaw = angDiff(this.prevYaw ?? me.yaw, me.yaw), dp = me.pitch - (this.prevPitch ?? me.pitch);
    this.prevYaw = me.yaw; this.prevPitch = me.pitch;
    const bx = clamp(-dyaw / hf * 0.6, -0.04, 0.04), by = clamp(dp / THREE.MathUtils.degToRad(this.camera.fov) * 0.6, -0.04, 0.04);
    u.uBlur.value.set(Math.abs(bx) > 0.002 ? bx : 0, Math.abs(by) > 0.002 ? by : 0);
    this.renderer.info.reset();
    this.post.render(this.scene, this.camera, this.vmScene, this.vmCamera);
    this.mouse.dx = this.mouse.dy = 0;
  }

  updatePlayer(dt) {
    const me = this.me, k = this.keys;
    me.hurt = Math.max(0, me.hurt - dt * 1.2);
    me.trauma = Math.max(0, me.trauma - dt * 1.8);
    if (!me.alive) { me.deathT = Math.min(1, me.deathT + dt * 1.6); me.vel.set(0, 0, 0); return; }
    const w = WEAPONS[me.weapon];
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), s = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    me.crouch = !!(k.KeyC || k.ControlLeft || k.ControlRight);
    me.sprint = !!(k.ShiftLeft || k.ShiftRight) && f > 0 && !me.crouch && !this.mouse.r && me.onGround;
    if (me.sprint && me.reloadT > 0) me.sprint = false;
    // lean (Q/E): camera slides sideways around cover, limited by nearby walls
    const leanT = me.sprint ? 0 : (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0);
    me.lean = damp(me.lean, leanT, 9, dt);
    if (Math.abs(me.lean) > 0.01) {
      const sgn = Math.sign(me.lean), rx = Math.cos(me.yaw) * sgn, rz = -Math.sin(me.yaw) * sgn;
      const room = clamp(raycast(this.map, me.pos.x, me.pos.z, rx, rz, 0.8) - 0.2, 0, 0.4);
      me.leanOff = me.lean * Math.min(0.4, room);
    } else me.leanOff = 0;
    let speed = me.crouch ? 1.8 : me.sprint ? 5.5 : 3.3;
    speed *= w.moveMul * (1 - me.ads * 0.35) * (1 - Math.abs(me.lean) * 0.35);
    const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    let wx = -sy * f + cy * s, wz = -cy * f - sy * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx = wx / wl * speed; wz = wz / wl * speed; }
    const acc = me.onGround ? 11 : 1.5;
    me.vel.x = damp(me.vel.x, wx, acc, dt);
    me.vel.z = damp(me.vel.z, wz, acc, dt);
    if (k.Space && me.onGround && !me.crouch) { me.vy = 3.9; me.onGround = false; }
    me.vy -= 13 * dt;
    me.pos.y += me.vy * dt;
    if (me.pos.y <= 0) {
      if (!me.onGround && me.vy < -3) { me.trauma = Math.min(1, me.trauma + 0.15); me.land = Math.min(1, -me.vy / 6); this.sound.step(null, 0.35); this.sound.gear(0.5); }
      me.pos.y = 0; me.vy = 0; me.onGround = true;
    }
    const p = { x: me.pos.x + me.vel.x * dt, z: me.pos.z + me.vel.z * dt };
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
        this.sound.step(null, me.crouch ? 0.06 : me.sprint ? 0.26 : 0.15, me.sprint);
        if (!me.crouch) this.sound.gear(me.sprint ? 0.5 : 0.2);
        if (me.sprint) this.net.send({ t: 'step' });
      }
    }
    // loot crate focus
    let best = -1, bd = 2.1;
    const fx = -sy, fz = -cy;
    this.map.crates.forEach((c, i) => {
      if (this.world.crateState[i].target) return;
      const dx = c.x - me.pos.x, dz = c.z - me.pos.z, d = Math.hypot(dx, dz);
      if (d > bd) return;
      if ((dx * fx + dz * fz) / d < 0.3 && d > 0.8) return;
      if (raycast(this.map, me.pos.x, me.pos.z, dx / d, dz / d, d) < d - 0.05) return;
      best = i; bd = d;
    });
    this.nearCrate = best;
  }

  updateWeapon(dt) {
    const me = this.me, w = WEAPONS[me.weapon], inv = me.inv[me.weapon];
    me.fireT -= dt; me.switchT -= dt;
    me.bloom = Math.max(0, me.bloom - dt * (w.auto ? 2.2 : 3));
    me.kickP = damp(me.kickP, 0, 9, dt); me.kickY = damp(me.kickY, 0, 9, dt);
    me.vmKick = damp(me.vmKick, 0, 16, dt);
    if (me.pumpT > 0) me.pumpT += dt;
    if (me.pumpT > 0.7) me.pumpT = 0;
    this.muzzleT = (this.muzzleT || 0) - dt;
    if (this.muzzleT <= 0) this.muzzleLight.intensity = 0;
    this.vmFlash.intensity = Math.max(0, this.vmFlash.intensity - dt * 120);
    for (const L of this.remoteLights) L.intensity = Math.max(0, L.intensity - dt * 400);
    if (me.reloadT > 0) {
      me.reloadT -= dt;
      if (me.reloadT <= 0) {
        const take = Math.min(w.mag - inv.mag, inv.res);
        inv.mag += take; inv.res -= take;
      }
    }
    const adsWant = this.mouse.r && me.alive && !me.sprint && me.reloadT <= 0 ? 1 : 0;
    me.ads = damp(me.ads, adsWant, 13, dt);
    if (!me.alive || !this.locked) return;
    if (this.mouse.l && me.fireT <= 0 && me.switchT <= 0 && me.reloadT <= 0 && me.sprintK < 0.35 && (me.pumpT === 0 || me.pumpT > 0.6)) {
      if (!w.auto && !this.triggerFresh) return;
      const fresh = this.triggerFresh;
      this.triggerFresh = false;
      if (inv.mag > 0) this.shoot();
      else if (fresh) { this.sound.dry(); this.startReload(); }
    }
  }

  updateCamera(dt) {
    const me = this.me, cam = this.camera;
    const eye = lerp(EYE_STAND, EYE_CROUCH, me.crouchK);
    const hs = Math.hypot(me.vel.x, me.vel.z);
    const bobAmt = Math.min(1, hs / 5) * (1 - me.ads * 0.6) * (me.onGround ? 1 : 0.2);
    const bx = Math.sin(me.bob) * 0.022 * bobAmt, by = -Math.abs(Math.cos(me.bob)) * 0.034 * bobAmt;
    const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    const t = this.time, tr = me.trauma * me.trauma;
    const sx = (Math.sin(t * 37.1) + Math.sin(t * 23.3)) * 0.02 * tr, syw = (Math.sin(t * 31.7) + Math.sin(t * 19.9)) * 0.02 * tr, sz = Math.sin(t * 27.3) * 0.03 * tr;
    const breathe = Math.sin(t * 1.7) * 0.0025;
    me.land = damp(me.land, 0, 5, dt);
    if (me.alive) {
      this.eyePos(cam.position);
      cam.position.x += cy * bx; cam.position.z -= sy * bx;
      cam.position.y += by - me.land * 0.07;
      const strafe = me.vel.x * cy - me.vel.z * sy;
      me.roll = damp(me.roll, -strafe * 0.011 + Math.sin(me.bob) * 0.013 * bobAmt - me.lean * 0.22, 8, dt);
      cam.rotation.set(me.pitch + me.kickP + sx + breathe - me.land * 0.03, me.yaw + me.kickY + syw, me.roll + sz);
    } else {
      const k = me.deathT, e = k * k * (3 - 2 * k);
      cam.position.set(me.pos.x, me.pos.y + lerp(eye, 0.28, e), me.pos.z);
      cam.rotation.set(lerp(me.pitch, 0.35, e), me.yaw, lerp(0, 1.25, e));
    }
    const fov = lerp(80, 64, me.ads);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = this.vmCamera.fov = fov;
      cam.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
      this.particles.uniforms.uScale.value = this.post.h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    }
    cam.updateMatrixWorld();
    // flashlight (chest mounted, slightly right)
    const fl = this.flashlight;
    fl.intensity = me.flash && me.alive ? 40 : 0;
    fl.position.copy(cam.position).add(this.v1.set(0.12, -0.05, 0).applyQuaternion(cam.quaternion));
    fl.target.position.copy(cam.position).add(this.v1.set(0, 0, -10).applyQuaternion(cam.quaternion));
    fl.target.updateMatrixWorld();
    this.sound.listener(cam.position, this.v2.set(0, 0, -1).applyQuaternion(cam.quaternion));
  }

  updateViewmodel(dt) {
    const me = this.me, type = me.weapon, g = this.vmGuns[type], P = POSE[type], a = me.ads;
    const hs = Math.hypot(me.vel.x, me.vel.z);
    const bobAmt = Math.min(1, hs / 5) * (1 - a * 0.85) * (me.onGround ? 1 : 0.3);
    me.swayX = damp(me.swayX, clamp(-this.mouse.dx * 0.00035, -0.04, 0.04), 10, dt);
    me.swayY = damp(me.swayY, clamp(this.mouse.dy * 0.00035, -0.04, 0.04), 10, dt);
    // weapon inertia: the gun lags behind body movement
    const cyw = Math.cos(me.yaw), syw = Math.sin(me.yaw);
    me.inertX = damp(me.inertX, clamp(-(me.vel.x * cyw - me.vel.z * syw) * 0.006, -0.03, 0.03), 7, dt);
    me.inertZ = damp(me.inertZ, clamp((me.vel.x * syw + me.vel.z * cyw) * 0.005, -0.03, 0.03), 7, dt);
    const inert = 1 - a * 0.6;
    const sk = me.sprintK, rk = me.reloadT > 0 ? Math.sin(Math.PI * clamp(1 - me.reloadT / WEAPONS[type].reload, 0, 1)) : 0;
    const wk = Math.max(0, me.switchT / 0.45), kk = me.vmKick;
    const dk = me.alive ? 0 : Math.min(1, me.deathT * 2);
    const sway = 1 - a * 0.7;
    g.position.set(
      lerp(P.hip[0], P.ads[0], a) + me.swayX * sway + Math.sin(me.bob) * 0.012 * bobAmt - 0.05 * sk + me.inertX * inert,
      lerp(P.hip[1], P.ads[1], a) + me.swayY * sway - Math.abs(Math.cos(me.bob)) * 0.012 * bobAmt - 0.04 * sk - 0.07 * rk - 0.28 * wk - 0.4 * dk + Math.sin(this.time * 1.7) * 0.002 - me.land * 0.035,
      lerp(P.hip[2], P.ads[2], a) + 0.045 * kk * (type === 'pistol' ? 0.6 : 1) + 0.03 * sk + me.inertZ * inert,
    );
    g.rotation.set(
      0.07 * kk * (1 - a * 0.5) - 0.42 * sk - 0.35 * rk - 0.7 * wk + me.swayY * 2 * sway,
      me.swayX * 2.5 * sway + 0.62 * sk + (1 - a) * 0.03,
      -me.swayX * 3 * sway + 0.18 * sk + 0.6 * rk + 0.05 * me.crouchK * (1 - a) - me.inertX * 2 * inert,
    );
    const ud = g.userData;
    if (ud.slide) ud.slide.position.x = -Math.min(1, kk) * 0.028;
    if (ud.pump) { const p = me.pumpT > 0.25 ? Math.sin(Math.PI * clamp((me.pumpT - 0.25) / 0.35, 0, 1)) : 0; ud.pump.position.x = -0.09 * p; }
    if (me.pumpT > 0.4 && !me.shellOut) { me.shellOut = true; this.shells.eject(g.localToWorld(this.v2.set(0.03, 0.04, -0.05)), true); }
    if (me.pumpT === 0) me.shellOut = false;
    this.arms.update(g, type);
    // lighting of the viewmodel follows the local baked light
    const L = this.world.sampleLight(me.pos.x, me.pos.z);
    this.vmAmb.intensity = 0.25 + L * 0.9 + (me.flash ? 0.25 : 0);
    this.vmDir.intensity = 0.3 + L * 1.6;
    const inv = this.camera.quaternion.clone().invert();
    this.vmDir.position.set(0.3, 1, 0.2).applyQuaternion(inv);
  }

  updateRemotes(dt) {
    const k = 1 - Math.exp(-dt * 14);
    const cp = this.camera.position;
    for (const r of this.remotes.values()) {
      if (!r.has) { r.model.root.visible = false; continue; }
      const ox = r.x, oz = r.z;
      r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k;
      r.yaw += angDiff(r.yaw, r.tyaw) * k; r.pitch += (r.tpitch - r.pitch) * k;
      r.lean = damp(r.lean, r.flags & 64 ? -1 : r.flags & 128 ? 1 : 0, 9, dt);
      r.speed = damp(r.speed, Math.hypot(r.x - ox, r.z - oz) / Math.max(dt, 1e-4), 10, dt);
      const dist = Math.hypot(r.x - cp.x, r.z - cp.z);
      r.model.root.visible = dist < 62;
      if (!r.model.root.visible) continue;
      r.model.setWeapon(WEAPON_ORDER[r.w] || 'pistol');
      const L = this.world.sampleLight(r.x, r.z) * 0.95 + 0.03;
      r.model.update(dt, { x: r.x, y: r.y, z: r.z, yaw: r.yaw, pitch: r.pitch, crouch: !!(r.flags & 2), speed: r.alive ? r.speed : 0, alive: r.alive, flash: r.flags & 4, lean: r.lean }, L);
      if (r.alive && r.speed > 1 && !(r.flags & 2) && r.y < 0.05) {
        r.stepAcc += r.speed * dt;
        if (r.stepAcc > 1.7) {
          r.stepAcc = 0;
          const sp = this.v1.set(r.x, 0.1, r.z);
          if (dist < 30) this.sound.step(sp, r.speed > 4.2 ? 0.45 : 0.28, r.speed > 4.2, this.occluded(sp));
        }
      }
    }
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
    this.ambT = (this.ambT ?? 12) - dt;
    if (this.ambT <= 0) {
      this.ambT = 14 + Math.random() * 30;
      const a = Math.random() * Math.PI * 2, r = 25 + Math.random() * 20;
      this.sound.distant(this.v1.set(cp.x + Math.cos(a) * r, 1.5, cp.z + Math.sin(a) * r));
    }
  }

  // ------------------------------------------------------------------ HUD
  updateHud(dt) {
    const me = this.me, w = WEAPONS[me.weapon], inv = me.inv[me.weapon];
    this.hudT = (this.hudT || 0) - dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      $('clock').textContent = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      $('hp').textContent = Math.ceil(me.hp); $('hpbar').style.width = `${me.hp}%`;
      $('hpbar').style.background = me.hp < 35 ? '#ff5a4a' : '#e9e4d4';
      $('ar').textContent = Math.ceil(me.armor); $('arbar').style.width = `${me.armor}%`;
      $('wname').textContent = w.label + (me.reloadT > 0 ? ' · ŞARJÖR DEĞİŞİYOR' : '');
      $('mag').textContent = inv.mag; $('res').textContent = inv.res;
      $('mag').classList.toggle('low', inv.mag <= Math.ceil(w.mag * 0.25));
      $('kd').textContent = `LEŞ ${me.kills} · ÖLÜM ${me.deaths}`;
      const pr = $('prompt');
      if (this.nearCrate >= 0 && me.alive) { pr.style.display = 'block'; pr.innerHTML = '<b>[F]</b> Kutuyu aç'; } else pr.style.display = 'none';
      if (!me.alive) $('respawn').textContent = `Yeniden doğma: ${Math.max(0, 4 - (this.time - me.deathAt)).toFixed(1)} sn`;
      if (!$('score').classList.contains('hidden')) this.renderScore();
      // aimed player name
      if (me.alive) {
        const cam = this.camera, dir = this.v1.set(0, 0, -1).applyQuaternion(cam.quaternion);
        const res = this.trace(cam.position, dir, 40);
        $('aimname').textContent = res.kind === 'player' ? this.names.get(res.id)?.name || '' : '';
      } else $('aimname').textContent = '';
    }
    if (me.alive && me.hp < 35) {
      me.beatT -= dt;
      if (me.beatT <= 0) { me.beatT = 0.85; this.sound.beat(); }
    }
  }

  renderSlots() {
    $('slots').innerHTML = WEAPON_ORDER.map((t, i) => (this.me.inv[t] ? `<span class="${t === this.me.weapon ? 'on' : ''}">${i + 1}·${SHORT[t]}</span>` : '')).join('');
  }

  renderScore() {
    const rows = [];
    rows.push({ id: this.myId, name: settings.name, k: this.me.kills, d: this.me.deaths, bot: false });
    for (const r of this.remotes.values()) { const n = this.names.get(r.id); rows.push({ id: r.id, name: n?.name || '?', k: r.kills, d: r.deaths, bot: n?.bot }); }
    rows.sort((a, b) => b.k - a.k || a.d - b.d);
    $('scorebody').innerHTML = rows.map((r) => `<tr class="${r.id === this.myId ? 'me' : ''}"><td>${esc(r.name)} ${r.bot ? '<span class="bot">BOT</span>' : ''}</td><td>${r.k}</td><td>${r.d}</td></tr>`).join('');
    $('fraglimit').textContent = `İlk ${this.fragLimit} leşe ulaşan maçı kazanır.`;
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

// ------------------------------------------------------------------ menu wiring
const game = new Game();
$('name').value = settings.name;
$('sens').value = settings.sens; $('sensv').textContent = (+settings.sens).toFixed(2);
$('quality').value = settings.quality;
$('xhairOpt').checked = settings.xhair;
$('vol').value = settings.vol;
$('bots').oninput = () => { $('botsv').textContent = $('bots').value; };
$('sens').oninput = () => { settings.sens = +$('sens').value; $('sensv').textContent = settings.sens.toFixed(2); saveSettings(); };
$('quality').onchange = () => { settings.quality = +$('quality').value; saveSettings(); };
$('xhairOpt').onchange = () => { settings.xhair = $('xhairOpt').checked; saveSettings(); };
$('vol').oninput = () => { settings.vol = +$('vol').value; saveSettings(); game.sound.setVolume(settings.vol); };
$('name').onchange = () => { settings.name = $('name').value.trim().slice(0, 16) || 'Gezgin'; saveSettings(); };
const go = (mode) => {
  settings.name = $('name').value.trim().slice(0, 16) || 'Gezgin'; saveSettings();
  $('btnOnline').disabled = $('btnOffline').disabled = true;
  game.start(mode).finally(() => { if (!game.playing) { $('btnOffline').disabled = false; $('btnOnline').disabled = !onlineOk; } });
};
let onlineOk = false;
$('btnOffline').onclick = () => go('offline');
$('btnOnline').onclick = () => go('online');
if (location.protocol.startsWith('http')) {
  Net.online(1500).then((n) => {
    n.close(); onlineOk = true;
    $('onlineInfo').textContent = `Sunucu aktif: ${location.host} — arkadaşların aynı adresi açarak katılabilir.`;
    $('btnOnline').disabled = false;
  }).catch(() => { $('onlineInfo').textContent = 'Sunucu bulunamadı. Çok oyunculu için "npm start" ile sunucuyu başlat.'; });
} else $('onlineInfo').textContent = 'Dosyadan açıldı. Çok oyunculu için "npm start" ile sunucuyu başlat.';
window.__game = game;

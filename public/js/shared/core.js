// Authoritative game simulation. Runs in Node (multiplayer server) or in the browser (offline vs bots).
import { generateMap, raycast, lineOfSight, collide, findPath, cellIndex, cellCenter } from './map.js';
import { WEAPONS, WEAPON_ORDER, dmgAt, rollLoot, zoneMul } from './weapons.js';

export const PLAYER_R = 0.32;
export const EYE_STAND = 1.42, EYE_CROUCH = 0.95; // chest-mounted body camera height
export const HEAD_STAND = 1.64, HEAD_CROUCH = 1.16, HEAD_R = 0.15;
export const BODY_R = 0.27;
export const MAX_HP = 100, MAX_ARMOR = 100;
export const COLORS = ['#2f3b52', '#4a3a2a', '#23402f', '#5a2626', '#3d3d3d', '#2b4a5a', '#53461f', '#402a4d', '#1f3a3a', '#5a3d1f', '#343c1c', '#4d2a3d'];

const BOT_NAMES = ['Kayıp_Gezgin', 'M.E.G.Ajanı', 'Gülümseyen', 'Parti_Kuşu', 'Sarı_Duvar', 'Yankı', 'Tazı', 'Nem', 'Vızıltı',
  'Floresan', 'Halı_Kokusu', 'Seviye_0', 'Kapı_Arayan', 'NoClip', 'Uğultu'];
const DIFF = [
  { react: 0.8, acc: 0.2, turn: 4.5, rate: 0.55 },
  { react: 0.5, acc: 0.3, turn: 7, rate: 0.7 },
  { react: 0.3, acc: 0.42, turn: 11, rate: 0.85 },
];

const r2 = (v) => Math.round(v * 100) / 100;
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class GameCore {
  constructor(opts = {}) {
    this.seed = opts.seed ?? ((Math.random() * 1e9) | 0);
    this.size = opts.size ?? 18;
    this.map = generateMap(this.seed, this.size);
    this.botTarget = opts.bots ?? 5;      // desired total participants filled with bots
    this.difficulty = opts.difficulty ?? 1;
    this.fragLimit = opts.fragLimit ?? 25;
    this.time = 0;
    this.players = new Map();
    this.clients = new Map();
    this.crates = this.map.crates.map((c) => ({ id: c.id, open: false, respawnAt: 0 }));
    this.snapAcc = 0;
    this.botSeq = 0;
    this.colorSeq = 0;
    this.intermission = 0;
    this.noises = [];
    this.syncBots();
  }

  // ---- connection API ----
  join(id, send) { this.clients.set(id, { send, player: null }); }
  leave(id) {
    this.clients.delete(id);
    if (this.players.delete(id)) { this.syncBots(); this.broadcastRoster(); }
  }
  send(id, msg) { const c = this.clients.get(id); if (c) c.send(msg); }
  broadcast(msg, except) { for (const [id, c] of this.clients) if (id !== except && c.player) c.send(msg); }

  handle(id, msg) {
    const c = this.clients.get(id);
    if (!c || !msg || typeof msg.t !== 'string') return;
    if (msg.t === 'join') {
      if (c.player) return;
      const name = String(msg.name || 'Oyuncu').replace(/[<>&"]/g, '').slice(0, 16) || 'Oyuncu';
      const p = this.makePlayer(id, name, false);
      c.player = p;
      this.players.set(id, p);
      this.syncBots();
      this.spawn(p);
      this.send(id, { t: 'welcome', id, seed: this.seed, size: this.size, crates: this.crates.map((k) => (k.open ? 1 : 0)), fragLimit: this.fragLimit });
      this.broadcastRoster();
      this.send(id, this.spawnMsg(p));
      return;
    }
    const p = c.player;
    if (!p) return;
    switch (msg.t) {
      case 'in': {
        if (!p.alive || !Array.isArray(msg.p)) return;
        const [x, y, z] = msg.p.map(Number);
        if (![x, y, z].every(Number.isFinite)) return;
        if (Math.hypot(x - p.x, z - p.z) > 6) return; // reject teleports
        p.x = x; p.y = Math.max(0, Math.min(2, y)); p.z = z;
        p.yaw = +msg.yw || 0; p.pitch = +msg.pt || 0;
        p.flags = (msg.f | 0) & 0b11111110;
        p.crouch = !!(p.flags & 2);
        if (WEAPONS[msg.w]) p.weapon = msg.w;
        return;
      }
      case 'shoot': this.onShoot(p, msg); return;
      case 'open': this.onOpen(p, msg.id | 0); return;
      case 'step': if (p.alive) this.noise(p, 9); return;
    }
  }

  // ---- players ----
  makePlayer(id, name, bot) {
    return {
      id, name, bot, color: COLORS[this.colorSeq++ % COLORS.length],
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, flags: 0,
      hp: MAX_HP, armor: 0, alive: false, respawnAt: 0, weapon: 'pistol', kills: 0, deaths: 0,
      lastShot: -1, spawnT: 0,
      // bot brain
      path: null, pi: 0, target: null, scanT: 0, reactUntil: 0, nextShot: 0, mag: 0, reloadUntil: 0,
      burst: 0, strafe: 1, strafeT: 0, lastSeen: null, stuckT: 0, lastPos: [0, 0], goal: -1,
    };
  }

  syncBots() {
    const humans = [...this.players.values()].filter((p) => !p.bot).length;
    const want = Math.max(0, this.botTarget - humans);
    const bots = [...this.players.values()].filter((p) => p.bot);
    if (bots.length > want) {
      for (const b of bots.slice(want)) this.players.delete(b.id);
    } else {
      for (let i = bots.length; i < want; i++) {
        const id = 'b' + ++this.botSeq;
        const b = this.makePlayer(id, BOT_NAMES[(this.botSeq - 1) % BOT_NAMES.length], true);
        this.players.set(id, b);
        this.spawn(b);
      }
    }
    if (this.clients.size) this.broadcastRoster();
  }

  broadcastRoster() {
    this.broadcast({ t: 'roster', list: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, bot: p.bot, color: p.color })) });
  }

  spawn(p) {
    const map = this.map;
    let best = null, bestD = -1;
    for (let i = 0; i < 20; i++) {
      const cell = (Math.random() * map.W * map.H) | 0;
      const [x, z] = cellCenter(map, cell);
      let d = 1e9;
      for (const o of this.players.values()) if (o !== p && o.alive) d = Math.min(d, Math.hypot(o.x - x, o.z - z));
      if (d > bestD) { bestD = d; best = [x, z]; }
    }
    p.x = best[0] + (Math.random() - 0.5); p.z = best[1] + (Math.random() - 0.5); p.y = 0;
    p.yaw = Math.random() * Math.PI * 2; p.pitch = 0;
    p.hp = MAX_HP; p.armor = 0; p.alive = true; p.spawnT = this.time;
    p.path = null; p.target = null; p.lastSeen = null;
    if (p.bot) {
      const r = Math.random();
      p.weapon = r < 0.3 ? 'pistol' : r < 0.55 ? 'smg' : r < 0.75 ? 'shotgun' : 'rifle';
      p.mag = WEAPONS[p.weapon].mag; p.reloadUntil = 0;
    } else {
      p.weapon = 'pistol';
    }
  }

  spawnMsg(p) { return { t: 'spawn', x: p.x, z: p.z, yaw: p.yaw }; }

  // zone: 'h' head, 'b' torso (armor plate applies), 'l' legs
  damage(target, amount, attacker, weapon, zone) {
    if (!target.alive || this.intermission) return;
    if (this.time - target.spawnT < 1.5) return; // spawn protection
    let d = amount, plate = false;
    if (zone === 'b' && target.armor > 0) { const a = Math.min(target.armor, d * 0.5); target.armor -= a; d -= a; plate = true; }
    target.hp = Math.max(0, target.hp - d);
    if (!target.bot) this.send(target.id, { t: 'hurt', from: [attacker.x, attacker.z], dmg: Math.round(amount), zone, hp: Math.ceil(target.hp), armor: Math.ceil(target.armor) });
    else if (attacker !== target && (!target.target || Math.random() < 0.5)) { target.target = attacker; target.reactUntil = this.time + 0.25; }
    const kill = target.hp <= 0;
    if (!attacker.bot && attacker !== target) this.send(attacker.id, { t: 'hit', kill, zone, plate, id: target.id });
    if (kill) {
      target.alive = false; target.hp = 0; target.deaths++;
      target.respawnAt = this.time + 4;
      if (attacker !== target) attacker.kills++;
      this.broadcast({ t: 'kill', k: attacker.id, v: target.id, w: weapon, h: zone === 'h' });
      if (attacker.kills >= this.fragLimit && !this.intermission) {
        this.intermission = this.time + 9;
        this.broadcast({ t: 'match', winner: attacker.id, name: attacker.name });
      }
    }
  }

  // Peeks around corners: accept if the target center, either flank (lean/shoulder), or the
  // shooter's claimed ray (origin clamped near the server position) reaches the target.
  hitValid(p, t, o, d) {
    const map = this.map;
    if (lineOfSight(map, p.x, p.z, t.x, t.z)) return true;
    const dx = t.x - p.x, dz = t.z - p.z, L = Math.hypot(dx, dz) || 1, s = PLAYER_R + 0.3;
    const sx = (-dz / L) * s, sz = (dx / L) * s;
    if (lineOfSight(map, p.x, p.z, t.x + sx, t.z + sz) || lineOfSight(map, p.x, p.z, t.x - sx, t.z - sz)) return true;
    let ox = o[0], oz = o[2];
    const od = Math.hypot(ox - p.x, oz - p.z);
    if (od > 1) { ox = p.x + (ox - p.x) / od; oz = p.z + (oz - p.z) / od; }
    const hl = Math.hypot(d[0], d[2]);
    if (hl < 1e-4) return false;
    const td = Math.hypot(t.x - ox, t.z - oz);
    return raycast(map, ox, oz, d[0] / hl, d[2] / hl, td) >= td - 0.6;
  }

  onShoot(p, msg) {
    const w = WEAPONS[msg.w];
    if (!p.alive || !w || !Array.isArray(msg.o) || !Array.isArray(msg.d)) return;
    const minGap = 60 / w.rpm * 0.7;
    if (this.time - p.lastShot < minGap) return;
    p.lastShot = this.time;
    p.weapon = msg.w;
    const o = msg.o.slice(0, 3).map(Number), d = msg.d.slice(0, 3).map(Number);
    if (![...o, ...d].every(Number.isFinite)) return;
    this.broadcast({ t: 'shot', id: p.id, w: msg.w, o: o.map(r2), d: d.map((v) => Math.round(v * 1000) / 1000) }, p.id);
    this.noise(p, 30);
    if (!Array.isArray(msg.hits)) return;
    for (const h of msg.hits.slice(0, 8)) {
      if (!h || typeof h !== 'object') continue;
      const t = this.players.get(h.id);
      if (!t || t === p || !t.alive) continue;
      const dist = Math.hypot(t.x - p.x, t.z - p.z);
      if (dist > w.range + 2) continue;
      if (!this.hitValid(p, t, o, d)) continue;
      const zone = h.zone === 'h' || h.zone === 'l' ? h.zone : 'b';
      const cap = w.dmg * zoneMul(w, zone) * w.pellets * 1.01;
      const dmg = Math.max(0, Math.min(cap, +h.dmg || 0));
      if (dmg > 0) this.damage(t, dmg, p, msg.w, zone);
    }
  }

  onOpen(p, id) {
    const c = this.crates[id], mc = this.map.crates[id];
    if (!c || c.open || !p.alive) return;
    if (Math.hypot(mc.x - p.x, mc.z - p.z) > 2.6) return;
    c.open = true; c.respawnAt = this.time + 40;
    const loot = rollLoot();
    if (loot.k === 'med') p.hp = Math.min(MAX_HP, p.hp + loot.v);
    if (loot.k === 'armor') p.armor = Math.min(MAX_ARMOR, p.armor + loot.v);
    this.broadcast({ t: 'crate', id, open: 1, by: p.id });
    this.send(p.id, { t: 'loot', id, loot, hp: Math.ceil(p.hp), armor: Math.ceil(p.armor) });
  }

  noise(p, radius) { this.noises.push({ x: p.x, z: p.z, r: radius, src: p, t: this.time }); }

  // ---- simulation ----
  tick(dt) {
    this.time += dt;
    const t = this.time;
    if (this.intermission && t >= this.intermission) {
      // new match on a freshly generated level
      this.intermission = 0;
      this.seed = (Math.random() * 1e9) | 0;
      this.map = generateMap(this.seed, this.size);
      this.crates = this.map.crates.map((c) => ({ id: c.id, open: false, respawnAt: 0 }));
      this.broadcast({ t: 'reset', seed: this.seed, size: this.size });
      for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; this.spawn(p); if (!p.bot) this.send(p.id, this.spawnMsg(p)); }
    }
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (t >= p.respawnAt && !this.intermission) {
          this.spawn(p);
          if (!p.bot) this.send(p.id, this.spawnMsg(p));
        }
        continue;
      }
      if (p.bot) this.botThink(p, dt);
    }
    this.noises.length = 0;
    for (const c of this.crates) if (c.open && t >= c.respawnAt) { c.open = false; this.broadcast({ t: 'crate', id: c.id, open: 0 }); }
    this.snapAcc += dt;
    if (this.snapAcc >= 0.05) {
      this.snapAcc = 0;
      const ps = [];
      for (const p of this.players.values()) {
        const f = (p.alive ? 1 : 0) | (p.flags & 0b11111110);
        ps.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), f, WEAPON_ORDER.indexOf(p.weapon), Math.ceil(p.hp), Math.ceil(p.armor), p.kills, p.deaths]);
      }
      this.broadcast({ t: 'snap', ps });
    }
  }

  findTarget(b) {
    let best = null, bd = 34;
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    for (const o of this.players.values()) {
      if (o === b || !o.alive) continue;
      const dx = o.x - b.x, dz = o.z - b.z, d = Math.hypot(dx, dz);
      if (d >= bd) continue;
      const facing = (dx * fx + dz * fz) / (d || 1);
      const dark = o.flags & 4 ? 1 : 0.85;
      if (facing < -0.3 && d > 4) continue;
      if (d > 26 * dark && facing < 0.5) continue;
      if (!lineOfSight(this.map, b.x, b.z, o.x, o.z)) continue;
      best = o; bd = d;
    }
    return best;
  }

  botThink(b, dt) {
    const map = this.map, t = this.time, D = DIFF[this.difficulty] || DIFF[1], w = WEAPONS[b.weapon];
    b.scanT -= dt;
    if (b.scanT <= 0) {
      b.scanT = 0.15 + Math.random() * 0.1;
      const nt = this.findTarget(b);
      if (nt && nt !== b.target) b.reactUntil = t + D.react * (0.7 + Math.random() * 0.6);
      if (nt) b.target = nt;
      else if (b.target && (!b.target.alive || !lineOfSight(map, b.x, b.z, b.target.x, b.target.z))) {
        if (b.target.alive) b.lastSeen = { x: b.target.x, z: b.target.z, t };
        b.target = null; b.path = null;
      }
      if (!b.target) {
        for (const n of this.noises) {
          if (n.src === b || Math.hypot(n.x - b.x, n.z - b.z) > n.r) continue;
          if (!b.lastSeen || t - b.lastSeen.t > 2) { b.lastSeen = { x: n.x, z: n.z, t }; b.path = null; }
        }
      }
    }
    // reload handling
    if (b.reloadUntil && t >= b.reloadUntil) { b.reloadUntil = 0; b.mag = w.mag; }
    if (!b.reloadUntil && b.mag <= 0) b.reloadUntil = t + w.reload;

    let mx = 0, mz = 0, speed = 3.3;
    const tg = b.target && b.target.alive ? b.target : null;
    if (tg) {
      const dx = tg.x - b.x, dz = tg.z - b.z, dist = Math.hypot(dx, dz);
      const want = Math.atan2(-dx, -dz);
      b.yaw += Math.max(-D.turn * dt, Math.min(D.turn * dt, angDiff(b.yaw, want)));
      const aimH = tg.crouch ? 1.0 : 1.3;
      b.pitch = Math.atan2(aimH - (b.y + EYE_STAND), dist);
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeT = 0.5 + Math.random() * 1.2; if (Math.random() < 0.25) b.strafe = 0; }
      const rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
      mx = rx * b.strafe; mz = rz * b.strafe;
      const ideal = b.weapon === 'shotgun' ? 5 : b.weapon === 'smg' ? 9 : b.weapon === 'pistol' ? 12 : 16;
      const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
      if (dist > ideal + 3) { mx += fx; mz += fz; } else if (dist < ideal * 0.5) { mx -= fx * 0.7; mz -= fz * 0.7; }
      speed = 2.5;
      b.lastSeen = { x: tg.x, z: tg.z, t };
      const aimed = Math.abs(angDiff(b.yaw, want)) < 0.18;
      if (aimed && t >= b.reactUntil && t >= b.nextShot && !b.reloadUntil && b.mag > 0 && !this.intermission && t - b.spawnT > 1) {
        this.botFire(b, tg, dist, D, w);
      }
    } else {
      b.target = null;
      const here = cellIndex(map, b.x, b.z);
      if (!b.path || b.pi >= b.path.length) {
        let goal;
        if (b.lastSeen && t - b.lastSeen.t < 8) { goal = cellIndex(map, b.lastSeen.x, b.lastSeen.z); b.lastSeen = null; }
        else goal = (Math.random() * map.W * map.H) | 0;
        b.path = findPath(map, here, goal) || [];
        b.pi = 0;
      }
      if (b.path.length && b.pi < b.path.length) {
        const [cx, cz] = cellCenter(map, b.path[b.pi]);
        const dx = cx - b.x, dz = cz - b.z, d = Math.hypot(dx, dz);
        if (d < 0.5) b.pi++;
        else {
          const want = Math.atan2(-dx, -dz);
          b.yaw += Math.max(-6 * dt, Math.min(6 * dt, angDiff(b.yaw, want)));
          b.pitch *= 0.9;
          mx = dx / d; mz = dz / d;
        }
      }
    }
    const ml = Math.hypot(mx, mz);
    const ox = b.x, oz = b.z;
    if (ml > 0.01) {
      b.x += (mx / ml) * speed * w.moveMul * dt;
      b.z += (mz / ml) * speed * w.moveMul * dt;
      collide(map, b, PLAYER_R);
    }
    const moved = Math.hypot(b.x - ox, b.z - oz);
    b.flags = (moved > 0.02 ? 8 : 0) | (b.reloadUntil ? 32 : 0);
    // stuck detection
    if (ml > 0.01 && moved < speed * dt * 0.25) { b.stuckT += dt; if (b.stuckT > 0.8) { b.stuckT = 0; b.path = null; b.strafe = -b.strafe; } }
    else b.stuckT = 0;
  }

  botFire(b, tg, dist, D, w) {
    const auto = w.auto;
    b.mag--;
    if (auto) {
      b.burst++;
      if (b.burst >= 3 + ((Math.random() * 5) | 0)) { b.burst = 0; b.nextShot = this.time + 0.35 + Math.random() * 0.4; }
      else b.nextShot = this.time + 60 / (w.rpm * D.rate);
    } else b.nextShot = this.time + 60 / w.rpm + (w === WEAPONS.shotgun ? 0.35 : 0.2 + Math.random() * 0.35) / D.rate;
    let p = D.acc * Math.max(0.12, 1 - dist / (w.range * 0.95));
    if (tg.flags & 8) p *= 0.75;
    if (tg.crouch) p *= 0.85;
    if (w.pellets > 1) p = Math.min(0.95, p * 1.8);
    // most pellets/bullets land center mass; better bots find heads more often
    const headP = 0.08 + this.difficulty * 0.05;
    let dmg = 0, hits = 0, zone = null;
    const rank = { l: 0, b: 1, h: 2 };
    for (let i = 0; i < w.pellets; i++) {
      if (Math.random() < p) {
        hits++;
        const r = Math.random(), z = r < headP ? 'h' : r < headP + 0.22 ? 'l' : 'b';
        if (!zone || rank[z] > rank[zone]) zone = z;
        dmg += dmgAt(w, dist) * zoneMul(w, z);
      }
    }
    const ex = hits ? 0 : (Math.random() - 0.5) * 0.9, ey = hits ? 0 : (Math.random() - 0.3) * 0.5;
    const ty = (tg.crouch ? 0.95 : 1.3) + ey - (b.y + EYE_STAND);
    const dx = tg.x - b.x + Math.cos(b.yaw) * ex, dz = tg.z - b.z - Math.sin(b.yaw) * ex;
    const L = Math.hypot(dx, ty, dz) || 1;
    const o = [r2(b.x), r2(b.y + EYE_STAND), r2(b.z)];
    const msg = { t: 'shot', id: b.id, w: b.weapon, o, d: [dx / L, ty / L, dz / L].map((v) => Math.round(v * 1000) / 1000) };
    this.broadcast(msg);
    this.noise(b, 30);
    if (dmg > 0) this.damage(tg, dmg, b, b.weapon, zone);
  }
}

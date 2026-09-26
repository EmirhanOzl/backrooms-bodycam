// Authoritative game simulation. Runs in Node (multiplayer server), in a Web Worker (offline vs bots)
// or on the page's main thread as a fallback. No DOM access.
import { generateMap, raycast, lineOfSight, collide, findPath, cellIndex, cellCenter, CRATE_H } from './map.js';
import { WEAPONS, GRENADE, MAX_NADES, dmgAt, zoneMul, meleeDamage, blastDamage, WEAPON_ORDER } from './weapons.js';
import { ITEMS, ATT, fitsAtt, magSize, shotNoise, ECON, BONUS, SHOP, VENDOR_R, WEAPON_RANK, crateLoot } from './items.js';
import { NADE_STEP, makeNade, stepNade } from './physics.js';

export const PLAYER_R = 0.32;
export const EYE_STAND = 1.42, EYE_CROUCH = 0.95; // chest-mounted body camera height
export const HEAD_STAND = 1.64, HEAD_CROUCH = 1.16, HEAD_R = 0.15;
export const BODY_R = 0.27;
export const MAX_HP = 100, MAX_ARMOR = 100;
export const RESPAWN_T = 4, PROTECT_T = 2, INTERMISSION_T = 11;
// player flag bits (snapshots / input)
export const F = { ALIVE: 1, CROUCH: 2, FLASH: 4, MOVE: 8, SPRINT: 16, RELOAD: 32, LEAN_L: 64, LEAN_R: 128, PROTECT: 256, ADS: 512 };
const CLIENT_FLAGS = F.CROUCH | F.FLASH | F.MOVE | F.SPRINT | F.RELOAD | F.LEAN_L | F.LEAN_R | F.ADS;
export const TEAM_COLORS = ['#27456f', '#6f2727'];
export const TEAM_NAMES = ['MAVİ', 'KIRMIZI'];
export const COLORS = ['#2f3b52', '#4a3a2a', '#23402f', '#5a2626', '#3d3d3d', '#2b4a5a', '#53461f', '#402a4d', '#1f3a3a', '#5a3d1f', '#343c1c', '#4d2a3d'];

const BOT_NAMES = ['Kayıp_Gezgin', 'M.E.G.Ajanı', 'Gülümseyen', 'Parti_Kuşu', 'Sarı_Duvar', 'Yankı', 'Tazı', 'Nem', 'Vızıltı',
  'Floresan', 'Halı_Kokusu', 'Seviye_0', 'Kapı_Arayan', 'NoClip', 'Uğultu', 'Badem_Suyu', 'Pencereci', 'Koridor'];
const DIFF = [
  { react: 0.75, acc: 0.2, turn: 4.5, rate: 0.55, hs: 0.06, nade: 0.0, crouch: 0.1, melee: 0.5 },
  { react: 0.45, acc: 0.3, turn: 7, rate: 0.72, hs: 0.12, nade: 0.3, crouch: 0.25, melee: 0.8 },
  { react: 0.28, acc: 0.42, turn: 11, rate: 0.88, hs: 0.16, nade: 0.55, crouch: 0.35, melee: 1 },
];
const BOT_PRIMARY = [['smg', 30], ['shotgun', 22], ['rifle', 20], ['m4', 20], ['sniper', 8]];
// body launch on a kill by weapon: [horizontal m/s, upward m/s]
const KNOCK = { pistol: [1.3, 0.3], revolver: [2.6, 0.7], smg: [1.5, 0.35], shotgun: [5.2, 1.6], rifle: [2.1, 0.5], m4: [1.9, 0.45], sniper: [4.2, 1.1], knife: [1.2, 0.2] };

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const fin = (a, n) => Array.isArray(a) && a.length >= n && a.slice(0, n).every((v) => Number.isFinite(+v));
function pickWeighted(list) {
  let x = Math.random() * list.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of list) if ((x -= w) < 0) return k;
  return list[0][0];
}

export class GameCore {
  constructor(opts = {}) {
    this.size = opts.size ?? 18;
    this.botTarget = opts.bots ?? 5;      // desired total participants, filled with bots
    this.difficulty = clamp(opts.difficulty ?? 1, 0, 2);
    this.fragLimit = opts.fragLimit ?? 25;
    this.timeLimit = opts.timeLimit ?? 600;
    this.mode = opts.mode === 'tdm' ? 'tdm' : 'ffa';
    this.light = ['normal', 'dim', 'dark'].includes(opts.light) ? opts.light : 'normal';
    this.teamScore = [0, 0];
    this.time = 0;
    this.players = new Map();
    this.clients = new Map();
    this.botSeq = 0;
    this.colorSeq = 0;
    this.newLevel(opts.seed ?? ((Math.random() * 1e9) | 0));
    this.syncBots();
  }

  newLevel(seed) {
    this.seed = seed;
    this.map = generateMap(this.seed, this.size, this.light);
    this.crates = this.map.crates.map((c) => ({ id: c.id, open: false, respawnAt: 0 }));
    this.drops = new Map();
    this.dropSeq = 0;
    this.nades = [];
    this.nadeSeq = 0;
    this.noises = [];
    this.intermission = 0;
    this.matchStart = this.time;
    this.firstBlood = false;
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
      const name = String(msg.name || 'Oyuncu').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Oyuncu';
      const p = this.makePlayer(id, name, false);
      this.assignTeam(p);
      c.player = p;
      this.players.set(id, p);
      this.syncBots();
      this.spawn(p);
      this.send(id, {
        t: 'welcome', id, seed: this.seed, size: this.size, light: this.light, crates: this.crates.map((k) => (k.open ? 1 : 0)),
        drops: [...this.drops.values()].map(dropMsg), fragLimit: this.fragLimit, timeLimit: this.timeLimit, st: r3(this.time),
        mode: this.mode, team: p.team, teamScore: this.teamScore, cash: p.cash,
      });
      this.broadcastRoster();
      this.send(id, this.spawnMsg(p));
      return;
    }
    if (msg.t === 'ping') { this.send(id, { t: 'pong', c: msg.c, st: r3(this.time) }); return; }
    const p = c.player;
    if (!p) return;
    switch (msg.t) {
      case 'in': {
        if (!p.alive || !fin(msg.p, 3)) return;
        const [x, y, z] = msg.p.map(Number);
        if (Math.hypot(x - p.x, z - p.z) > 6) return; // reject teleports
        p.x = x; p.y = clamp(y, 0, 2); p.z = z;
        p.yaw = +msg.yw || 0; p.pitch = clamp(+msg.pt || 0, -1.6, 1.6);
        p.flags = (msg.f | 0) & CLIENT_FLAGS;
        p.crouch = !!(p.flags & F.CROUCH);
        if (this.owns(p, msg.w)) p.weapon = msg.w;
        return;
      }
      case 'shoot': this.onShoot(p, msg); return;
      case 'swing': this.onSwing(p, !!msg.h); return;
      case 'stab': this.onStab(p, msg); return;
      case 'nade': this.onNade(p, msg); return;
      case 'open': this.onOpen(p, msg.id | 0); return;
      case 'pickup': this.onPickup(p, msg.id | 0); return;
      case 'buy': this.onBuy(p, msg); return;
      case 'step': if (p.alive) this.noise(p, msg.run ? 10 : 6); return;
    }
  }

  owns(p, w) { return typeof w === 'string' && (w === 'knife' || (w === p.primary && !!w) || w === p.secondary); }

  // ---- players ----
  makePlayer(id, name, bot) {
    return {
      id, name, bot, color: COLORS[this.colorSeq++ % COLORS.length],
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, flags: 0,
      hp: MAX_HP, armor: 0, alive: false, respawnAt: 0, spawnT: 0, protect: 0,
      weapon: 'pistol', primary: null, secondary: 'pistol', nades: 1, team: -1,
      kills: 0, deaths: 0, hs: 0, shots: 0, hits: 0, dmgDone: 0, streak: 0, best: 0,
      lastShot: -1, lastSwing: -9, swingHeavy: false, swingUsed: true, lastNade: -9,
      cash: 0, earned: 0, att: {}, lastKillT: -9, multi: 0, lastKiller: null, vendT: -9,
      // bot brain
      path: null, pi: 0, target: null, scanT: 0, reactUntil: 0, nextShot: 0, reloadUntil: 0, switchUntil: 0, ammo: {},
      burst: 0, strafe: 1, strafeT: 0, crouchT: 0, lastSeen: null, stuckT: 0, goal: null, lootT: 0, aimT: 0,
      meleeAt: 0, nextMelee: 0, nadeT: 0, stepT: 0,
    };
  }

  resetStats(p) { p.kills = p.deaths = p.hs = p.shots = p.hits = p.dmgDone = p.streak = p.best = p.cash = p.earned = p.multi = 0; p.lastKiller = null; }

  syncBots() {
    const humans = [...this.players.values()].filter((p) => !p.bot).length;
    const want = Math.max(0, this.botTarget - humans);
    const bots = [...this.players.values()].filter((p) => p.bot);
    if (bots.length > want) {
      for (let n = bots.length - want; n > 0; n--) {
        // in team mode remove from the bigger team so the sides stay even
        const count = this.teamCounts();
        const big = count[0] >= count[1] ? 0 : 1;
        const b = [...this.players.values()].reverse().find((p) => p.bot && (this.mode !== 'tdm' || p.team === big));
        if (b) this.players.delete(b.id);
      }
    } else {
      for (let i = bots.length; i < want; i++) {
        const id = 'b' + ++this.botSeq;
        const b = this.makePlayer(id, BOT_NAMES[(this.botSeq - 1) % BOT_NAMES.length], true);
        this.assignTeam(b);
        this.players.set(id, b);
        this.spawn(b);
      }
    }
    if (this.clients.size) this.broadcastRoster();
  }

  teamCounts() {
    const c = [0, 0];
    for (const p of this.players.values()) if (p.team >= 0) c[p.team]++;
    return c;
  }
  assignTeam(p) {
    if (this.mode !== 'tdm') return;
    const c = this.teamCounts();
    p.team = c[0] < c[1] ? 0 : c[1] < c[0] ? 1 : (Math.random() < 0.5 ? 0 : 1);
    p.color = TEAM_COLORS[p.team];
  }
  foes(a, b) { return a !== b && (this.mode !== 'tdm' || a.team !== b.team); }

  broadcastRoster() {
    this.broadcast({ t: 'roster', list: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, bot: p.bot, color: p.color, team: p.team })) });
  }

  // far from everyone, and preferably out of anyone's line of sight
  spawn(p) {
    const map = this.map;
    let best = null, bestS = -1e9;
    for (let i = 0; i < 26; i++) {
      const cell = (Math.random() * map.W * map.H) | 0;
      const [x, z] = cellCenter(map, cell);
      let dmin = 60, seen = false, dTeam = 30;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        const d = Math.hypot(o.x - x, o.z - z);
        if (!this.foes(p, o)) { dTeam = Math.min(dTeam, d); continue; }
        dmin = Math.min(dmin, d);
        if (d < 34 && lineOfSight(map, o.x, o.z, x, z)) seen = true;
      }
      for (const g of this.nades) if (Math.hypot(g.x - x, g.z - z) < 10) dmin -= 10;
      const s = dmin - (seen ? 25 : 0) - (this.mode === 'tdm' ? dTeam * 0.35 : 0) + Math.random() * 2;
      if (s > bestS) { bestS = s; best = [x, z]; }
    }
    p.x = best[0] + (Math.random() - 0.5); p.z = best[1] + (Math.random() - 0.5); p.y = 0;
    collide(map, p, PLAYER_R);
    p.yaw = Math.random() * Math.PI * 2; p.pitch = 0;
    p.hp = MAX_HP; p.armor = 0; p.alive = true; p.spawnT = this.time; p.protect = this.time + PROTECT_T;
    p.path = null; p.target = null; p.lastSeen = null; p.goal = null; p.streak = 0;
    p.secondary = 'pistol'; p.primary = null; p.nades = 1; p.swingUsed = true; p.att = {};
    if (p.bot) {
      if (Math.random() < 0.55) p.primary = pickWeighted(BOT_PRIMARY);
      p.ammo = { pistol: WEAPONS.pistol.mag };
      if (p.primary) p.ammo[p.primary] = WEAPONS[p.primary].mag;
      p.weapon = p.primary || 'pistol';
      p.reloadUntil = 0; p.switchUntil = 0; p.meleeAt = 0;
    } else {
      p.weapon = 'pistol';
    }
  }

  spawnMsg(p) { return { t: 'spawn', x: r2(p.x), z: r2(p.z), yaw: r2(p.yaw), cash: p.cash, inv: { p: p.primary, s: p.secondary, n: p.nades } }; }

  // zone: 'h' head, 'b' torso (plate applies), 'l' legs, 'k' knife, 'back' backstab, 'x' explosion
  // src: explosion center [x, y, z] (throws the body away from it)
  damage(t, amount, a, weapon, zone, src) {
    if (!t.alive || this.intermission) return false;
    if (a !== t && !this.foes(a, t)) return false; // no friendly fire
    if (this.time < t.protect) return false;
    let d = amount, plate = false;
    if (t.armor > 0 && (zone === 'b' || zone === 'x')) {
      const soak = Math.min(t.armor, d * (zone === 'b' ? 0.5 : 0.35));
      t.armor -= soak; d -= soak; plate = zone === 'b';
    }
    t.hp = Math.max(0, t.hp - d);
    if (a !== t) a.dmgDone += d;
    const kill = t.hp <= 0;
    if (!t.bot) this.send(t.id, { t: 'hurt', from: [r2(a.x), r2(a.z)], by: a.id, dmg: Math.round(amount), zone, w: weapon, hp: Math.ceil(t.hp), armor: Math.ceil(t.armor) });
    else if (a !== t && !kill) this.botAlert(t, a);
    if (!a.bot && a !== t) this.send(a.id, { t: 'hit', kill, zone, plate, id: t.id, dmg: Math.round(d) });
    if (kill) this.kill(t, a, weapon, zone, src);
    return true;
  }

  kill(t, a, weapon, zone, src) {
    const victimStreak = t.streak;
    t.alive = false; t.hp = 0; t.deaths++; t.streak = 0;
    t.respawnAt = this.time + RESPAWN_T;
    const im = this.knockback(t, a, weapon, zone, src);
    this.dropLoot(t, im);
    let streak = 0;
    if (a !== t) {
      a.kills++; a.streak++; a.best = Math.max(a.best, a.streak); streak = a.streak;
      if (zone === 'h') a.hs++;
      if (this.mode === 'tdm') this.teamScore[a.team]++;
      t.lastKiller = a.id;
      this.award(a, t, weapon, zone, victimStreak);
    } else a.kills = Math.max(0, a.kills - 1); // suicide penalty
    this.broadcast({ t: 'kill', k: a.id, v: t.id, w: weapon, z: zone, s: streak, kp: [r2(a.x), r2(a.z)], im, ts: this.mode === 'tdm' ? this.teamScore : undefined });
    if (a !== t && (this.mode === 'tdm' ? this.teamScore[a.team] >= this.fragLimit : a.kills >= this.fragLimit)) this.endMatch(a);
  }

  // launch velocity of the body [vx, vy, vz] (m/s): explosions throw it, big rounds shove it
  knockback(t, a, weapon, zone, src) {
    let dx, dz, sp, up;
    if (src) {
      dx = t.x - src[0]; dz = t.z - src[2];
      const d = Math.hypot(dx, dz, (t.y + 1) - src[1]);
      sp = clamp(6 - d * 0.8, 1.8, 4.8); up = clamp(6.8 - d * 0.7, 2.2, 5.8);
    } else {
      dx = t.x - a.x; dz = t.z - a.z;
      const d = Math.hypot(dx, dz), K = KNOCK[weapon] || KNOCK.pistol;
      const fall = weapon === 'shotgun' ? clamp(1.2 - d / 14, 0.25, 1) : 1;
      sp = K[0] * fall * (zone === 'h' ? 1.15 : 1); up = K[1] * fall;
    }
    const L = Math.hypot(dx, dz) || 1;
    if (L < 1e-3) { dx = Math.sin(t.yaw); dz = Math.cos(t.yaw); }
    return [r2((dx / L) * sp), r2(up), r2((dz / L) * sp)];
  }

  // money for a kill: base pay plus style bonuses, itemized for the killer's HUD
  award(a, t, weapon, zone, victimStreak) {
    const lines = [['LEŞ', ECON.kill]];
    const add = (b) => lines.push(b);
    if (zone === 'h') add(BONUS.head);
    if (zone === 'back') add(BONUS.back); else if (weapon === 'knife') add(BONUS.knife);
    if (weapon === 'nade') add(BONUS.nade);
    if (weapon !== 'nade' && Math.hypot(t.x - a.x, t.z - a.z) >= 25) add(BONUS.long);
    if (a.y > 0.3 || t.y > 0.3) add(BONUS.air);
    if (weapon === 'sniper' && !a.bot && !(a.flags & F.ADS)) add(BONUS.noscope);
    if (this.time - a.lastKillT < 4) { a.multi++; add([`${BONUS.multi[0]} ×${a.multi + 1}`, BONUS.multi[1] * a.multi]); } else a.multi = 0;
    a.lastKillT = this.time;
    if (a.lastKiller === t.id) { add(BONUS.revenge); a.lastKiller = null; }
    if (!this.firstBlood) { this.firstBlood = true; add(BONUS.first); }
    if (victimStreak >= 3) add(BONUS.ender);
    if (a.alive && a.hp < 20) add(BONUS.clutch);
    const total = lines.reduce((s, l) => s + l[1], 0);
    a.cash += total; a.earned += total;
    if (!a.bot) this.send(a.id, { t: 'cash', cash: a.cash, add: total, lines });
  }

  endMatch(winner) {
    if (this.intermission) return;
    if (!winner) winner = [...this.players.values()].sort((x, y) => y.kills - x.kills || x.deaths - y.deaths)[0] || null;
    this.intermission = this.time + INTERMISSION_T;
    this.nades.length = 0;
    const ts = this.teamScore, wt = this.mode === 'tdm' ? (ts[0] === ts[1] ? -1 : ts[0] > ts[1] ? 0 : 1) : null;
    this.broadcast({ t: 'match', mode: this.mode, winnerTeam: wt, teamScore: ts, winner: winner ? winner.id : null, name: winner ? winner.name : '', table: this.table(), next: INTERMISSION_T });
  }

  table() {
    return [...this.players.values()]
      .sort((x, y) => y.kills - x.kills || x.deaths - y.deaths)
      .map((p) => ({ id: p.id, name: p.name, bot: p.bot, team: p.team, k: p.kills, d: p.deaths, hs: p.hs, acc: p.shots ? Math.round((p.hits / p.shots) * 100) : 0, best: p.best, dmg: Math.round(p.dmgDone), cash: p.earned }));
  }

  newMatch() {
    this.newLevel((Math.random() * 1e9) | 0);
    this.teamScore = [0, 0];
    this.broadcast({ t: 'reset', seed: this.seed, size: this.size, light: this.light, fragLimit: this.fragLimit, timeLimit: this.timeLimit });
    for (const p of this.players.values()) p.alive = false;
    for (const p of this.players.values()) { this.resetStats(p); this.spawn(p); if (!p.bot) this.send(p.id, this.spawnMsg(p)); }
  }

  // ---- items lying on the carpet (weapons, ammo, health, armor, grenades, money) ----
  // from: [x, y, z] the item was thrown from (clients animate the arc); it can be taken once it has landed
  addItem(it, x, z, from) {
    const d = {
      id: ++this.dropSeq, k: it.k, w: it.k === 'weapon' ? it.w : null, v: it.v | 0, a: it.a | 0, x, z,
      yaw: Math.random() * Math.PI * 2, expire: this.time + ITEMS[it.k].expire, ready: this.time + (from ? 0.4 : 0),
    };
    collide(this.map, d, 0.2);
    d.x = r2(d.x); d.z = r2(d.z); d.yaw = r2(d.yaw);
    this.drops.set(d.id, d);
    if (this.drops.size > 48) this.removeDrop(this.drops.keys().next().value);
    const m = dropMsg(d);
    if (from) m.f = from.map(r2);
    this.broadcast({ t: 'drop', d: m });
    return d;
  }
  addDrop(w, x, z, from, a = 0) { return this.addItem({ k: 'weapon', w, a }, x, z, from); }
  removeDrop(id) { if (this.drops.delete(id)) this.broadcast({ t: 'undrop', id }); }
  // fan items out of a source (crate, body, machine), toward (tx, tz) when given
  popItems(items, ox, oy, oz, tx, tz, spread = 1.3, r0 = 0.75) {
    const base = tx == null ? Math.random() * Math.PI * 2 : Math.atan2(tx - ox, tz - oz);
    const n = items.length;
    return items.map((it, i) => {
      const a = base + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0) + (Math.random() - 0.5) * 0.35;
      const ux = Math.sin(a), uz = Math.cos(a);
      let r = r0 + Math.random() * 0.45;
      const wall = raycast(this.map, ox, oz, ux, uz, r + 0.3);
      if (wall < r + 0.3) r = Math.max(0.3, wall - 0.3);
      return this.addItem(it, ox + ux * r, oz + uz * r, [ox, oy, oz]);
    });
  }
  // a body spills its weapon, part of its money and whatever else it carried
  dropLoot(p, im) {
    const items = [];
    const w = p.primary || (p.secondary !== 'pistol' ? p.secondary : null);
    if (w) items.push({ k: 'weapon', w, a: p.att[w] | 0 });
    const lose = Math.floor(p.cash * ECON.deathLoss);
    if (lose >= 5) { p.cash -= lose; items.push({ k: 'cash', v: lose }); if (!p.bot) this.send(p.id, { t: 'cash', cash: p.cash, add: -lose }); }
    if (p.nades > 0 && Math.random() < 0.5) items.push({ k: 'nade' });
    if (Math.random() < 0.45) items.push({ k: 'ammo' });
    p.primary = null;
    if (!items.length) return;
    const tx = im ? p.x + im[0] : null, tz = im ? p.z + im[2] : null;
    this.popItems(items, p.x, 0.9, p.z, tx, tz, 2.2, 0.35);
  }
  setSlot(p, w, a = 0) {
    if (WEAPONS[w].slot === 'primary') p.primary = w; else p.secondary = w;
    p.weapon = w;
    p.att[w] = a;
    if (p.bot) { p.ammo[w] = magSize(w, a); p.reloadUntil = 0; p.switchUntil = this.time + 0.5; }
  }
  slotOf(p, w) { return WEAPONS[w].slot === 'primary' ? p.primary : p.secondary; }
  // would picking this up do anything? (ammo need is only known to the human client)
  wants(p, d) {
    switch (d.k) {
      case 'nade': return p.nades < MAX_NADES;
      case 'med': case 'water': return p.hp < MAX_HP;
      case 'armor': return p.armor < MAX_ARMOR;
      case 'ammo': return !p.bot || !!p.reloadUntil;
      default: return true;
    }
  }

  onPickup(p, id) {
    const d = this.drops.get(id);
    if (!d || !p.alive || this.time < d.ready) return false;
    if (Math.hypot(d.x - p.x, d.z - p.z) > 2.5) return false;
    if (d.k === 'weapon') {
      const w = WEAPONS[d.w], old = this.slotOf(p, d.w);
      this.removeDrop(id);
      if (old === d.w) {
        p.att[d.w] = (p.att[d.w] | 0) | d.a;
        if (p.bot) p.ammo[d.w] = magSize(d.w, p.att[d.w]);
        else this.send(p.id, { t: 'got', w: d.w, slot: w.slot, ammo: 1, a: p.att[d.w] });
        return true;
      }
      if (old) this.addDrop(old, d.x + (Math.random() - 0.5) * 0.4, d.z + (Math.random() - 0.5) * 0.4, [p.x, 1.1, p.z], p.att[old] | 0);
      this.setSlot(p, d.w, d.a);
      if (!p.bot) this.send(p.id, { t: 'got', w: d.w, slot: w.slot, a: d.a });
      return true;
    }
    if (!this.wants(p, d)) return false;
    const loot = { k: d.k, v: d.v };
    if (d.k === 'nade') loot.n = ++p.nades;
    else if (d.k === 'med' || d.k === 'water') p.hp = Math.min(MAX_HP, p.hp + d.v);
    else if (d.k === 'armor') p.armor = Math.min(MAX_ARMOR, p.armor + d.v);
    else if (d.k === 'cash') { p.cash += d.v; p.earned += d.v; }
    else if (d.k === 'ammo' && p.bot) for (const w of Object.keys(p.ammo)) p.ammo[w] = magSize(w, p.att[w]) || 0;
    this.removeDrop(id);
    if (!p.bot) this.send(p.id, { t: 'loot', loot, hp: Math.ceil(p.hp), armor: Math.ceil(p.armor), cash: p.cash });
    return true;
  }

  onOpen(p, id) {
    const c = this.crates[id], mc = this.map.crates[id];
    if (!c || c.open || !p.alive) return;
    if (Math.hypot(mc.x - p.x, mc.z - p.z) > 2.6) return;
    c.open = true; c.respawnAt = this.time + 40;
    this.broadcast({ t: 'crate', id, open: 1, by: p.id });
    this.popItems(crateLoot(), mc.x, CRATE_H + 0.12, mc.z, p.x, p.z);
    if (p.bot) p.lootT = 0.6; // look around for what fell out
  }

  // ---- vending machines ----
  nearVendor(p, v) { return Math.hypot(v.x + v.nx * 0.6 - p.x, v.z + v.nz * 0.6 - p.z) < VENDOR_R + 0.5; }
  onBuy(p, msg) {
    const item = SHOP.find((s) => s.id === msg.id), v = this.map.vendors[msg.v | 0];
    if (!item || !v || !p.alive || this.intermission || !this.nearVendor(p, v)) return false;
    const no = (why) => { if (!p.bot) this.send(p.id, { t: 'nobuy', id: item.id, why }); return false; };
    if (this.time - p.vendT < 0.25) return false;
    if (p.cash < item.price) return no('cash');
    if (item.k === 'att') {
      const w = msg.w;
      if (!this.owns(p, w) || w === 'knife') return no('fit');
      if (!fitsAtt(w, item.a)) return no('fit');
      if ((p.att[w] | 0) & item.a) return no('has');
      p.att[w] = (p.att[w] | 0) | item.a;
      if (p.bot) p.ammo[w] = Math.min(p.ammo[w] ?? 0, magSize(w, p.att[w]));
    }
    p.cash -= item.price; p.vendT = this.time;
    this.broadcast({ t: 'vend', v: v.id, by: p.id });
    if (item.k === 'att') { if (!p.bot) this.send(p.id, { t: 'att', w: msg.w, a: p.att[msg.w], cash: p.cash }); return true; }
    if (!p.bot) this.send(p.id, { t: 'cash', cash: p.cash, add: -item.price });
    // it drops into the tray and tumbles out toward the buyer
    this.popItems([{ k: item.k, w: item.w, v: ITEMS[item.k].v }], v.x + v.nx * 0.45, 0.3, v.z + v.nz * 0.45, p.x, p.z, 0, 0.45);
    return true;
  }

  // ---- shooting ----
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
    if (!p.alive || !w || w.melee || !this.owns(p, msg.w) || !fin(msg.o, 3) || !fin(msg.d, 3)) return;
    const minGap = (60 / w.rpm) * 0.7;
    if (this.time - p.lastShot < minGap) return;
    p.lastShot = this.time;
    p.weapon = msg.w;
    p.protect = 0;
    p.shots++;
    const o = msg.o.slice(0, 3).map(Number), d = msg.d.slice(0, 3).map(Number);
    const att = p.att[msg.w] | 0;
    this.broadcast({ t: 'shot', id: p.id, w: msg.w, o: o.map(r2), d: d.map(r3), ts: r3(this.time), s: att & ATT.SUP ? 1 : undefined }, p.id);
    this.noise(p, shotNoise(att));
    if (!Array.isArray(msg.hits)) return;
    let any = false;
    for (const h of msg.hits.slice(0, 8)) {
      if (!h || typeof h !== 'object') continue;
      const t = this.players.get(h.id);
      if (!t || t === p || !t.alive) continue;
      const dist = Math.hypot(t.x - p.x, t.z - p.z);
      if (dist > w.range + 2) continue;
      if (!this.hitValid(p, t, o, d)) continue;
      const zone = h.zone === 'h' || h.zone === 'l' ? h.zone : 'b';
      const cap = w.dmg * zoneMul(w, zone) * w.pellets * 1.01;
      const dmg = clamp(+h.dmg || 0, 0, cap);
      if (dmg > 0 && this.damage(t, dmg, p, msg.w, zone)) any = true;
    }
    if (any) p.hits++;
  }

  // ---- knife ----
  onSwing(p, heavy) {
    const k = WEAPONS.knife;
    if (!p.alive) return false;
    if (this.time - p.lastSwing < (p.swingHeavy ? k.heavyT : k.light) * 0.7) return false;
    p.lastSwing = this.time; p.swingHeavy = heavy; p.swingUsed = false; p.weapon = 'knife'; p.protect = 0;
    this.broadcast({ t: 'swing', id: p.id, h: heavy ? 1 : 0, ts: r3(this.time) }, p.id);
    this.noise(p, 5);
    return true;
  }

  onStab(p, msg) {
    const k = WEAPONS.knife;
    if (!p.alive || p.swingUsed || this.time - p.lastSwing > 0.9) return;
    const t = this.players.get(msg.id);
    if (!t || t === p || !t.alive) return;
    const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
    if (d > k.range + 0.8) return;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    if (d > 0.5 && (dx * fx + dz * fz) / d < 0.3) return;
    if (!lineOfSight(this.map, p.x, p.z, t.x, t.z)) return;
    p.swingUsed = true;
    // backstab: the attacker stands behind the victim's facing direction
    const tfx = -Math.sin(t.yaw), tfz = -Math.cos(t.yaw);
    const back = d > 1e-3 && (-dx * tfx - dz * tfz) / d < -0.35;
    this.damage(t, meleeDamage(p.swingHeavy, back), p, 'knife', back ? 'back' : 'k');
  }

  // ---- grenades (simulated here; clients mirror the same deterministic physics) ----
  onNade(p, msg) {
    if (!p.alive || p.nades <= 0 || this.intermission || !fin(msg.o, 3) || !fin(msg.v, 3)) return;
    if (this.time - p.lastNade < 0.8) return;
    const o = msg.o.slice(0, 3).map((v) => r3(+v));
    let v = msg.v.slice(0, 3).map(Number);
    if (Math.hypot(o[0] - p.x, o[1] - (p.y + EYE_STAND), o[2] - p.z) > 1.4) return;
    if (!lineOfSight(this.map, p.x, p.z, o[0], o[2])) return;
    const sp = Math.hypot(v[0], v[1], v[2]);
    if (sp > 22) v = v.map((x) => (x * 22) / sp);
    v = v.map(r3);
    const cook = clamp(+msg.cook || 0, 0, GRENADE.fuse);
    p.nades--; p.lastNade = this.time; p.protect = 0;
    const g = makeNade(o, v);
    g.id = ++this.nadeSeq; g.by = p.id; g.fuse = r3(GRENADE.fuse - cook); g.acc = 0;
    this.nades.push(g);
    this.broadcast({ t: 'nade', id: g.id, by: p.id, cid: msg.cid | 0, o, v, fuse: g.fuse, ts: r3(this.time) });
    this.noise(p, 8);
    if (g.fuse <= 0.02) this.explode(g);
  }

  stepNades(dt) {
    for (const g of [...this.nades]) {
      g.acc += dt;
      while (g.acc >= NADE_STEP && g.fuse > 0) {
        g.acc -= NADE_STEP;
        stepNade(this.map, g);
        g.fuse -= NADE_STEP;
        if (g.bounce > 2) this.noises.push({ x: g.x, z: g.z, r: 8, src: null, t: this.time });
      }
      if (g.fuse <= 0) this.explode(g);
    }
  }

  explode(g) {
    const i = this.nades.indexOf(g);
    if (i >= 0) this.nades.splice(i, 1);
    this.broadcast({ t: 'boom', id: g.id, p: [r2(g.x), r2(g.y), r2(g.z)] });
    this.noises.push({ x: g.x, z: g.z, r: 45, src: null, t: this.time });
    const a = this.players.get(g.by);
    for (const t of [...this.players.values()]) {
      if (!t.alive) continue;
      const cy = t.y + (t.crouch ? 0.7 : 1.0);
      const d = Math.hypot(t.x - g.x, cy - g.y, t.z - g.z);
      if (d >= GRENADE.radius) continue;
      if (!lineOfSight(this.map, g.x, g.z, t.x, t.z)) continue;
      const dmg = blastDamage(d);
      if (dmg > 1) this.damage(t, dmg, a || t, 'nade', 'x', [g.x, g.y, g.z]);
    }
  }

  noise(p, radius) { this.noises.push({ x: p.x, z: p.z, r: radius, src: p, t: this.time }); }

  // ---- simulation ----
  tick(dt) {
    this.time += dt;
    const t = this.time;
    if (this.intermission && t >= this.intermission) this.newMatch();
    else if (!this.intermission && t - this.matchStart >= this.timeLimit) this.endMatch(null);
    this.stepNades(dt);
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (t >= p.respawnAt && !this.intermission) {
          this.spawn(p);
          if (!p.bot) this.send(p.id, this.spawnMsg(p));
        }
        continue;
      }
      if (p.bot) { this.botThink(p, dt); this.botGrab(p); }
    }
    if (this.noises.length) this.noises = this.noises.filter((n) => t - n.t < 0.4);
    for (const c of this.crates) if (c.open && t >= c.respawnAt) { c.open = false; this.broadcast({ t: 'crate', id: c.id, open: 0 }); }
    for (const d of this.drops.values()) if (t >= d.expire) this.removeDrop(d.id);
    const ps = [];
    for (const p of this.players.values()) {
      const f = (p.alive ? F.ALIVE : 0) | (p.flags & ~(F.ALIVE | F.PROTECT)) | (p.alive && t < p.protect ? F.PROTECT : 0);
      ps.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), f, WEAPON_ORDER.indexOf(p.weapon), Math.ceil(p.hp), Math.ceil(p.armor), p.kills, p.deaths, p.hs, p.att[p.weapon] | 0]);
    }
    const tl = this.intermission ? 0 : Math.max(0, Math.ceil(this.timeLimit - (t - this.matchStart)));
    this.broadcast({ t: 'snap', st: r3(t), tl, ps, ts: this.mode === 'tdm' ? this.teamScore : undefined });
  }

  // ---------------------------------------------------------------- bots
  botAlert(b, a) {
    if (!this.foes(b, a)) return;
    if (!b.target || Math.random() < 0.5) {
      if (lineOfSight(this.map, b.x, b.z, a.x, a.z)) { if (b.target !== a) { b.target = a; b.reactUntil = this.time + 0.2; b.aimT = 0; } }
      else { b.lastSeen = { x: a.x, z: a.z, t: this.time }; b.path = null; b.goal = null; }
    }
  }

  findTarget(b) {
    let best = null, bd = 36;
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    for (const o of this.players.values()) {
      if (!o.alive || !this.foes(b, o)) continue;
      const dx = o.x - b.x, dz = o.z - b.z, d = Math.hypot(dx, dz);
      if (d >= bd) continue;
      const facing = (dx * fx + dz * fz) / (d || 1);
      // unlit targets in dark areas are only spotted up close; a flashlight gives you away
      const vis = o.flags & F.FLASH ? 1 : Math.min(1, Math.max(0.25, this.lightAt(o.x, o.z)));
      if (d > 36 * vis) continue;
      if (facing < -0.3 && d > 4) continue;
      if (d > 27 * vis && facing < 0.5) continue;
      if (!lineOfSight(this.map, b.x, b.z, o.x, o.z)) continue;
      best = o; bd = d;
    }
    return best;
  }

  lightAt(x, z) { return this.map.cellLight[cellIndex(this.map, x, z)]; }

  botWant(b, tg, dist) {
    if (tg && (dist < 1.7 || (b.weapon === 'knife' && dist < 2.6) || (dist < 3 && b.reloadUntil))) return 'knife';
    const main = b.primary || b.secondary;
    if (b.primary && b.primary === 'sniper' && tg && dist < 5) return b.secondary;
    return main;
  }

  botThink(b, dt) {
    const map = this.map, t = this.time, D = DIFF[this.difficulty] || DIFF[1];
    b.scanT -= dt;
    if (b.scanT <= 0) {
      b.scanT = 0.15 + Math.random() * 0.1;
      const nt = this.findTarget(b);
      if (nt && nt !== b.target) { b.reactUntil = t + D.react * (0.7 + Math.random() * 0.6); b.aimT = 0; }
      if (nt) { b.target = nt; b.goal = null; }
      else if (b.target && (!b.target.alive || !lineOfSight(map, b.x, b.z, b.target.x, b.target.z))) {
        if (b.target.alive) b.lastSeen = { x: b.target.x, z: b.target.z, t };
        b.target = null; b.path = null;
      }
      if (!b.target) {
        for (const n of this.noises) {
          if (n.src === b || (n.src && !this.foes(b, n.src)) || Math.hypot(n.x - b.x, n.z - b.z) > n.r) continue;
          if (!b.lastSeen || t - b.lastSeen.t > 2) { b.lastSeen = { x: n.x, z: n.z, t }; b.path = null; b.goal = null; }
        }
      }
    }
    const tg = b.target && b.target.alive ? b.target : null;
    const tdx = tg ? tg.x - b.x : 0, tdz = tg ? tg.z - b.z : 0, dist = Math.hypot(tdx, tdz);

    // weapon handling
    const want = this.botWant(b, tg, dist);
    if (want !== b.weapon) { b.weapon = want; b.switchUntil = t + (want === 'knife' ? 0.25 : 0.5); b.reloadUntil = 0; b.burst = 0; }
    const w = WEAPONS[b.weapon];
    if (!w.melee) {
      const mag = magSize(b.weapon, b.att[b.weapon]);
      if (b.ammo[b.weapon] == null) b.ammo[b.weapon] = mag;
      if (b.reloadUntil && t >= b.reloadUntil) { b.reloadUntil = 0; b.ammo[b.weapon] = mag; }
      const reloadT = w.shell ? w.shell.start + w.shell.per * (mag - b.ammo[b.weapon]) + w.shell.end : w.reload;
      if (!b.reloadUntil && (b.ammo[b.weapon] <= 0 || (!tg && b.ammo[b.weapon] < mag * 0.4))) b.reloadUntil = t + reloadT;
    }

    let mx = 0, mz = 0, speed = 3.3, sprint = false, crouch = false;
    // run from live grenades
    let fleeX = 0, fleeZ = 0;
    for (const g of this.nades) {
      const gd = Math.hypot(g.x - b.x, g.z - b.z);
      if (gd < 7 && g.fuse < 2.8 && lineOfSight(map, b.x, b.z, g.x, g.z)) { fleeX += (b.x - g.x) / (gd + 0.1); fleeZ += (b.z - g.z) / (gd + 0.1); }
    }
    if (fleeX || fleeZ) {
      mx = fleeX; mz = fleeZ; speed = 5; sprint = true;
      if (tg) this.botAim(b, tg, dist, D, dt);
    } else if (tg) {
      b.aimT += dt;
      const aimed = this.botAim(b, tg, dist, D, dt);
      b.strafeT -= dt;
      if (b.strafeT <= 0) {
        b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeT = 0.5 + Math.random() * 1.2;
        if (Math.random() < 0.25) b.strafe = 0;
        b.crouchT = Math.random() < D.crouch ? 0.6 + Math.random() : 0;
      }
      b.crouchT -= dt;
      const rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw), fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
      mx = rx * b.strafe; mz = rz * b.strafe;
      const ideal = w.melee ? 0.9 : b.weapon === 'shotgun' ? 5 : b.weapon === 'smg' ? 9 : b.weapon === 'sniper' ? 22 : b.weapon === 'pistol' || b.weapon === 'revolver' ? 12 : 16;
      const hurt = b.hp < 35 && !w.melee && dist > 5;
      if (hurt) { mx -= fx; mz -= fz; }
      else if (dist > ideal + 3) { mx += fx; mz += fz; } else if (dist < ideal * 0.5) { mx -= fx * 0.7; mz -= fz * 0.7; }
      speed = w.melee ? 5 : 2.6;
      sprint = w.melee && dist > 2;
      crouch = b.crouchT > 0 && !w.melee && b.strafe === 0;
      b.lastSeen = { x: tg.x, z: tg.z, t };
      if (w.melee) this.botMelee(b, tg, dist, D, t);
      else if (aimed && t >= b.reactUntil && !b.reloadUntil && t >= b.switchUntil && b.ammo[b.weapon] > 0 && !this.intermission && t - b.spawnT > 0.8) {
        if (b.nextShot < t - 0.1) b.nextShot = t;
        let n = 0;
        while (b.nextShot <= t && b.ammo[b.weapon] > 0 && n++ < 3) {
          if (!lineOfSight(map, b.x, b.z, tg.x, tg.z)) break;
          this.botFire(b, tg, dist, D, w, b.nextShot);
        }
      }
    } else {
      b.target = null; b.aimT = 0;
      this.botRoam(b, dt, t);
      if (b.move) { mx = b.move[0]; mz = b.move[1]; speed = b.move[2]; sprint = speed > 4; }
      // lob a grenade where the enemy was last seen
      b.nadeT -= dt;
      if (b.nadeT <= 0) {
        b.nadeT = 1;
        const ls = b.lastSeen;
        if (ls && b.nades > 0 && t - ls.t > 0.8 && t - ls.t < 5 && Math.random() < D.nade * 0.5) {
          const d = Math.hypot(ls.x - b.x, ls.z - b.z);
          if (d > 6 && d < 19 && lineOfSight(map, b.x, b.z, ls.x, ls.z)) this.botNade(b, ls.x, ls.z, d);
        }
      }
    }
    if (b.meleeAt && t >= b.meleeAt) { b.meleeAt = 0; if (tg) this.onStab(b, { id: tg.id }); }

    const ml = Math.hypot(mx, mz);
    const ox = b.x, oz = b.z;
    const spd = speed * (w.moveMul || 1) * (crouch ? 0.55 : 1);
    if (ml > 0.01) {
      b.x += (mx / ml) * spd * dt;
      b.z += (mz / ml) * spd * dt;
      this.separate(b);
      collide(map, b, PLAYER_R);
    }
    const moved = Math.hypot(b.x - ox, b.z - oz);
    b.crouch = crouch;
    const L = this.lightAt(b.x, b.z);
    if (L < 0.3) b.flash = true; else if (L > 0.55) b.flash = false;
    b.flags = (moved > 0.02 ? F.MOVE : 0) | (b.reloadUntil ? F.RELOAD : 0) | (crouch ? F.CROUCH : 0) | (sprint && moved > 0.02 ? F.SPRINT : 0) | (tg && !w.melee ? F.ADS : 0) | (b.flash ? F.FLASH : 0);
    b.stepT -= dt;
    if (moved > 0.02 && b.stepT <= 0 && !crouch) { b.stepT = 0.45; this.noise(b, sprint ? 10 : 6); }
    if (ml > 0.01 && moved < spd * dt * 0.25) {
      b.stuckT += dt;
      if (b.stuckT > 0.8) { b.stuckT = 0; b.path = null; b.goal = null; b.strafe = -b.strafe; }
    } else b.stuckT = 0;
  }

  // bodies do not overlap: push a bot out of every other living player
  separate(b) {
    const min = PLAYER_R * 2;
    for (const o of this.players.values()) {
      if (o === b || !o.alive) continue;
      const dx = b.x - o.x, dz = b.z - o.z, d = Math.hypot(dx, dz);
      if (d >= min) continue;
      if (d < 1e-4) { b.x += min; continue; }
      const k = (min - d) / d;
      b.x += dx * k; b.z += dz * k;
    }
  }

  // turn toward the target; returns true when the aim is on
  botAim(b, tg, dist, D, dt) {
    const want = Math.atan2(-(tg.x - b.x), -(tg.z - b.z));
    b.yaw += clamp(angDiff(b.yaw, want), -D.turn * dt, D.turn * dt);
    const aimH = tg.crouch ? 1.0 : 1.3;
    b.pitch = Math.atan2(aimH - (b.y + (b.crouch ? EYE_CROUCH : EYE_STAND)), dist);
    return Math.abs(angDiff(b.yaw, want)) < 0.18;
  }

  botMelee(b, tg, dist, D, t) {
    if (dist > 1.9 || t < b.nextMelee || t < b.switchUntil || b.meleeAt || this.intermission) return;
    if (Math.random() > D.melee) { b.nextMelee = t + 0.3; return; }
    const heavy = Math.random() < 0.3;
    if (!this.onSwing(b, heavy)) return;
    const k = WEAPONS.knife;
    b.meleeAt = t + (heavy ? k.heavyHit : k.lightHit);
    b.nextMelee = t + (heavy ? k.heavyT : k.light) + 0.1;
  }

  botNade(b, tx, tz, d) {
    const ux = (tx - b.x) / d, uz = (tz - b.z) / d;
    const vh = clamp(d * 0.86, 4, 14), vy = 3.0;
    b.yaw = Math.atan2(-ux, -uz);
    this.onNade(b, { o: [b.x, b.y + EYE_STAND, b.z], v: [ux * vh, vy, uz * vh], cook: Math.random() < 0.3 ? 0.8 : 0 });
  }

  // path to loot / last-seen enemy / random cell; sets b.move = [dx, dz, speed] or null
  botRoam(b, dt, t) {
    const map = this.map;
    b.move = null;
    b.lootT -= dt;
    if (b.lootT <= 0 && !b.goal) {
      b.lootT = 1 + Math.random();
      const needs = b.hp < 70 || b.armor < 30 || !b.primary || b.nades === 0;
      let best = null, bd = 14;
      if (needs) {
        this.map.crates.forEach((c, i) => {
          if (this.crates[i].open) return;
          const d = Math.hypot(c.x - b.x, c.z - b.z);
          if (d < bd) { bd = d; best = { k: 'crate', id: i, x: c.x, z: c.z }; }
        });
      }
      for (const d of this.drops.values()) {
        if (d.k === 'weapon') {
          const cur = this.slotOf(b, d.w);
          if (cur && WEAPON_RANK[d.w] <= WEAPON_RANK[cur]) continue;
        } else if (d.k === 'ammo' || !this.wants(b, d) || ((d.k === 'med' || d.k === 'water') && b.hp > 70) || (d.k === 'armor' && b.armor > 50)) continue;
        const dd = Math.hypot(d.x - b.x, d.z - b.z) * (d.k === 'cash' ? 1.3 : 1);
        if (dd < bd) { bd = dd; best = { k: 'drop', id: d.id, x: d.x, z: d.z }; }
      }
      // spend money at a machine: a primary weapon first, then armor
      const buy = this.botShopping(b);
      if (buy && (!best || best.k === 'crate' || bd > 4)) {
        const v = this.map.vendors.reduce((m, v) => (Math.hypot(v.x - b.x, v.z - b.z) < Math.hypot(m.x - b.x, m.z - b.z) ? v : m));
        if (Math.hypot(v.x - b.x, v.z - b.z) < 32) best = { k: 'vend', id: v.id, x: v.x + v.nx * 0.9, z: v.z + v.nz * 0.9 };
      }
      if (best && (!b.lastSeen || t - b.lastSeen.t > 3)) { b.goal = best; b.path = null; }
    }
    const here = cellIndex(map, b.x, b.z);
    const g = b.goal;
    if (g) {
      const valid = g.k === 'crate' ? !this.crates[g.id].open : g.k === 'vend' ? !!this.botShopping(b) : this.drops.has(g.id);
      const d = Math.hypot(g.x - b.x, g.z - b.z);
      if (!valid) { b.goal = null; b.path = null; }
      else if (d < (g.k === 'drop' ? 0.9 : 1.25)) {
        if (g.k === 'crate') this.onOpen(b, g.id);
        else if (g.k === 'vend') { this.onBuy(b, { id: this.botShopping(b), v: g.id }); b.lootT = 0.8; }
        else if (!this.onPickup(b, g.id) && this.time < (this.drops.get(g.id)?.ready ?? 0)) return; // still in the air: wait for it
        b.goal = null; b.path = null;
        return;
      } else if (cellIndex(map, g.x, g.z) === here || (b.path && b.pi >= b.path.length)) {
        b.yaw += clamp(angDiff(b.yaw, Math.atan2(-(g.x - b.x), -(g.z - b.z))), -6 * dt, 6 * dt);
        b.move = [(g.x - b.x) / d, (g.z - b.z) / d, 3.3];
        return;
      }
    }
    if (!b.path || b.pi >= b.path.length) {
      let goal, fast = false;
      if (b.goal) goal = cellIndex(map, b.goal.x, b.goal.z);
      else if (b.lastSeen && t - b.lastSeen.t < 8) { goal = cellIndex(map, b.lastSeen.x, b.lastSeen.z); b.lastSeen = null; fast = true; }
      else goal = (Math.random() * map.W * map.H) | 0;
      b.path = findPath(map, here, goal) || [];
      b.pi = 0; b.fast = fast;
      if (!b.path.length && b.goal) { b.goal = null; }
    }
    if (b.path.length && b.pi < b.path.length) {
      const [cx, cz] = cellCenter(map, b.path[b.pi]);
      const dx = cx - b.x, dz = cz - b.z, d = Math.hypot(dx, dz);
      if (d < 0.5) b.pi++;
      else {
        b.yaw += clamp(angDiff(b.yaw, Math.atan2(-dx, -dz)), -6 * dt, 6 * dt);
        b.pitch *= 0.9;
        b.move = [dx / d, dz / d, b.fast ? 5 : 3.3];
      }
    }
  }

  // what a bot would buy right now (shop item id) or null
  botShopping(b) {
    if (!this.map.vendors.length || this.time - b.vendT < 4) return null; // pick up what was just bought first
    if (!b.primary && b.cash >= 250) return b.cash >= 270 && Math.random() < 0.5 ? 'm4' : 'rifle';
    if (b.armor < 40 && b.cash >= 75) return 'armor';
    if (b.hp < 60 && b.cash >= 60) return 'med';
    return null;
  }

  // walk over health, armor, grenades and money to take them
  botGrab(b) {
    for (const d of this.drops.values()) {
      if (d.k === 'weapon' || this.time < d.ready) continue;
      if (Math.abs(d.x - b.x) > 1 || Math.abs(d.z - b.z) > 1 || Math.hypot(d.x - b.x, d.z - b.z) > 0.9) continue;
      if (this.wants(b, d) && this.onPickup(b, d.id)) return;
    }
  }

  botFire(b, tg, dist, D, w, ts) {
    b.ammo[b.weapon]--;
    b.protect = 0;
    b.shots++;
    if (w.modes[0] === 'auto') {
      b.burst++;
      if (b.burst >= 3 + ((Math.random() * 5) | 0)) { b.burst = 0; b.nextShot += 0.3 + Math.random() * 0.4; }
      else b.nextShot += 60 / (w.rpm * D.rate);
    } else if (w.cycle) b.nextShot += w.cycle + (0.25 + Math.random() * 0.6) / D.rate;
    else b.nextShot += 60 / w.rpm + (0.18 + Math.random() * 0.35) / D.rate;
    let p = D.acc * Math.max(0.12, 1 - dist / (w.range * 0.95));
    if (b.weapon === 'sniper') p = dist < 6 ? D.acc * 0.5 : Math.min(0.9, D.acc * 1.9);
    if (tg.flags & F.MOVE) p *= 0.75;
    if (tg.crouch) p *= 0.85;
    if (b.flags & F.MOVE) p *= 0.85;
    p *= clamp(0.55 + b.aimT * 0.9, 0.55, 1.15);
    if (w.pellets > 1) p = Math.min(0.95, p * 1.8);
    // most rounds land center mass; better bots find heads more often
    const headP = D.hs * (b.weapon === 'sniper' ? 1.6 : 1);
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
    const eye = b.y + (b.crouch ? EYE_CROUCH : EYE_STAND);
    const ty = (tg.crouch ? 0.95 : 1.3) + ey - eye;
    const dx = tg.x - b.x + Math.cos(b.yaw) * ex, dz = tg.z - b.z - Math.sin(b.yaw) * ex;
    const L = Math.hypot(dx, ty, dz) || 1;
    const att = b.att[b.weapon] | 0;
    this.broadcast({ t: 'shot', id: b.id, w: b.weapon, o: [r2(b.x), r2(eye), r2(b.z)], d: [dx / L, ty / L, dz / L].map(r3), ts: r3(ts), s: att & ATT.SUP ? 1 : undefined });
    this.noise(b, shotNoise(att));
    if (dmg > 0 && this.damage(tg, dmg, b, b.weapon, zone)) b.hits++;
  }
}

function dropMsg(d) { return { id: d.id, k: d.k, w: d.w || undefined, v: d.v || undefined, a: d.a || undefined, x: d.x, z: d.z, yaw: d.yaw }; }

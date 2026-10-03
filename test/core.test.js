// Headless tests for the shared simulation: run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameCore, EYE_STAND, PLAYER_R, RESPAWN_T, INTERMISSION_T, ESCAPE_JOIN_T, REST_ZONE_HP, REST_ROUND_HP, F } from '../public/js/shared/core.js';
import { WEAPONS, GRENADE, blastDamage, meleeDamage, dmgAt, zoneMul } from '../public/js/shared/weapons.js';
import { SHOP, ATT, BONUS, ECON, magSize, SUP_DMG } from '../public/js/shared/items.js';
import { cellCenter, cellIndex, findPath, lineOfSight, safeAt, CELL } from '../public/js/shared/map.js';
import { makeNade, stepNade, NADE_STEP } from '../public/js/shared/physics.js';

// Core with no bots and two scripted humans standing inside the same (open) cell.
function duel(seed = 1234) {
  const core = new GameCore({ bots: 0, seed, fragLimit: 5 });
  const inbox = { a: [], v: [] };
  for (const id of ['a', 'v']) { core.join(id, (m) => inbox[id].push(m)); core.handle(id, { t: 'join', name: id.toUpperCase() }); }
  const a = core.players.get('a'), v = core.players.get('v');
  const [cx, cz] = cellCenter(core.map, 5 * core.map.W + 5);
  Object.assign(a, { x: cx, z: cz + 0.6, yaw: 0, protect: 0 });   // yaw 0 faces -z
  Object.assign(v, { x: cx, z: cz - 0.6, yaw: 0, protect: 0 });   // victim also faces -z: a is behind v
  return { core, a, v, inbox };
}

function escapeDuel(preferences = {}, timeLimit = 600) {
  const core = new GameCore({ bots: 0, seed: 717, mode: 'escape', timeLimit });
  const inbox = { m: [], a: [], b: [] };
  for (const id of Object.keys(inbox)) {
    core.join(id, (msg) => inbox[id].push(msg));
    core.handle(id, { t: 'join', name: id, role: preferences[id] || (id === 'm' ? 'monster' : 'survivor') });
  }
  for (const p of core.players.values()) p.protect = 0;
  return { core, m: core.players.get('m'), a: core.players.get('a'), b: core.players.get('b'), inbox };
}

// Locate a real sanctuary doorway, keeping collision and raycasting in the tests.
function sanctuaryEntrance(map, zone) {
  const path = findPath(map, map.monsterSpawn.cell, zone.cell);
  const entry = path.findIndex((cell) => map.safeMask[cell] === zone.id);
  assert.ok(entry >= 0, 'sanctuary has a reachable doorway');
  const [ax, az] = cellCenter(map, entry ? path[entry - 1] : map.monsterSpawn.cell);
  const [bx, bz] = cellCenter(map, path[entry]);
  const ux = (bx - ax) / CELL, uz = (bz - az) / CELL;
  const x = (ax + bx) / 2, z = (az + bz) / 2;
  return { outside: [x - ux * 0.6, z - uz * 0.6], inside: [x + ux * 0.6, z + uz * 0.6] };
}

test('first online player chooses an exact bot count for the session', () => {
  const core = new GameCore({ bots: 5, seed: 17 });
  const inbox = { a: [], b: [], c: [] };
  const botCount = () => [...core.players.values()].filter((p) => p.bot).length;
  for (const id of Object.keys(inbox)) core.join(id, (m) => inbox[id].push(m));

  core.handle('a', { t: 'join', name: 'A', bots: 0 });
  assert.equal(core.onlineBotCount, 0);
  assert.equal(botCount(), 0);
  assert.equal(inbox.a.find((m) => m.t === 'welcome').bots, 0);

  core.handle('b', { t: 'join', name: 'B', bots: 10 });
  assert.equal(core.onlineBotCount, 0, 'later players cannot change the count');
  assert.equal(botCount(), 0);
  assert.equal(inbox.b.find((m) => m.t === 'welcome').bots, 0);
  core.newMatch();
  assert.equal(botCount(), 0, 'new rounds keep the chosen count');
  core.leave('a');
  assert.equal(core.onlineBotCount, 0);
  core.leave('b');
  assert.equal(core.onlineBotCount, null, 'the next session can choose again');
  assert.equal(botCount(), 5, 'idle server returns to its configured default');

  core.handle('c', { t: 'join', name: 'C', bots: 10 });
  assert.equal(core.onlineBotCount, 10);
  assert.equal(botCount(), 10);
  core.newMatch();
  assert.equal(botCount(), 10);
});

test('online join rejects bot counts outside 0 to 10', () => {
  const core = new GameCore({ bots: 5, seed: 18 });
  const messages = [];
  core.join('a', (m) => messages.push(m));
  for (const bots of [-1, 11, 1.5, '5', null]) {
    core.handle('a', { t: 'join', name: 'A', bots });
    assert.equal(core.players.has('a'), false);
    assert.equal(messages.at(-1)?.t, 'error');
  }
  core.handle('a', { t: 'join', name: 'A', bots: 5 });
  assert.equal(core.onlineBotCount, 5);
  assert.equal([...core.players.values()].filter((p) => p.bot).length, 5);
});

test('bots play full matches without errors and the match cycles to a new level', () => {
  const core = new GameCore({ bots: 9, difficulty: 2, fragLimit: 12, timeLimit: 200, seed: 42 });
  const seen = {};
  core.join('h', (m) => { seen[m.t] = (seen[m.t] || 0) + 1; });
  core.handle('h', { t: 'join', name: 'Tester' });
  const seed0 = core.seed;
  for (let i = 0; i < 30 * 60 * 9; i++) core.tick(1 / 30);
  assert.ok(seen.kill > 20, `kills happened (${seen.kill})`);
  assert.ok(seen.shot > 200, 'bots shoot');
  assert.ok(seen.match >= 1, 'a match ended');
  assert.ok(seen.reset >= 1 && core.seed !== seed0, 'new level generated');
  assert.ok(seen.drop > 0, 'weapons were dropped');
  for (const p of core.players.values()) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), 'positions stay finite');
    assert.ok(p.x > 0 && p.z > 0 && p.x < core.map.size && p.z < core.map.size, 'players stay inside the level');
  }
});

test('knife: backstab kills, frontal light stab does 45', () => {
  const { core, v } = duel();
  core.handle('a', { t: 'swing', h: 0 });
  core.handle('a', { t: 'stab', id: 'v' });
  assert.equal(v.alive, false, 'backstab (light) is lethal');
  const d2 = duel(99);
  d2.v.yaw = Math.PI; // victim now faces the attacker
  d2.core.handle('a', { t: 'swing', h: 0 });
  d2.core.handle('a', { t: 'stab', id: 'v' });
  assert.equal(d2.v.hp, 100 - meleeDamage(false, false));
  d2.core.handle('a', { t: 'stab', id: 'v' });
  assert.equal(d2.v.hp, 100 - meleeDamage(false, false), 'one hit per swing');
});

test('shots with a weapon the player does not own are rejected', () => {
  const { core, a, v } = duel();
  const o = [a.x, EYE_STAND, a.z], d = [0, 0, -1];
  core.handle('a', { t: 'shoot', w: 'rifle', o, d, hits: [{ id: 'v', dmg: 34, zone: 'b' }] });
  assert.equal(v.hp, 100);
  core.time += 1;
  core.handle('a', { t: 'shoot', w: 'pistol', o, d, hits: [{ id: 'v', dmg: 25, zone: 'b' }] });
  assert.equal(v.hp, 75);
  core.time += 1;
  core.handle('a', { t: 'shoot', w: 'pistol', o, d, hits: [{ id: 'v', dmg: 999, zone: 'b' }] });
  assert.ok(v.hp >= 75 - 25 * 1.01 - 1e-9, 'damage is capped per weapon');
});

test('spawn protection blocks damage until the victim acts', () => {
  const { core, a, v } = duel();
  v.protect = core.time + 2;
  core.handle('a', { t: 'shoot', w: 'pistol', o: [a.x, EYE_STAND, a.z], d: [0, 0, -1], hits: [{ id: 'v', dmg: 25, zone: 'b' }] });
  assert.equal(v.hp, 100);
});

test('grenade explodes after its fuse and hurts players in line of sight', () => {
  const { core, a, v, inbox } = duel();
  a.protect = 0;
  core.handle('a', { t: 'nade', o: [a.x, EYE_STAND, a.z], v: [0, 0.5, -1], cook: 0, cid: 7 });
  assert.equal(a.nades, 0);
  const n = inbox.v.find((m) => m.t === 'nade');
  assert.ok(n && n.cid === 7);
  for (let i = 0; i < Math.ceil(GRENADE.fuse * 30) + 2; i++) core.tick(1 / 30);
  assert.ok(inbox.v.some((m) => m.t === 'boom'), 'boom broadcast');
  assert.ok(v.hp < 100 || !v.alive, 'victim damaged');
  assert.ok(a.hp < 100 || !a.alive, 'thrower caught in own blast');
  assert.equal(blastDamage(GRENADE.radius + 1), 0);
});

test('cooked-out grenade explodes in hand', () => {
  const { core, a, inbox } = duel();
  core.handle('a', { t: 'nade', o: [a.x, EYE_STAND, a.z], v: [0, 0, -1], cook: GRENADE.fuse });
  assert.ok(inbox.a.some((m) => m.t === 'boom'));
  assert.equal(a.alive, false);
});

test('dead players drop their primary; others can pick it up', () => {
  const { core, a, v, inbox } = duel();
  v.primary = 'm4'; v.weapon = 'm4';
  core.handle('a', { t: 'swing', h: 1 });
  core.handle('a', { t: 'stab', id: 'v' });
  assert.equal(v.alive, false);
  const drop = [...core.drops.values()].find((d) => d.w === 'm4');
  assert.ok(drop, 'm4 dropped');
  core.handle('a', { t: 'pickup', id: drop.id });
  assert.equal(a.primary, null, 'cannot be caught mid-air');
  for (let i = 0; i < 20; i++) core.tick(1 / 30);
  Object.assign(a, { x: drop.x, z: drop.z });
  core.handle('a', { t: 'pickup', id: drop.id });
  assert.equal(a.primary, 'm4');
  assert.ok(inbox.a.some((m) => m.t === 'got' && m.w === 'm4' && m.slot === 'primary'));
  // swapping the secondary leaves the old one on the floor
  const rv = core.addDrop('revolver', a.x, a.z);
  core.handle('a', { t: 'pickup', id: rv.id });
  assert.equal(a.secondary, 'revolver');
  assert.ok([...core.drops.values()].some((d) => d.w === 'pistol'));
});

test('grenade physics is deterministic and stays inside the level', () => {
  const core = new GameCore({ bots: 0, seed: 7 });
  const [cx, cz] = cellCenter(core.map, 40);
  const run = () => {
    const g = makeNade([cx, 1.4, cz], [9, 3, 5]);
    for (let i = 0; i < GRENADE.fuse / NADE_STEP; i++) stepNade(core.map, g);
    return g;
  };
  const g1 = run(), g2 = run();
  assert.deepEqual([g1.x, g1.y, g1.z], [g2.x, g2.y, g2.z]);
  assert.ok(g1.y >= 0 && g1.x > 0 && g1.z > 0 && g1.x < core.map.size && g1.z < core.map.size);
});


test('team deathmatch: balanced teams, no friendly fire, team score ends the match', () => {
  const core = new GameCore({ bots: 8, difficulty: 2, fragLimit: 15, timeLimit: 400, seed: 77, mode: 'tdm' });
  const seen = [];
  core.join('h', (m) => seen.push(m));
  core.handle('h', { t: 'join', name: 'Tester' });
  const count = core.teamCounts();
  assert.equal(count[0] + count[1], 8);
  assert.ok(Math.abs(count[0] - count[1]) <= 1, `balanced ${count}`);
  const me = core.players.get('h');
  const mate = [...core.players.values()].find((p) => p !== me && p.team === me.team);
  mate.protect = 0; me.protect = 0;
  assert.equal(core.damage(mate, 50, me, 'pistol', 'b'), false, 'friendly fire blocked');
  assert.equal(mate.hp, 100);
  for (let i = 0; i < 30 * 60 * 6; i++) core.tick(1 / 30);
  const match = seen.find((m) => m.t === 'match');
  assert.ok(match, 'match ended');
  assert.ok(match.mode === 'tdm' && Array.isArray(match.teamScore));
  assert.ok(Math.max(...match.teamScore) >= 15 || core.time >= 400, 'team score limit reached');
  for (const k of seen.filter((m) => m.t === 'kill' && m.k !== m.v)) {
    const a = seen.find((m) => m.t === 'roster')?.list.find((p) => p.id === k.k);
    const v = seen.find((m) => m.t === 'roster')?.list.find((p) => p.id === k.v);
    if (a && v) assert.notEqual(a.team, v.team, 'no team kills');
  }
});

test('blackout levels: most lights off, bots use flashlights', () => {
  const core = new GameCore({ bots: 6, seed: 5, light: 'dark' });
  const off = core.map.fixtures.filter((f) => f.state === 1).length / core.map.fixtures.length;
  assert.ok(off > 0.7, `lights off ${off}`);
  const normal = new GameCore({ bots: 0, seed: 5 });
  assert.ok(normal.map.fixtures.filter((f) => f.state === 1).length / normal.map.fixtures.length < 0.25);
  for (let i = 0; i < 90; i++) core.tick(1 / 30);
  assert.ok([...core.players.values()].some((p) => p.flags & 4), 'some bot has its flashlight on');
});

test('crate loot pops out onto the floor; weapons wait for the player, consumables are walked over', () => {
  const { core, a, inbox } = duel(4321);
  const c = core.map.crates[0];
  Object.assign(a, { x: c.x + 1, z: c.z, hp: 60 });
  const origRandom = Math.random;
  let n = 0;
  Math.random = () => [0.1, 0.5, 0.0, 0.9, 0.99][n++ % 5]; // weapon roll: smg, no attachment, money, no bonus ammo
  try { core.handle('a', { t: 'open', id: 0 }); } finally { Math.random = origRandom; }
  const items = [...core.drops.values()];
  assert.ok(inbox.a.some((m) => m.t === 'crate' && m.open === 1));
  const gun = items.find((d) => d.k === 'weapon');
  assert.ok(gun, 'a weapon fell out');
  assert.equal(a.primary, null, 'weapons are never equipped straight out of the crate');
  const drops = inbox.a.filter((m) => m.t === 'drop');
  assert.ok(drops.length === items.length && drops.every((m) => Array.isArray(m.d.f)), 'clients get the launch point to animate the arc');
  for (const d of items) assert.ok(Math.hypot(d.x - c.x, d.z - c.z) > 0.45, 'lands outside the crate');
  for (let i = 0; i < 20; i++) core.tick(1 / 30);
  Object.assign(a, { x: gun.x, z: gun.z });
  core.handle('a', { t: 'pickup', id: gun.id });
  assert.equal(a.primary, gun.w);
  // health: taken only while hurt
  const med = core.addItem({ k: 'med', v: 50 }, a.x, a.z);
  a.hp = 100;
  core.handle('a', { t: 'pickup', id: med.id });
  assert.ok(core.drops.has(med.id), 'full health leaves the kit on the floor');
  a.hp = 70;
  core.handle('a', { t: 'pickup', id: med.id });
  assert.equal(a.hp, 100);
  const cash = core.addItem({ k: 'cash', v: 30 }, a.x, a.z);
  core.handle('a', { t: 'pickup', id: cash.id });
  assert.equal(a.cash, 30);
  assert.ok(inbox.a.some((m) => m.t === 'loot' && m.loot.k === 'cash' && m.cash === 30));
});

test('kills pay money with style bonuses; dying spills part of it', () => {
  const { core, a, v, inbox } = duel();
  v.cash = 200;
  core.handle('a', { t: 'swing', h: 0 });
  core.handle('a', { t: 'stab', id: 'v' });
  assert.equal(v.alive, false);
  const pay = inbox.a.find((m) => m.t === 'cash');
  const want = ECON.kill + BONUS.back[1] + BONUS.first[1];
  assert.equal(pay.add, want, JSON.stringify(pay.lines));
  assert.equal(a.cash, want);
  assert.equal(v.cash, 150, 'a quarter of the money is dropped');
  assert.ok([...core.drops.values()].some((d) => d.k === 'cash' && d.v === 50));
  const k = inbox.a.find((m) => m.t === 'kill');
  assert.ok(Array.isArray(k.im) && k.im.every(Number.isFinite), 'kill carries the body launch velocity');
});

test('vending machine: buying pops the item out, attachments go on the held weapon', () => {
  const { core, a, inbox } = duel(99);
  const vm = core.map.vendors[0];
  assert.ok(core.map.vendors.length >= 2, 'machines are placed');
  Object.assign(a, { x: vm.x + vm.nx * 1.1, z: vm.z + vm.nz * 1.1, cash: 500, primary: 'm4', weapon: 'm4' });
  core.handle('a', { t: 'buy', id: 'armor', v: vm.id });
  assert.equal(a.cash, 500 - SHOP.find((s) => s.id === 'armor').price);
  const plate = [...core.drops.values()].find((d) => d.k === 'armor');
  assert.ok(plate, 'plate dispensed');
  for (let i = 0; i < 12; i++) core.tick(1 / 30);
  core.handle('a', { t: 'buy', id: 'ext', v: vm.id, w: 'm4' });
  assert.equal(a.att.m4 & ATT.EXT, ATT.EXT);
  assert.ok(inbox.a.some((m) => m.t === 'att' && m.w === 'm4'));
  assert.equal(magSize('m4', a.att.m4), 40);
  for (let i = 0; i < 12; i++) core.tick(1 / 30);
  core.handle('a', { t: 'buy', id: 'sup', v: vm.id, w: 'shotgun' });
  assert.ok(inbox.a.some((m) => m.t === 'nobuy' && m.why === 'fit'), 'cannot fit a weapon you do not own');
  a.cash = 10;
  for (let i = 0; i < 12; i++) core.tick(1 / 30);
  core.handle('a', { t: 'buy', id: 'med', v: vm.id });
  assert.ok(inbox.a.some((m) => m.t === 'nobuy' && m.why === 'cash'));
  // too far away
  Object.assign(a, { x: vm.x + vm.nx * 6, z: vm.z + vm.nz * 6, cash: 500 });
  for (let i = 0; i < 12; i++) core.tick(1 / 30);
  assert.equal(core.onBuy(a, { id: 'med', v: vm.id }), false);
  // suppressed shots are flagged for everyone's audio
  a.att.m4 |= ATT.SUP; a.lastShot = -9;
  core.handle('a', { t: 'shoot', w: 'm4', o: [a.x, EYE_STAND, a.z], d: [0, 0, -1], hits: [] });
  assert.ok(inbox.v.some((m) => m.t === 'shot' && m.s === 1));
});

test('shotgun keeps lethal close blasts and useful, smoothly falling midrange damage', () => {
  const w = WEAPONS.shotgun;
  const blast = (distance) => dmgAt(w, distance) * w.pellets;
  assert.ok(blast(3) >= 100, 'a full close blast can kill');
  assert.ok(blast(22) >= 60, 'a centered midrange blast remains useful');
  assert.ok(blast(22) < blast(3) && blast(w.range) < blast(22), 'damage still falls with distance');
  assert.ok(Math.abs(blast(22.01) - blast(22)) < 0.1, 'falloff is continuous');
});

test('AWP kills any valid body zone through full armor, including suppressed maximum range', () => {
  for (const zone of ['h', 'b', 'l']) {
    const { core, a, v } = duel();
    a.primary = 'sniper'; a.att.sniper = ATT.SUP; v.armor = 100;
    core.handle(a.id, { t: 'shoot', w: 'sniper', o: [a.x, EYE_STAND, a.z], d: [0, 0, -1], hits: [{ id: v.id, dmg: 0.1, zone }] });
    assert.equal(v.alive, false, `authoritative ${zone} hit is lethal despite an understated client amount`);

    const ranged = duel();
    ranged.v.armor = 100;
    const damage = dmgAt(WEAPONS.sniper, WEAPONS.sniper.range) * zoneMul(WEAPONS.sniper, zone) * SUP_DMG;
    assert.equal(ranged.core.damage(ranged.v, damage, ranged.a, 'sniper', zone), true);
    assert.equal(ranged.v.alive, false, `suppressed max-range ${zone} hit is lethal`);
  }
  const protectedDuel = duel();
  protectedDuel.a.primary = 'sniper'; protectedDuel.v.armor = 100; protectedDuel.v.protect = 2;
  protectedDuel.core.handle('a', { t: 'shoot', w: 'sniper', o: [protectedDuel.a.x, EYE_STAND, protectedDuel.a.z], d: [0, 0, -1],
    hits: [{ id: 'v', dmg: 1000, zone: 'b' }] });
  assert.equal(protectedDuel.v.hp, 100, 'spawn protection still applies');
});

test('authoritative shot damage observes distance, suppressors and one hit per target', () => {
  const { core, a, v } = duel();
  // A bounded, unobstructed firing lane uses the real shared raycaster, not a LOS stub.
  core.map.boxes = [];
  core.map.grid = Array.from({ length: core.map.W * core.map.H }, () => []);
  core.map.crates = []; core.map.cellCrate.fill(-1);
  Object.assign(a, { x: 2, z: 2, secondary: 'pistol', att: { pistol: ATT.SUP } });
  Object.assign(v, { x: 2, z: 43, armor: 0 });
  const hit = { id: 'v', dmg: 999, zone: 'b' };
  core.handle('a', { t: 'shoot', w: 'pistol', o: [2, EYE_STAND, 2], d: [0, 0, 1], hits: [hit, hit] });
  const expected = dmgAt(WEAPONS.pistol, 41) * SUP_DMG;
  assert.ok(Math.abs(v.hp - (100 - expected)) < 1e-8);
  assert.equal(a.hits, 1, 'duplicate claims do not multiply a shot');
});

test('hurt, reloading bots seek actual cover without a knife rush or extra health', () => {
  const { core, a, v } = duel();
  a.bot = true; a.hp = 30; a.primary = a.weapon = 'rifle'; a.ammo = { rifle: 0, pistol: 17 };
  core.time = 3; a.reloadUntil = 6;
  const [x, z] = cellCenter(core.map, cellIndex(core.map, a.x, a.z));
  Object.assign(a, { x, z: z + 1.2, yaw: 0 });
  Object.assign(v, { x, z: z - 1.2 });
  assert.equal(lineOfSight(core.map, a.x, a.z, v.x, v.z), true);
  core.botThink(a, 1 / 30);
  assert.equal(a.weapon, 'rifle', 'reload is not canceled for a multi-meter knife chase');
  assert.equal(a.hp, 30, 'tactics never grant health');
  assert.ok(a.cover, 'reachable cover was selected');
  assert.equal(lineOfSight(core.map, v.x, v.z, a.cover.x, a.cover.z), false, 'cover actually breaks LOS');
  v.alive = false; a.target = null; a.cover = null; a.lastSeen = { x: v.x, z: v.z, t: core.time - 7 };
  core.botThink(a, 1 / 30);
  assert.equal(a.lastSeen, null, 'target memory expires rather than following hidden enemies');
});

test('first online arena choice preserves occupied settings, fills five-per-side slots and equal loadouts', () => {
  const core = new GameCore({ bots: 3, seed: 8 });
  const inbox = { a: [], b: [] };
  for (const id of Object.keys(inbox)) core.join(id, (msg) => inbox[id].push(msg));
  core.handle('a', { t: 'join', bots: 10, mode: 'tdm', layout: 'arena', light: 'dim',
    appearance: { head: 'beanie', chest: 'rig', legs: 'cargo', palette: 'olive' } });
  assert.equal(core.mode, 'tdm'); assert.equal(core.layout, 'arena'); assert.equal(core.map.W, 10);
  assert.deepEqual(core.teamCounts(), [5, 5]);
  assert.equal(inbox.a.find((msg) => msg.t === 'welcome').bots, 9, 'one human occupies a bot slot');
  core.handle('b', { t: 'join', bots: 0, mode: 'escape', layout: 'escape', light: 'dark' });
  assert.equal(core.mode, 'tdm'); assert.equal(core.layout, 'arena'); assert.equal(core.light, 'dim');
  assert.equal(core.onlineBotCount, 10);
  assert.deepEqual(core.teamCounts(), [5, 5]);
  for (const team of [0, 1]) {
    const players = [...core.players.values()].filter((p) => p.team === team);
    assert.equal(new Set(players.map((p) => p.teamSlot)).size, 5);
    for (const p of players) {
      assert.ok(p.teamSlot >= 0 && p.teamSlot < 5);
      assert.equal(p.primary, 'm4'); assert.equal(p.secondary, 'pistol');
      assert.equal(p.hp, 100); assert.equal(p.armor, 100); assert.equal(p.nades, 1);
      assert.equal(p.x, core.map.teamSpawns[team][p.teamSlot].x);
    }
  }
  const spawn = inbox.a.find((msg) => msg.t === 'spawn');
  assert.equal(spawn.armor, 100); assert.equal(spawn.inv.p, 'm4');
  assert.equal(spawn.appearance.head, 'beanie');
  for (let i = 0; i < 8; i++) {
    const id = 'h' + i; core.join(id, () => {}); core.handle(id, { t: 'join' });
  }
  assert.equal(core.players.size, 10);
  core.join('full', (msg) => inbox.a.push(msg)); core.handle('full', { t: 'join' });
  assert.equal(core.players.has('full'), false);
  assert.equal(inbox.a.at(-1).t, 'error');
});

test('offline arena honors the chosen participant target without forcing unwanted bots', () => {
  const core = new GameCore({ bots: 1, mode: 'tdm', layout: 'arena', seed: 39 });
  core.join('me', () => {});
  core.handle('me', { t: 'join', name: 'Practice' });
  assert.equal(core.players.size, 1);
  assert.equal([...core.players.values()].some((p) => p.bot), false, 'zero selected opponents remain zero in the arena');
  assert.equal(core.players.get('me').alive, true);
});

test('escape rejects creature sanctuary movement, radius overlap, crossing and damage', () => {
  const { core, m, a, inbox } = escapeDuel();
  const zone = core.map.safeZones[0], entrance = sanctuaryEntrance(core.map, zone);
  Object.assign(m, { x: entrance.outside[0], z: entrance.outside[1] });
  Object.assign(a, { x: entrance.inside[0], z: entrance.inside[1], protect: 0 });
  m.yaw = Math.atan2(-(a.x - m.x), -(a.z - m.z));
  assert.equal(lineOfSight(core.map, m.x, m.z, a.x, a.z), true);
  assert.equal(safeAt(core.map, a.x, a.z), zone.id);
  const before = [m.x, m.y, m.z];
  core.handle('m', { t: 'in', p: [a.x, 0, a.z], yw: m.yaw, f: F.MOVE, w: 'knife' });
  assert.deepEqual([m.x, m.y, m.z], before);
  assert.equal(inbox.m.at(-1).t, 'correct');
  core.handle('m', { t: 'swing', h: 1 }); core.handle('m', { t: 'stab', id: 'a' });
  assert.equal(a.hp, 100, 'valid melee LOS cannot hurt a sanctuary occupant');
  assert.equal(core.damage(a, 200, m, 'nade', 'x'), false, 'explosions cannot bypass sanctuary immunity');
  assert.equal(core.monsterMoveAllowed(zone.x0 - 1, zone.z, zone.x0 - PLAYER_R / 2, zone.z), false, 'whole-body radius stays outside');
  assert.equal(core.monsterMoveAllowed(zone.x0 - 0.6, zone.z0 + 0.7, zone.x0 + 0.7, zone.z0 - 0.6), false, 'a diagonal cannot cross a safe corner');
  assert.equal(m.hp, 100); assert.equal(m.primary, null); assert.equal(m.secondary, null); assert.equal(m.nades, 0);
  m.primary = 'rifle'; m.nades = 1;
  const shots = m.shots;
  core.handle('m', { t: 'shoot', w: 'rifle', o: [m.x, EYE_STAND, m.z], d: [0, 0, -1], hits: [{ id: 'a', dmg: 99 }] });
  core.handle('m', { t: 'nade', o: [m.x, EYE_STAND, m.z], v: [0, 0, -1] });
  assert.equal(m.shots, shots); assert.equal(core.nades.length, 0, 'creature cannot use guns or grenades');
  const drop = core.addDrop('m4', m.x, m.z);
  assert.equal(core.onPickup(m, drop.id), false, 'creature cannot equip loot');
});

test('escape exit finishes cooperatively, spectators never respawn and reset restores the round', () => {
  const { core, m, a, b, inbox } = escapeDuel();
  for (const survivor of [a, b]) assert.equal(safeAt(core.map, survivor.x, survivor.z), 0, 'survivors can learn the map safely before entering darkness');
  assert.equal(safeAt(core.map, m.x, m.z), -1, 'the creature begins outside the illuminated refuge');
  const exit = core.map.exit;
  Object.assign(a, { x: exit.x, z: exit.z });
  core.handle('a', { t: 'in', p: [exit.x, 0, exit.z], f: 0, w: 'pistol' });
  assert.equal(a.alive, false); assert.equal(a.escaped, true);
  assert.deepEqual(core.escapeState(), { escaped: 1, total: 2, monster: m.id, status: 'running' });
  core.tick(RESPAWN_T + 1);
  assert.equal(a.alive, false, 'escaped survivors do not respawn');
  Object.assign(b, { x: exit.x, z: exit.z });
  core.handle('b', { t: 'in', p: [exit.x, 0, exit.z], f: 0, w: 'pistol' });
  assert.equal(core.escapeState().status, 'escaped');
  const match = inbox.a.find((msg) => msg.t === 'match');
  assert.equal(match.mode, 'escape'); assert.equal(match.outcome, 'escaped');
  assert.equal(match.escaped, 2); assert.equal(match.total, 2);
  assert.ok(inbox.a.some((msg) => msg.t === 'escape' && msg.action === 'escaped' && msg.id === 'a'));
  core.tick(INTERMISSION_T + 0.01);
  assert.deepEqual(core.escapeState(), { escaped: 0, total: 2, monster: m.id, status: 'running' });
  for (const p of [a, b, m]) { assert.equal(p.alive, true); assert.equal(p.escaped, false); assert.equal(p.eliminated, false); }
  for (const survivor of [a, b]) assert.equal(safeAt(core.map, survivor.x, survivor.z), 0, 'new rounds restore the safe briefing spawn');
  const reset = inbox.a.find((msg) => msg.t === 'reset');
  assert.equal(reset.layout, 'escape'); assert.equal(reset.mode, 'escape'); assert.equal(reset.light, 'dark');
});

test('escape elimination is permanent for the round and all captured survivors lose', () => {
  const { core, m, a, b, inbox } = escapeDuel();
  Object.assign(a, { x: m.x + 0.5, z: m.z, protect: 0 });
  assert.equal(core.damage(a, 100, m, 'knife', 'k'), true);
  assert.equal(a.alive, false); assert.equal(a.eliminated, true);
  core.tick(RESPAWN_T + 1);
  assert.equal(a.alive, false);
  Object.assign(b, { x: m.x + 0.5, z: m.z, protect: 0 });
  core.damage(b, 100, m, 'knife', 'k');
  assert.equal(core.escapeState().status, 'caught');
  assert.equal(inbox.a.find((msg) => msg.t === 'match').outcome, 'caught');
  assert.ok(inbox.a.some((msg) => msg.t === 'escape' && msg.action === 'eliminated' && msg.id === 'a'));
  core.newMatch();
  assert.equal(a.alive, true); assert.equal(a.eliminated, false); assert.equal(core.escapeState().total, 2);
});

test('escape creature has finite health and armed survivors can defeat it', () => {
  const { core, m, a } = escapeDuel();
  Object.assign(a, { x: m.x, z: m.z + 0.8, primary: 'sniper', weapon: 'sniper', protect: 0 });
  core.handle('a', { t: 'shoot', w: 'sniper', o: [a.x, EYE_STAND, a.z], d: [0, 0, -1], hits: [{ id: m.id, dmg: 250, zone: 'b' }] });
  assert.equal(m.alive, false);
  assert.equal(core.escapeState().status, 'escaped', 'defeating the finite creature is a survivor victory');
});

test('escape timeout, late spectator joins and requested creature rotation remain operational', () => {
  const { core, m, a, inbox } = escapeDuel({ a: 'monster' });
  assert.equal(m.role, 'monster'); assert.equal(a.role, 'survivor', 'only one human creature at once');
  core.tick(ESCAPE_JOIN_T + 0.1);
  const lateMessages = [];
  core.join('late', (msg) => lateMessages.push(msg)); core.handle('late', { t: 'join', role: 'survivor' });
  const late = core.players.get('late');
  assert.equal(late.alive, false); assert.equal(late.spectator, true);
  assert.equal(core.escapeState().total, 2, 'round membership is finite');
  assert.equal(lateMessages.find((msg) => msg.t === 'spawn').spectator, true);
  core.tick(RESPAWN_T + 1); assert.equal(late.alive, false);
  core.newMatch();
  assert.equal(a.role, 'monster'); assert.equal(m.role, 'survivor');
  assert.equal(late.alive, true); assert.equal(core.escapeState().total, 3);
  core.newMatch(); assert.equal(m.role, 'monster', 'requested creature role rotates each round');
  core.timeLimit = 0.1; core.tick(0.11);
  assert.equal(core.escapeState().status, 'timeout');
  assert.equal(inbox.a.filter((msg) => msg.t === 'match').at(-1).outcome, 'timeout');
});

test('escape fallback AI is present even with no optional bots and stays outside sanctuaries', () => {
  const core = new GameCore({ bots: 0, seed: 11, mode: 'escape' });
  const messages = [];
  core.join('h', (msg) => messages.push(msg));
  core.handle('h', { t: 'join', bots: 0, mode: 'escape', role: 'survivor' });
  const monster = core.players.get(core.escapeState().monster);
  assert.equal(monster.bot, true); assert.equal(monster.role, 'monster');
  assert.equal(core.escapeState().total, 1); assert.equal(core.onlineBotCount, 0);
  for (let i = 0; i < 30 * 4; i++) {
    core.tick(1 / 30);
    assert.equal(safeAt(core.map, monster.x, monster.z), -1);
  }
  assert.equal(messages.find((msg) => msg.t === 'welcome').role, 'survivor');
  assert.ok(messages.some((msg) => msg.t === 'snap' && msg.esc?.monster === monster.id));
  const soloCreature = new GameCore({ bots: 0, seed: 12, mode: 'escape' });
  soloCreature.join('m', () => {});
  soloCreature.handle('m', { t: 'join', bots: 0, role: 'monster' });
  assert.equal(soloCreature.players.get('m').role, 'monster');
  assert.equal(soloCreature.escapeState().total, 1, 'solo human creature has a real AI survivor opponent');
  const survivor = [...soloCreature.players.values()].find((p) => p.bot);
  const remaining = () => findPath(soloCreature.map, cellIndex(soloCreature.map, survivor.x, survivor.z), soloCreature.map.exit.cell).length;
  const before = remaining();
  for (let i = 0; i < 30 * 5; i++) soloCreature.tick(1 / 30);
  assert.ok(remaining() < before, 'survivor AI makes real corridor progress toward the exit');
});

test('sanctuary rest heals only after stillness and is limited per zone and round', () => {
  const { core, a } = escapeDuel();
  const zones = core.map.safeZones;
  Object.assign(a, { x: zones[0].x, z: zones[0].z, hp: 10, flags: 0 });
  core.tick(1);
  assert.equal(a.hp, 10, 'no immediate healing');
  for (let i = 0; i < 30 * 10; i++) core.tick(1 / 30);
  assert.ok(Math.abs(a.hp - (10 + REST_ZONE_HP)) < 1e-6);
  a.hp = 10;
  for (let i = 0; i < 30 * 3; i++) core.tick(1 / 30);
  assert.equal(a.hp, 10, 're-entering the same zone cannot renew its healing');
  for (const zone of zones.slice(1, 3)) {
    Object.assign(a, { x: zone.x, z: zone.z, flags: 0 });
    for (let i = 0; i < 30 * 10; i++) core.tick(1 / 30);
  }
  assert.ok(Math.abs(a.restHealed - REST_ROUND_HP) < 1e-6);
  Object.assign(a, { x: zones[3].x, z: zones[3].z, hp: 10, flags: 0 });
  for (let i = 0; i < 30 * 10; i++) core.tick(1 / 30);
  assert.equal(a.hp, 10, 'round-wide healing budget is finite');
});

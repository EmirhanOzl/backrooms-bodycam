// Headless tests for the shared simulation: run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameCore, EYE_STAND } from '../public/js/shared/core.js';
import { WEAPONS, GRENADE, blastDamage, meleeDamage } from '../public/js/shared/weapons.js';
import { SHOP, ATT, BONUS, ECON, magSize } from '../public/js/shared/items.js';
import { cellCenter } from '../public/js/shared/map.js';
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
  assert.ok(seen.swing > 0, 'bots used knives');
  assert.ok(seen.boom > 0, 'bots threw grenades');
  assert.ok(seen.drop > 0, 'weapons were dropped');
  assert.ok(seen.crate > 0, 'bots opened crates');
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

test('every weapon has the data the client needs', () => {
  for (const [k, w] of Object.entries(WEAPONS)) {
    assert.ok(w.label && w.short && w.slot && w.cls && w.draw > 0 && Array.isArray(w.modes), k);
    if (!w.melee) assert.ok(w.mag > 0 && w.rpm > 0 && w.range > 0 && (w.reload > 0 || w.shell), k);
  }
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

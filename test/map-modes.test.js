import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMap, findPath, passable, cellCenter, cellIndex, safeAt,
  lineOfSight, collide, groundHeight, ceilingHeight, CELL, CEIL, DOOR_H, CRATE_H,
} from '../public/js/shared/map.js';

function distances(map, start, blocked = null) {
  const result = new Int32Array(map.W * map.H).fill(-1), queue = [start];
  result[start] = 0;
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i], x = cell % map.W, z = Math.floor(cell / map.W);
    for (const [dir, next] of [[0, cell + 1], [1, cell - 1], [2, cell + map.W], [3, cell - map.W]]) {
      if (!passable(map, x, z, dir) || blocked?.[next] || result[next] >= 0) continue;
      result[next] = result[cell] + 1; queue.push(next);
    }
  }
  return result;
}

function walkPath(map, from, path) {
  let previous = from;
  for (const cell of path) {
    const [ax, az] = cellCenter(map, previous), [bx, bz] = cellCenter(map, cell);
    assert.ok(lineOfSight(map, ax, az, bx, bz), 'navigation edges agree with solid ray geometry');
    for (let i = 1; i <= 8; i++) {
      const p = { x: ax + (bx - ax) * i / 8, y: 0, z: az + (bz - az) * i / 8, height: 1.82 };
      const x = p.x, z = p.z;
      collide(map, p, 0.32);
      assert.ok(Math.hypot(p.x - x, p.z - z) < 1e-6, 'a standing player fits the navigation route');
    }
    previous = cell;
  }
}

test('maze, arena and escape are seeded, connected maps with compatible navigation geometry', () => {
  for (const layout of ['maze', 'arena', 'escape']) for (const seed of [1, 42, 0xfedcba98]) {
    const a = generateMap(seed, 18, 'normal', layout), b = generateMap(seed, 18, 'normal', layout);
    assert.equal(a.layout, layout);
    assert.deepEqual(a.h, b.h); assert.deepEqual(a.v, b.v);
    assert.deepEqual(a.crates, b.crates); assert.deepEqual(a.vendors, b.vendors);
    assert.deepEqual(a.fixtures, b.fixtures); assert.deepEqual(a.safeZones, b.safeZones);
    assert.equal(distances(a, a.start.cell).filter((d) => d >= 0).length, a.W * a.H);
    const path = findPath(a, a.start.cell, a.exit.cell);
    assert.ok(path?.length);
    walkPath(a, a.start.cell, path);
  }
});

test('escape sanctuaries are spaced route rests without severing any dark creature routes', () => {
  for (const seed of [7, 1234, 908172]) {
    const map = generateMap(seed, 18, 'normal', 'escape');
    assert.equal(map.W, 44); assert.equal(map.H, 44); assert.equal(map.light, 'dark');
    assert.equal(map.safeZones.length, 10);
    assert.ok(Math.hypot(map.start.x - map.exit.x, map.start.z - map.exit.z) > map.size);
    const blocked = Uint8Array.from(map.safeMask, (id) => id >= 0 ? 1 : 0);
    const darkDistances = distances(map, map.monsterSpawn.cell, blocked);
    for (let cell = 0; cell < map.W * map.H; cell++) {
      const [x, z] = cellCenter(map, cell), safe = map.safeMask[cell];
      assert.equal(safeAt(map, x, z), safe);
      if (safe >= 0) assert.equal(darkDistances[cell], -1);
      else {
        assert.ok(darkDistances[cell] >= 0, 'every dark corridor remains creature-accessible');
        assert.equal(map.fixtures[cell].state, 1, 'no powered corridor fixtures');
        assert.equal(map.cellLight[cell], 0, 'emergency accents do not become gameplay lights');
      }
    }
    const survivorRoute = findPath(map, map.start.cell, map.exit.cell);
    const darkRoute = findPath(map, map.start.cell, map.exit.cell, blocked);
    assert.ok(survivorRoute.length <= 110, 'the much larger map does not require an endless perfect-maze detour');
    assert.ok(darkRoute?.length && darkRoute.every((cell) => !blocked[cell]));
    for (const room of map.safeZones) {
      assert.equal(safeAt(map, room.x, room.z), room.id);
      assert.equal(cellIndex(map, room.x, room.z), room.cell);
      assert.ok(findPath(map, map.start.cell, room.cell));
      assert.ok(findPath(map, room.cell, map.exit.cell));
      const restBranch = findPath(map, room.milestone, room.cell);
      assert.ok(restBranch.length <= 18, 'sanctuaries are accessible from their route milestones without a maze slog');
      walkPath(map, room.milestone, restBranch);
      assert.equal(findPath(map, map.monsterSpawn.cell, room.cell, blocked), null);
      for (const other of map.safeZones) if (room.id !== other.id) {
        assert.ok(Math.hypot(room.x - other.x, room.z - other.z) >= 4 * CELL);
      }
    }
    assert.equal(safeAt(map, -0.01, map.safeZones[0].z), -1);
    assert.equal(safeAt(map, map.size, map.safeZones[0].z), -1);
  }
});

test('arena offers broad flanks, middle cover and equal protected five-player team spawns', () => {
  const map = generateMap(88, 18, 'normal', 'arena');
  assert.equal(map.W, 10); assert.equal(map.H, 10);
  assert.deepEqual(map.teamSpawns.map((spawns) => spawns.length), [5, 5]);
  const reflect = (cell) => Math.floor(cell / map.W) * map.W + map.W - 1 - cell % map.W;
  for (let cell = 0; cell < map.W * map.H; cell++) {
    const a = distances(map, cell), b = distances(map, reflect(cell));
    for (let target = 0; target < a.length; target++) assert.equal(a[target], b[reflect(target)], 'team navigation is symmetric');
  }
  for (let slot = 0; slot < 5; slot++) {
    const a = map.teamSpawns[0][slot], b = map.teamSpawns[1][slot];
    assert.equal(a.x + b.x, map.size); assert.equal(a.z, b.z);
    const p = { ...a, y: 0, height: 1.82 }; collide(map, p, 0.32);
    assert.equal(p.x, a.x); assert.equal(p.z, a.z);
    for (const enemy of map.teamSpawns[1]) assert.equal(lineOfSight(map, a.x, a.z, enemy.x, enemy.z), false);
  }
  for (const z of [CELL / 2, map.size - CELL / 2]) assert.ok(lineOfSight(map, 1.5 * CELL, z, map.size - 1.5 * CELL, z), 'both wide flank routes remain open');
  assert.equal(lineOfSight(map, 3.5 * CELL, 4.5 * CELL, 4.5 * CELL, 4.5 * CELL), false, 'middle cover is solid to rays');
  walkPath(map, map.teamSpawns[0][2].cell, findPath(map, map.teamSpawns[0][2].cell, map.teamSpawns[1][2].cell));
});

test('crate support and doorway clearance agree with feet-height collision', () => {
  const map = generateMap(17), crate = map.crates[0];
  assert.ok(crate && map.lintels.length);
  assert.equal(groundHeight(map, crate.x, crate.z, 0.32, CRATE_H), CRATE_H);
  assert.equal(groundHeight(map, crate.x, crate.z, 0.32, CRATE_H - 0.001), 0);
  const floor = { x: crate.x, y: 0, z: crate.z, height: 1.82 };
  collide(map, floor, 0.32);
  assert.ok(Math.hypot(floor.x - crate.x, floor.z - crate.z) > 0);
  const top = { x: crate.x, y: CRATE_H, z: crate.z, height: 1.82 };
  collide(map, top, 0.32); assert.equal(top.x, crate.x); assert.equal(top.z, crate.z);
  const door = map.lintels[0], x = (door.x0 + door.x1) / 2, z = (door.z0 + door.z1) / 2;
  assert.equal(ceilingHeight(map, x, z, 0.32), DOOR_H);
  assert.equal(ceilingHeight(map, map.start.x, map.start.z, 0.32), CEIL);
  const standing = { x, y: 0, z, height: 1.82 }; collide(map, standing, 0.32);
  assert.equal(standing.x, x); assert.equal(standing.z, z);
  const jumping = { x, y: 0.6, z, height: 1.82 }; collide(map, jumping, 0.32);
  assert.ok(Math.hypot(jumping.x - x, jumping.z - z) > 0, 'raised heads cannot enter a lintel');
});

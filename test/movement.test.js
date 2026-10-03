import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, collide, groundHeight, ceilingHeight, CEIL, CELL, CRATE_H, DOOR_H } from '../public/js/shared/map.js';
import { createMovementState, resetMovementState, stepMovement, MOVEMENT, STAMINA_MAX } from '../public/js/shared/movement.js';

const STEP = 1 / 120;
const IDLE = Object.freeze({});
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} is within ${tolerance} of ${expected}`);
const speed = (state) => Math.hypot(state.vx, state.vz);
const yawOf = (x, z) => Math.atan2(-x, -z);
const arena = () => generateMap(90210, 18, 'normal', 'arena');

function run(map, state, seconds, input = IDLE, fps = 120, observe = null) {
  let elapsed = 0;
  while (elapsed < seconds - 1e-9) {
    const dt = Math.min(1 / fps, seconds - elapsed);
    stepMovement(map, state, typeof input === 'function' ? input(state, elapsed) : input, dt);
    if (observe) observe(state);
    elapsed += dt;
  }
  return state;
}

function clear(map, x, z, y = 0, radius = MOVEMENT.radius) {
  const point = { x, y, z, height: MOVEMENT.standHeight };
  collide(map, point, radius);
  return Math.abs(point.x - x) < 1e-6 && Math.abs(point.z - z) < 1e-6;
}

// Discover usable areas from real generated geometry rather than replacing collision with a fixture.
function openPatch(map, radius = 0) {
  for (let z = radius + 1; z < map.size - radius - 1; z += 0.5) {
    for (let x = radius + 1; x < map.size - radius - 1; x += 0.5) {
      const r = radius + MOVEMENT.radius;
      if (clear(map, x, z, 0, r) && groundHeight(map, x, z, r) === 0
        && ceilingHeight(map, x, z, r) === CEIL) return { x, z };
    }
  }
  assert.fail('generated map contains no unobstructed movement area');
}

function crateApproach() {
  const map = generateMap(7581);
  for (const crate of map.crates) {
    if (!clear(map, crate.x, crate.z, CRATE_H) || ceilingHeight(map, crate.x, crate.z, MOVEMENT.radius) !== CEIL) continue;
    const cos = Math.cos(crate.rot), sin = Math.sin(crate.rot);
    for (const [nx, nz] of [[cos, -sin], [-cos, sin], [sin, cos], [-sin, -cos]]) {
      if (![0.7, 1.1, 1.5, 1.8].every((d) => clear(map, crate.x + nx * d, crate.z + nz * d))) continue;
      return { map, crate, nx, nz, x: crate.x + nx * 1.1, z: crate.z + nz * 1.1 };
    }
  }
  assert.fail('generated map contains no approachable loot crate');
}

function leaveCrate(fixture) {
  const { map, crate, nx, nz } = fixture;
  const state = createMovementState({ x: crate.x, y: CRATE_H, z: crate.z, onGround: true, vx: nx * 3.3, vz: nz * 3.3 });
  const input = { forward: 1, yaw: yawOf(nx, nz) };
  for (let i = 0; i < 120; i++) {
    stepMovement(map, state, input, STEP);
    if (!state.onGround) return state;
  }
  assert.fail('walking away from the crate must lose its support');
}

test('ground acceleration, stopping and counter-strafing retain a finite velocity', () => {
  const map = arena(), spot = openPatch(map, 3);
  const state = createMovementState(spot);
  stepMovement(map, state, { side: 1 }, STEP);
  assert.ok(state.vx > 0 && state.vx < 1, 'movement accelerates instead of teleporting to its target speed');
  run(map, state, 0.35, { side: 1 });
  near(speed(state), 3.3);
  run(map, state, 0.1, { side: -1 });
  assert.ok(state.vx < -1.5, 'opposite input actively counter-strafes');
  run(map, state, 0.25);
  near(speed(state), 0);
  assert.equal(state.onGround, true);
});

test('diagonal input has no speed bonus and analog, ADS and crouch change actual speed', () => {
  const map = arena(), spot = openPatch(map, 3);
  const straight = run(map, createMovementState(spot), 0.5, { forward: 1 });
  const diagonal = run(map, createMovementState(spot), 0.5, { forward: 1, side: 1 });
  const analog = run(map, createMovementState(spot), 0.5, { forward: 0.5 });
  const aiming = run(map, createMovementState(spot), 0.5, { forward: 1, sprint: true, ads: 1 });
  const crouching = run(map, createMovementState(spot), 0.5, { forward: 1, sprint: true, crouch: true, jump: true });
  near(speed(diagonal), speed(straight));
  near(speed(analog), 1.65);
  near(speed(aiming), 3.3 * 0.65);
  near(speed(crouching), 1.8);
  assert.equal(aiming.sprint, false);
  assert.equal(crouching.sprint, false);
  assert.equal(crouching.hopCount, 0);
  assert.equal(crouching.onGround, true);
  near(crouching.stamina, STAMINA_MAX);
});

test('solid wall contact slides and removes velocity directed into the wall', () => {
  const map = arena();
  const wall = map.boxes.find((b) => b.kind === 0 && Math.abs((b.z0 + b.z1) / 2) < 1e-6);
  assert.ok(wall);
  const state = createMovementState({ x: CELL * 2, z: wall.z1 + MOVEMENT.radius + 0.12 });
  run(map, state, 1, { forward: 1, side: 1 });
  near(state.z, wall.z1 + MOVEMENT.radius);
  near(state.vz, 0);
  assert.ok(state.x > CELL * 2 + 1.5 && state.vx > 2, 'unblocked tangential movement continues');
});

test('bounded substeps prevent a fast airborne player tunneling through a thin interior wall', () => {
  const map = arena();
  const wall = map.boxes.find((b) => b.kind === 0 && b.z0 > 1 && b.z1 < map.size - 1 && b.x1 - b.x0 > 3);
  assert.ok(wall);
  const state = createMovementState({ x: (wall.x0 + wall.x1) / 2, y: 0.8,
    z: wall.z0 - MOVEMENT.radius - 0.12, vz: 2000, onGround: false });
  stepMovement(map, state, { forward: 1, yaw: Math.PI }, 0.25);
  assert.ok(state.z <= wall.z0 - MOVEMENT.radius + 1e-6);
  near(state.vz, 0);
  assert.ok(state.y > 0 && !state.onGround);
  assert.ok(speed(state) <= 8.2 + 1e-6);
});

test('a normal jump rises about 0.9m, preserves momentum and reports its landing impact', () => {
  const map = arena(), spot = openPatch(map, 3);
  const state = createMovementState({ ...spot, vx: 3.3 });
  stepMovement(map, state, { jump: true }, STEP);
  assert.equal(state.jumped, true);
  near(state.vx, 3.3);
  let peak = state.y, landed = false, impact = 0;
  run(map, state, 0.8, IDLE, 120, (s) => {
    peak = Math.max(peak, s.y);
    if (s.landed) { landed = true; impact = s.impactSpeed; }
  });
  near(peak, 0.9, 0.001);
  assert.equal(landed, true);
  near(impact, Math.sqrt(2 * 13 * 0.9), 1e-6);
  assert.equal(state.onGround, true);
  near(state.y, 0);
  assert.equal(state.landed, false, 'landing is an event, not a permanent flag');
});

test('a released jump press buffers a near landing but an old press expires in the air', () => {
  const map = arena(), spot = openPatch(map);
  const buffered = createMovementState({ ...spot, y: 0.06, vy: -1, onGround: false });
  stepMovement(map, buffered, { jump: true }, STEP);
  assert.equal(buffered.jumped, false);
  let rebounded = false;
  run(map, buffered, 0.09, IDLE, 120, (s) => { if (s.landed && s.jumped) rebounded = true; });
  assert.equal(rebounded, true);
  assert.ok(buffered.y > 0 && buffered.vy > 0 && !buffered.onGround);
  near(buffered.stamina, STAMINA_MAX - 0.08);

  const expired = createMovementState({ ...spot, y: 0.9, onGround: false });
  stepMovement(map, expired, { jump: true }, STEP);
  run(map, expired, 0.5);
  assert.equal(expired.onGround, true);
  assert.equal(expired.hopCount, 0);
  near(expired.stamina, STAMINA_MAX);
});

test('holding jump rebounds at impact without a ground-friction frame; crouch breaks the chain', () => {
  const map = arena(), spot = openPatch(map, 3);
  const state = createMovementState({ ...spot, vx: 5.6 });
  let hops = 0, sawRebound = false;
  run(map, state, 1.6, { jump: true }, 120, (s) => {
    if (s.jumped) hops++;
    if (s.landed && s.jumped) { sawRebound = true; near(s.vx, 5.6); assert.equal(s.onGround, false); }
  });
  assert.ok(hops >= 3 && sawRebound);
  assert.equal(state.hopCount, hops);
  run(map, state, 1, { jump: true, crouch: true });
  assert.equal(state.hopCount, 0);
  assert.equal(state.onGround, true);
  near(speed(state), 0);
  assert.equal(state.crouch, true);
});

test('mouse-directed air strafes build bounded repeatable hop speed, unlike fixed forward input', () => {
  const map = arena(), spot = openPatch(map, 3);
  function chain(strafe) {
    const state = createMovementState({ ...spot, vx: 5.6 });
    let peak = 0, hops = 0;
    run(map, state, 3.3, (s) => {
      let yaw = -Math.PI / 2;
      if (strafe) {
        const length = Math.max(1e-6, speed(s)), ux = s.vx / length, uz = s.vz / length;
        const along = Math.min(0.5 / length, 1), across = Math.sqrt(1 - along * along);
        yaw = yawOf(ux * along - uz * across, uz * along + ux * across);
      }
      return { forward: 1, sprint: true, jump: true, yaw };
    }, 120, (s) => {
      peak = Math.max(peak, speed(s));
      if (s.jumped) hops++;
      assert.ok(speed(s) <= 8.2 + 1e-6);
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z));
    });
    return { state, peak, hops };
  }
  const skilled = chain(true), repeat = chain(true), fixed = chain(false);
  assert.deepEqual(repeat, skilled);
  assert.ok(skilled.peak > 7.5 && skilled.peak > fixed.peak + 1, 'yaw-driven directional acceleration earns speed');
  assert.ok(skilled.hops >= 4, 'held space supports a chain of successive hops');
});

test('a jump clears a real rotated loot crate, lands on its top and falls when stepping off', () => {
  const fixture = crateApproach(), { map, nx, nz } = fixture;
  const state = createMovementState({ x: fixture.x, z: fixture.z });
  const toward = { forward: 1, yaw: yawOf(-nx, -nz), moveMul: 0.4 };
  stepMovement(map, state, { ...toward, jump: true }, STEP);
  let landedOnCrate = false;
  for (let i = 0; i < 120; i++) {
    stepMovement(map, state, toward, STEP);
    if (state.landed) { landedOnCrate = state.y === CRATE_H; break; }
  }
  assert.equal(landedOnCrate, true);
  run(map, state, 0.12);
  near(state.y, CRATE_H);
  near(state.vy, 0);
  assert.equal(state.onGround, true);
  let airborne = false, floorLanding = false;
  run(map, state, 0.8, { forward: 1, yaw: yawOf(nx, nz) }, 120, (s) => {
    if (!s.onGround) { airborne = true; assert.ok(s.y < CRATE_H && s.y > 0); }
    if (s.landed && s.y === 0) floorLanding = true;
  });
  assert.ok(airborne && floorLanding, 'losing crate support produces a genuine fall and floor landing');
  near(state.y, 0);
});

test('leaving a crate grants a short coyote jump, not a fresh ground jump throughout the fall', () => {
  const fixture = crateApproach(), { map } = fixture;
  const early = leaveCrate(fixture);
  run(map, early, 0.025);
  assert.equal(early.onGround, false);
  stepMovement(map, early, { jump: true }, STEP);
  assert.equal(early.jumped, true);
  assert.ok(early.vy > 0);

  const late = leaveCrate(fixture);
  run(map, late, 0.11);
  assert.equal(late.onGround, false);
  stepMovement(map, late, { jump: true }, STEP);
  assert.equal(late.jumped, false);
  assert.ok(late.vy < 0 && late.y > 0);
  run(map, late, 0.025);
  assert.equal(late.onGround, false);
  assert.equal(late.hopCount, 0);
});

test('jumping from a crate respects the solid ceiling instead of clipping the standing head', () => {
  const { map, crate } = crateApproach();
  const state = createMovementState({ x: crate.x, y: CRATE_H, z: crate.z, onGround: true });
  stepMovement(map, state, { jump: true }, STEP);
  let headHit = false, landed = false, peak = state.y;
  run(map, state, 0.8, IDLE, 120, (s) => {
    peak = Math.max(peak, s.y);
    headHit ||= s.headHit;
    landed ||= s.landed;
    assert.ok(s.y + s.height <= CEIL + 1e-6);
  });
  assert.ok(headHit && landed);
  near(peak, CEIL - MOVEMENT.standHeight, 0.001);
  near(state.y, CRATE_H);
});

test('door lintels stop upward travel and prevent uncrouching into their underside', () => {
  const map = generateMap(4444), lintel = map.lintels[0];
  assert.ok(lintel);
  const spot = { x: (lintel.x0 + lintel.x1) / 2, z: (lintel.z0 + lintel.z1) / 2 };
  assert.ok(clear(map, spot.x, spot.z));
  const state = createMovementState(spot);
  stepMovement(map, state, { jump: true }, STEP);
  let hit = false, peak = state.y;
  run(map, state, 0.5, IDLE, 120, (s) => {
    hit ||= s.headHit;
    peak = Math.max(peak, s.y);
    assert.ok(s.y + s.height <= DOOR_H + 1e-6);
  });
  assert.equal(hit, true);
  near(peak, DOOR_H - MOVEMENT.standHeight, 0.001);

  const duck = createMovementState({ ...spot, y: 0.7, crouch: true, onGround: false });
  stepMovement(map, duck, IDLE, STEP);
  assert.equal(duck.crouch, true, 'standing is deferred until head clearance exists');
  run(map, duck, 0.5, IDLE, 120, (s) => assert.ok(s.y + s.height <= DOOR_H + 1e-6));
  assert.equal(duck.crouch, false);
  assert.equal(duck.onGround, true);
});

test('airborne contact with the side of a lintel blocks forward velocity without snapping feet down', () => {
  const map = generateMap(4444), lintel = map.lintels[0];
  assert.ok(lintel);
  const vertical = lintel.x1 - lintel.x0 < lintel.z1 - lintel.z0;
  const nx = vertical ? 1 : 0, nz = vertical ? 0 : 1;
  const half = (vertical ? lintel.x1 - lintel.x0 : lintel.z1 - lintel.z0) / 2;
  const x = (lintel.x0 + lintel.x1) / 2 - nx * (half + MOVEMENT.radius + 0.14);
  const z = (lintel.z0 + lintel.z1) / 2 - nz * (half + MOVEMENT.radius + 0.14);
  assert.ok(clear(map, x, z, 0.65));
  const state = createMovementState({ x, y: 0.65, z, vx: nx * 8.2, vz: nz * 8.2, onGround: false });
  run(map, state, 0.1, { forward: 1, yaw: yawOf(nx, nz) });
  const boundary = vertical ? lintel.x0 : lintel.z0;
  assert.ok((vertical ? state.x : state.z) <= boundary - MOVEMENT.radius + 1e-6);
  near(state.vx * nx + state.vz * nz, 0);
  near(state.y, 0.65 - 0.5 * 13 * 0.1 ** 2, 1e-6);
  assert.equal(state.headHit, false);
});

test('three-unit stamina sustains 19.5 seconds of sprint, then locks sprint until recovery', () => {
  const map = arena(), spot = openPatch(map);
  const state = createMovementState(spot), sprint = { forward: 1, sprint: true };
  run(map, state, 19, sprint);
  near(state.stamina, 3 - 19 / 6.5, 1e-6);
  assert.equal(state.exhausted, false);
  run(map, state, 0.5, sprint);
  near(state.stamina, 0);
  assert.equal(state.exhausted, true);
  assert.equal(state.sprint, false);
  run(map, state, 0.8);
  near(state.stamina, 0);
  run(map, state, 0.1);
  near(state.stamina, 0);
  run(map, state, 3.5);
  assert.equal(state.exhausted, true);
  stepMovement(map, state, sprint, STEP);
  assert.equal(state.sprint, false, 'a tiny refill cannot bypass the exhaustion latch');
  run(map, state, 0.2);
  stepMovement(map, state, sprint, STEP);
  assert.equal(state.exhausted, false);
  assert.equal(state.sprint, true);
  assert.ok(state.stamina >= 0 && state.stamina <= 3);
});

test('ground travel and successive jump timing remain stable across 30, 60, 120 and 144 FPS', () => {
  const map = arena(), spot = openPatch(map, 3);
  const rates = [30, 60, 120, 144];
  const travel = rates.map((fps) => run(map, createMovementState(spot), 0.5, { forward: 1, side: 1, sprint: true }, fps));
  const hops = rates.map((fps) => run(map, createMovementState(spot), 3, { jump: true }, fps));
  for (let i = 1; i < rates.length; i++) {
    for (const field of ['x', 'z', 'vx', 'vz', 'stamina']) near(travel[i][field], travel[0][field], 0.02);
    for (const field of ['y', 'vy', 'stamina']) near(hops[i][field], hops[0][field], 0.01);
    assert.equal(hops[i].hopCount, hops[0].hopCount);
    assert.equal(hops[i].onGround, hops[0].onGround);
  }
});

test('invalid deltas do not move the player, stalled frames are bounded and respawn clears motion timers', () => {
  const map = arena(), spot = openPatch(map, 3), input = { side: 1, jump: true };
  const state = createMovementState(spot);
  for (const dt of [NaN, Infinity, -Infinity, 0, -1]) stepMovement(map, state, input, dt);
  near(state.x, spot.x); near(state.y, 0); near(state.z, spot.z);
  const bounded = createMovementState(spot);
  stepMovement(map, state, input, 5);
  stepMovement(map, bounded, input, 0.25);
  assert.deepEqual(state, bounded);
  assert.ok(state.y > 0 && state.vy > 0);
  const identity = state;
  resetMovementState(state, spot);
  assert.equal(state, identity);
  stepMovement(map, state, IDLE, STEP);
  assert.equal(state.onGround, true);
  near(state.y, 0); near(state.vy, 0); near(speed(state), 0);
  near(state.stamina, STAMINA_MAX);
  assert.equal(state.jumpBuffer, 0);
  assert.equal(state.hopCount, 0);
});

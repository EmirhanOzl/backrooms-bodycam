// Predictable feet-position movement shared by the browser and headless consumers.
import { collide, groundHeight, ceilingHeight } from './map.js';
import { PLAYER_R } from './core.js';

export const STAMINA_MAX = 3;
export const MOVEMENT = Object.freeze({
  step: 1 / 120,
  maxFrameDt: 0.25,
  radius: PLAYER_R,
  standHeight: 1.82,
  crouchHeight: 1.27,
  walkSpeed: 3.3,
  sprintSpeed: 5.6,
  crouchSpeed: 1.8,
  maxSpeed: 8.2,
  groundAccel: 14,
  counterAccel: 24,
  groundFriction: 7.5,
  stopSpeed: 2.5,
  airAccel: 7,
  airWishCap: 2.5,
  gravity: 13,
  jumpHeight: 0.9,
  jumpSpeed: Math.sqrt(2 * 13 * 0.9),
  coyoteTime: 0.09,
  jumpBufferTime: 0.12,
  hopGrace: 0.08,
  jumpCost: 0.08,
  staminaDrain: 1 / 6.5,
  staminaRegen: 1 / 4,
  staminaDelay: 0.9,
  exhaustRecover: STAMINA_MAX * 0.3,
});

const EPS = 1e-7;
// Tangential side contact with a door is not a ceiling above the player's head.
const CLEARANCE_R = MOVEMENT.radius - 1e-6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback) => Number.isFinite(v) ? v : fallback;

export function createMovementState(initial = {}) {
  return resetMovementState({}, initial);
}

// Call on spawn/teleport, not every frame: the timers and jump latch are persistent.
export function resetMovementState(state, initial = {}) {
  state.x = finite(initial.x, 0);
  state.y = Math.max(0, finite(initial.y, 0));
  state.z = finite(initial.z, 0);
  state.vx = finite(initial.vx, 0);
  state.vz = finite(initial.vz, 0);
  state.vy = finite(initial.vy, 0);
  state.onGround = initial.onGround ?? (state.y === 0 && state.vy === 0);
  state.stamina = clamp(finite(initial.stamina, STAMINA_MAX), 0, STAMINA_MAX);
  state.exhausted = !!initial.exhausted || state.stamina === 0;
  state.regenDelay = 0;
  state.coyote = state.onGround ? MOVEMENT.coyoteTime : 0;
  state.jumpBuffer = 0;
  state.jumpHeld = false;
  state.groundTime = 0;
  state.hopCount = 0;
  state.crouch = !!initial.crouch;
  state.height = state.crouch ? MOVEMENT.crouchHeight : MOVEMENT.standHeight;
  state.sprint = false;
  state.jumped = false;
  state.landed = false;
  state.impactSpeed = 0;
  state.headHit = false;
  return state;
}

function canJump(state, held, ceiling) {
  return !state.crouch && !state.exhausted && state.stamina >= MOVEMENT.jumpCost
    && (held || state.jumpBuffer > 0)
    && ceiling - state.height - state.y > 0.02;
}

function launch(state) {
  state.vy = MOVEMENT.jumpSpeed;
  state.onGround = false;
  state.coyote = 0;
  state.jumpBuffer = 0;
  state.groundTime = 0;
  state.hopCount++;
  state.jumped = true;
  state.stamina = Math.max(0, state.stamina - MOVEMENT.jumpCost);
  state.regenDelay = MOVEMENT.staminaDelay;
  if (state.stamina <= EPS) { state.stamina = 0; state.exhausted = true; }
}

function accelerate(state, wx, wz, wishSpeed, dt) {
  let cap;
  if (state.onGround) {
    const speed = Math.hypot(state.vx, state.vz);
    const stop = wishSpeed > 0 ? Math.min(MOVEMENT.stopSpeed, wishSpeed) : MOVEMENT.stopSpeed;
    const next = Math.max(0, speed - Math.max(speed, stop) * MOVEMENT.groundFriction * dt);
    if (speed > EPS) { state.vx *= next / speed; state.vz *= next / speed; }
    // Keep legitimate landing momentum, but don't create extra speed by strafing on the floor.
    cap = Math.max(next, wishSpeed);
    const along = state.vx * wx + state.vz * wz;
    const gain = Math.min(Math.max(0, wishSpeed - along),
      (along < 0 ? MOVEMENT.counterAccel : MOVEMENT.groundAccel) * wishSpeed * dt);
    state.vx += wx * gain;
    state.vz += wz * gain;
  } else {
    cap = MOVEMENT.maxSpeed;
    // Projection-limited acceleration rewards turning the mouse into an air strafe;
    // holding forward alone cannot increase an already-fast forward velocity.
    const along = state.vx * wx + state.vz * wz;
    const gain = Math.min(Math.max(0, Math.min(wishSpeed, MOVEMENT.airWishCap) - along),
      MOVEMENT.airAccel * wishSpeed * dt);
    state.vx += wx * gain;
    state.vz += wz * gain;
  }
  cap = Math.min(cap, MOVEMENT.maxSpeed);
  const speed = Math.hypot(state.vx, state.vz);
  if (speed > cap && speed > EPS) { state.vx *= cap / speed; state.vz *= cap / speed; }
}

function moveVertical(map, state, oldY, oldVy, wasGround, ceiling, dt, held) {
  const floor = groundHeight(map, state.x, state.z, MOVEMENT.radius, oldY + EPS);
  state.y = oldY;
  if (wasGround && Math.abs(oldY - floor) <= EPS) {
    state.y = floor;
    state.vy = 0;
    state.onGround = true;
    state.coyote = MOVEMENT.coyoteTime;
    return;
  }
  state.onGround = false;
  if (wasGround) {
    state.vy = 0;
    state.coyote = Math.max(0, MOVEMENT.coyoteTime - dt);
    state.groundTime = 0;
  } else state.vy = oldVy;

  const limit = Math.max(0, ceiling - state.height);
  let remaining = dt;
  while (remaining > EPS) {
    let ceilingTime = Infinity;
    if (state.y > limit + EPS) ceilingTime = 0;
    else if (state.vy > 0) {
      const disc = state.vy * state.vy - 2 * MOVEMENT.gravity * Math.max(0, limit - state.y);
      if (disc >= 0) ceilingTime = (state.vy - Math.sqrt(disc)) / MOVEMENT.gravity;
    }
    const distance = Math.max(0, state.y - floor);
    const root = Math.sqrt(state.vy * state.vy + 2 * MOVEMENT.gravity * distance);
    const floorTime = state.vy < 0 ? 2 * distance / (root - state.vy) : (state.vy + root) / MOVEMENT.gravity;
    const time = Math.min(ceilingTime, floorTime);
    if (time > remaining + EPS) {
      state.y += state.vy * remaining - 0.5 * MOVEMENT.gravity * remaining * remaining;
      state.vy -= MOVEMENT.gravity * remaining;
      break;
    }
    const elapsed = clamp(time, 0, remaining);
    state.y += state.vy * elapsed - 0.5 * MOVEMENT.gravity * elapsed * elapsed;
    state.vy -= MOVEMENT.gravity * elapsed;
    remaining -= elapsed;
    if (ceilingTime < floorTime) {
      state.y = limit;
      state.vy = Math.min(0, state.vy);
      state.headHit = true;
    } else {
      state.y = floor;
      state.impactSpeed = Math.max(state.impactSpeed, -state.vy);
      state.vy = 0;
      state.onGround = true;
      state.coyote = MOVEMENT.coyoteTime;
      state.groundTime = remaining;
      state.landed = true;
      // Rebound at the actual impact time, without a ground-friction frame in between.
      if (canJump(state, held, ceiling)) launch(state);
      else break;
    }
  }
}

// input: forward/side [-1,1], yaw (0 faces -z), sprint/crouch/jump booleans,
// ads [0,1], moveMul (weapon/lean multiplier). No allocations occur in the substeps.
// jumped/landed/headHit and impactSpeed aggregate this call, then reset on the next call.
export function stepMovement(map, state, input, dt) {
  state.jumped = state.landed = state.headHit = false;
  state.impactSpeed = 0;
  if (!Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, MOVEMENT.maxFrameDt);
  const forward = clamp(finite(input.forward, 0), -1, 1);
  const side = clamp(finite(input.side, 0), -1, 1);
  const length = Math.hypot(forward, side);
  const magnitude = Math.min(1, length);
  const yaw = finite(input.yaw, 0), sy = Math.sin(yaw), cy = Math.cos(yaw);
  const wx = length > EPS ? (-sy * forward + cy * side) / length : 0;
  const wz = length > EPS ? (-cy * forward - sy * side) / length : 0;
  const ads = clamp(finite(input.ads, 0), 0, 1);
  const moveMul = Math.max(0, finite(input.moveMul, 1));
  const held = !!input.jump;
  if (held && !state.jumpHeld) state.jumpBuffer = MOVEMENT.jumpBufferTime;
  state.jumpHeld = held;
  const steps = Math.max(1, Math.ceil(dt / MOVEMENT.step));
  const h = dt / steps;

  for (let i = 0; i < steps; i++) {
    const ceiling = ceilingHeight(map, state.x, state.z, CLEARANCE_R);
    // Releasing crouch cannot stand a head through a lintel while airborne.
    state.crouch = !!input.crouch || (state.crouch && state.y + MOVEMENT.standHeight > ceiling + EPS);
    state.height = state.crouch ? MOVEMENT.crouchHeight : MOVEMENT.standHeight;
    if (state.crouch) { state.hopCount = 0; state.jumpBuffer = 0; }
    if (state.onGround) {
      const floor = groundHeight(map, state.x, state.z, MOVEMENT.radius, state.y + EPS);
      if (Math.abs(state.y - floor) > EPS || state.vy > EPS) {
        state.onGround = false;
        state.coyote = state.vy > EPS ? 0 : MOVEMENT.coyoteTime;
        state.groundTime = 0;
      } else { state.y = floor; state.vy = 0; }
    }
    if (state.exhausted && state.stamina >= MOVEMENT.exhaustRecover) state.exhausted = false;
    if ((state.onGround || state.coyote > 0) && canJump(state, held, ceiling)) launch(state);
    const wantsSprint = !!input.sprint && forward > 0 && !state.crouch && ads < 0.3 && !state.exhausted;
    const sprinting = wantsSprint && state.onGround;
    const wishSpeed = (state.crouch ? MOVEMENT.crouchSpeed : wantsSprint ? MOVEMENT.sprintSpeed : MOVEMENT.walkSpeed)
      * moveMul * (1 - ads * 0.35) * magnitude;
    accelerate(state, wx, wz, wishSpeed, h);
    if (state.onGround) {
      state.groundTime += h;
      if (state.groundTime > MOVEMENT.hopGrace) state.hopCount = 0;
    } else {
      state.groundTime = 0;
      state.coyote = Math.max(0, state.coyote - h);
    }

    const oldY = state.y, oldVy = state.vy, wasGround = state.onGround;
    const nextY = wasGround ? oldY : oldY + oldVy * h - 0.5 * MOVEMENT.gravity * h * h;
    // Ascending feet can clear a crate; descending feet still collide with its top before its side.
    state.y = Math.max(oldY, Math.min(nextY, ceiling - state.height));
    const targetX = state.x + state.vx * h, targetZ = state.z + state.vz * h;
    state.x = targetX; state.z = targetZ;
    collide(map, state, MOVEMENT.radius);
    const correctionX = state.x - targetX, correctionZ = state.z - targetZ;
    const correction = Math.hypot(correctionX, correctionZ);
    if (correction > EPS) {
      const nx = correctionX / correction, nz = correctionZ / correction;
      const into = state.vx * nx + state.vz * nz;
      if (into < 0) { state.vx -= into * nx; state.vz -= into * nz; }
    }
    const endCeiling = ceilingHeight(map, state.x, state.z, CLEARANCE_R);
    moveVertical(map, state, oldY, oldVy, wasGround, Math.min(ceiling, endCeiling), h, held);

    if (sprinting) {
      state.stamina = Math.max(0, state.stamina - MOVEMENT.staminaDrain * h);
      state.regenDelay = MOVEMENT.staminaDelay;
    } else {
      const recoveryTime = Math.max(0, h - state.regenDelay);
      state.regenDelay = Math.max(0, state.regenDelay - h);
      state.stamina = Math.min(STAMINA_MAX, state.stamina + MOVEMENT.staminaRegen * recoveryTime);
    }
    if (state.stamina <= EPS) { state.stamina = 0; state.exhausted = true; }
    state.sprint = wantsSprint && state.onGround && !state.exhausted;
    state.jumpBuffer = Math.max(0, state.jumpBuffer - h);
  }
}

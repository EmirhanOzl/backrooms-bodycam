// Deterministic grenade physics shared by the server (authoritative explosion) and the client (visuals).
// Both sides advance with the same fixed step from the same launch state, so they stay in lock-step.
import { CEIL, raycast, hitNormal } from './map.js';

export const NADE_STEP = 1 / 60;
export const NADE_R = 0.05;
const G = 9.8;

export function makeNade(o, v) {
  return { x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], rest: false, bounce: 0 };
}

// Advances one fixed step. Sets g.bounce to the impact speed of any collision this step (0 if none).
export function stepNade(map, g) {
  const dt = NADE_STEP;
  g.bounce = 0;
  if (g.rest) return g;
  g.vy -= G * dt;
  let nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
  const dx = nx - g.x, dz = nz - g.z, d = Math.hypot(dx, dz);
  if (d > 1e-7) {
    const ux = dx / d, uz = dz / d;
    const t = raycast(map, g.x, g.z, ux, uz, d + NADE_R);
    if (t < 1e-6) {
      // started inside geometry (should not happen): back out the way it came
      g.vx = -g.vx * 0.5; g.vz = -g.vz * 0.5; nx = g.x; nz = g.z;
    } else if (t < d + NADE_R) {
      const n0 = hitNormal[0], n1 = hitNormal[1];
      const vn = g.vx * n0 + g.vz * n1;
      if (vn < 0) {
        g.bounce = Math.max(g.bounce, -vn);
        g.vx -= 1.55 * vn * n0; g.vz -= 1.55 * vn * n1; // restitution 0.55 along the normal
        g.vx *= 0.82; g.vz *= 0.82; g.vy *= 0.9;         // tangential friction
      }
      const tt = Math.max(0, t - NADE_R);
      nx = g.x + ux * tt; nz = g.z + uz * tt;
    }
  }
  if (ny < NADE_R) {
    ny = NADE_R;
    if (g.vy < 0) {
      if (g.vy < -1.2) g.bounce = Math.max(g.bounce, -g.vy);
      g.vy = -g.vy * 0.32;
      if (g.vy < 0.5) g.vy = 0;
      g.vx *= 0.72; g.vz *= 0.72;
    }
  } else if (ny > CEIL - NADE_R) {
    ny = CEIL - NADE_R;
    if (g.vy > 0) { g.bounce = Math.max(g.bounce, g.vy); g.vy = -g.vy * 0.4; }
  }
  if (ny <= NADE_R + 1e-4 && g.vy === 0) {
    const f = Math.exp(-2.6 * dt); // carpet rolling friction
    g.vx *= f; g.vz *= f;
    if (g.vx * g.vx + g.vz * g.vz < 0.01) { g.vx = g.vz = 0; g.rest = true; }
  }
  g.x = nx; g.y = ny; g.z = nz;
  return g;
}

// Throw velocity from a view direction (unit vector) and the thrower's velocity.
export function throwVelocity(dir, speed, carry = [0, 0]) {
  return [dir[0] * speed + carry[0] * 0.5, dir[1] * speed + 2.2, dir[2] * speed + carry[1] * 0.5];
}

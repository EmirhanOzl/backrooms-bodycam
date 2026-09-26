// Shared (server + client) Backrooms Level 0 map: generation, raycasting, collision, pathfinding.
export const CELL = 4;          // meters per grid cell
export const CEIL = 2.9;        // ceiling height
export const WALL_T = 0.22;     // wall thickness
export const PILLAR = 0.5;      // pillar width
export const DOOR_W = 1.35;     // doorway width
export const DOOR_H = 2.15;     // doorway height
export const CRATE_W = 0.56, CRATE_D = 0.42, CRATE_H = 0.4;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Edge arrays: h[z*W + x] = wall on the z-boundary above cell (x,z) (z in 0..H)
//              v[z*(W+1) + x] = wall on the x-boundary left of cell (x,z) (x in 0..W)
// 0 = open, 1 = solid wall, 2 = wall with doorway
export function generateMap(seed, size = 18) {
  const R = mulberry32(seed);
  const W = size, H = size;
  const h = new Uint8Array(W * (H + 1)).fill(1);
  const v = new Uint8Array((W + 1) * H).fill(1);

  // 1) perfect maze (recursive backtracker)
  const seen = new Uint8Array(W * H);
  const sx = (R() * W) | 0, sz = (R() * H) | 0;
  const stack = [[sx, sz]];
  seen[sz * W + sx] = 1;
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const n = [];
    if (x > 0 && !seen[z * W + x - 1]) n.push([x - 1, z, v, z * (W + 1) + x]);
    if (x < W - 1 && !seen[z * W + x + 1]) n.push([x + 1, z, v, z * (W + 1) + x + 1]);
    if (z > 0 && !seen[(z - 1) * W + x]) n.push([x, z - 1, h, z * W + x]);
    if (z < H - 1 && !seen[(z + 1) * W + x]) n.push([x, z + 1, h, (z + 1) * W + x]);
    if (!n.length) { stack.pop(); continue; }
    const c = n[(R() * n.length) | 0];
    c[2][c[3]] = 0;
    seen[c[1] * W + c[0]] = 1;
    stack.push([c[0], c[1]]);
  }

  // 2) open it up: Level 0 is a loopy, semi-open labyrinth
  for (let z = 1; z < H; z++) for (let x = 0; x < W; x++) if (h[z * W + x] && R() < 0.42) h[z * W + x] = 0;
  for (let z = 0; z < H; z++) for (let x = 1; x < W; x++) if (v[z * (W + 1) + x] && R() < 0.42) v[z * (W + 1) + x] = 0;

  // 3) a few big open halls
  const halls = 3 + ((R() * 3) | 0);
  for (let i = 0; i < halls; i++) {
    const rw = 2 + ((R() * 2) | 0), rh = 2 + ((R() * 2) | 0);
    const rx = (R() * (W - rw)) | 0, rz = (R() * (H - rh)) | 0;
    for (let z = rz; z < rz + rh; z++) for (let x = rx; x < rx + rw; x++) {
      if (x > rx) v[z * (W + 1) + x] = 0;
      if (z > rz) h[z * W + x] = 0;
    }
  }

  // 4) doorways in remaining interior walls
  for (let z = 1; z < H; z++) for (let x = 0; x < W; x++) if (h[z * W + x] === 1 && R() < 0.26) h[z * W + x] = 2;
  for (let z = 0; z < H; z++) for (let x = 1; x < W; x++) if (v[z * (W + 1) + x] === 1 && R() < 0.26) v[z * (W + 1) + x] = 2;

  const hAt = (x, z) => (x < 0 || x >= W || z < 0 || z > H ? 0 : h[z * W + x]);
  const vAt = (x, z) => (x < 0 || x > W || z < 0 || z >= H ? 0 : v[z * (W + 1) + x]);
  const hCorner = (cx, cz) => hAt(cx - 1, cz) || hAt(cx, cz); // any h-wall touching grid corner
  const vCorner = (cx, cz) => vAt(cx, cz - 1) || vAt(cx, cz);

  // 5) build solid boxes (2D AABBs, full height) + lintels (visual)
  const boxes = [];   // {x0,z0,x1,z1,kind,capA,capB} kind 0=h-wall 1=v-wall 2=pillar
  const lintels = []; // {x0,z0,x1,z1}
  const T = WALL_T / 2, gap0 = (CELL - DOOR_W) / 2, gap1 = (CELL + DOOR_W) / 2;
  // horizontal walls (run along x)
  for (let z = 0; z <= H; z++) {
    let x = 0;
    while (x < W) {
      const t = h[z * W + x];
      if (t === 1) {
        let e = x; while (e + 1 < W && h[z * W + e + 1] === 1) e++;
        boxes.push({ x0: x * CELL - T, x1: (e + 1) * CELL + T, z0: z * CELL - T, z1: z * CELL + T, kind: 0, capA: 1, capB: 1 });
        x = e + 1;
      } else {
        if (t === 2) {
          const b = x * CELL;
          boxes.push({ x0: b - T, x1: b + gap0, z0: z * CELL - T, z1: z * CELL + T, kind: 0, capA: 1, capB: 1 });
          boxes.push({ x0: b + gap1, x1: b + CELL + T, z0: z * CELL - T, z1: z * CELL + T, kind: 0, capA: 1, capB: 1 });
          lintels.push({ x0: b + gap0, x1: b + gap1, z0: z * CELL - T, z1: z * CELL + T });
        }
        x++;
      }
    }
  }
  // vertical walls (run along z); h-walls own the corners
  for (let x = 0; x <= W; x++) {
    let z = 0;
    while (z < H) {
      const t = v[z * (W + 1) + x];
      if (t === 1) {
        let e = z; while (e + 1 < H && v[(e + 1) * (W + 1) + x] === 1) e++;
        const a = hCorner(x, z), b = hCorner(x, e + 1);
        boxes.push({ x0: x * CELL - T, x1: x * CELL + T, z0: z * CELL + (a ? T : -T), z1: (e + 1) * CELL + (b ? -T : T), kind: 1, capA: a ? 0 : 1, capB: b ? 0 : 1 });
        z = e + 1;
      } else {
        if (t === 2) {
          const b0 = z * CELL, a = hCorner(x, z), b = hCorner(x, z + 1);
          boxes.push({ x0: x * CELL - T, x1: x * CELL + T, z0: b0 + (a ? T : -T), z1: b0 + gap0, kind: 1, capA: a ? 0 : 1, capB: 1 });
          boxes.push({ x0: x * CELL - T, x1: x * CELL + T, z0: b0 + gap1, z1: b0 + CELL + (b ? -T : T), kind: 1, capA: 1, capB: b ? 0 : 1 });
          lintels.push({ x0: x * CELL - T, x1: x * CELL + T, z0: b0 + gap0, z1: b0 + gap1 });
        }
        z++;
      }
    }
  }
  // pillars at fully open interior corners
  const pillarCorners = new Set();
  for (let z = 1; z < H; z++) for (let x = 1; x < W; x++) {
    if (!hCorner(x, z) && !vCorner(x, z) && R() < 0.3) {
      const P = PILLAR / 2;
      boxes.push({ x0: x * CELL - P, x1: x * CELL + P, z0: z * CELL - P, z1: z * CELL + P, kind: 2, capA: 1, capB: 1 });
      pillarCorners.add(z * (W + 1) + x);
    }
  }

  // 6) spatial grid (cell -> box indices)
  const grid = new Array(W * H);
  for (let i = 0; i < grid.length; i++) grid[i] = [];
  boxes.forEach((b, i) => {
    const cx0 = Math.max(0, Math.floor(b.x0 / CELL)), cx1 = Math.min(W - 1, Math.floor(b.x1 / CELL));
    const cz0 = Math.max(0, Math.floor(b.z0 / CELL)), cz1 = Math.min(H - 1, Math.floor(b.z1 / CELL));
    for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) grid[z * W + x].push(i);
  });

  // 7) ceiling fixtures: one troffer per cell; broken + flickering ones; a few blackout zones
  const fixtures = [];
  const dark = [];
  for (let i = 0; i < 3; i++) dark.push([R() * W, R() * H, 1.3 + R() * 1.2]);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    let state = 0; // 0 on, 1 off, 2 flicker
    const r = R();
    if (r < 0.05) state = 1; else if (r < 0.1) state = 2;
    for (const d of dark) if (Math.hypot(x + 0.5 - d[0], z + 0.5 - d[1]) < d[2] && R() < 0.85) state = 1;
    fixtures.push({ x: (x + 0.5) * CELL, z: (z + 0.5) * CELL, state, rot: (x + z) & 1 });
  }

  // 8) loot crates in cell corners (never blocking doorways or center paths)
  const crates = [];
  const cellCrate = new Int16Array(W * H).fill(-1);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (R() > 0.24) continue;
    const qx = R() < 0.5 ? 0 : 1, qz = R() < 0.5 ? 0 : 1;
    const ox = qx ? CELL - 0.72 : 0.72, oz = qz ? CELL - 0.72 : 0.72;
    const id = crates.length;
    crates.push({ id, x: x * CELL + ox, z: z * CELL + oz, rot: (R() - 0.5) * 0.35 + ((R() * 4) | 0) * (Math.PI / 2) });
    cellCrate[z * W + x] = id;
  }

  const map = {
    seed, W, H, h, v, boxes, lintels, grid, fixtures, crates, cellCrate, pillarCorners,
    size: W * CELL, stamp: new Uint32Array(boxes.length), stampId: 0,
  };
  return map;
}

// --- Raycasting (2D, walls are full height) --------------------------------
export const hitNormal = [0, 0];

function rayBox(b, ox, oz, dx, dz, idx, idz) {
  let tmin = -Infinity, tmax = Infinity, nx = 0, nz = 0;
  if (dx !== 0) {
    let t1 = (b.x0 - ox) * idx, t2 = (b.x1 - ox) * idx;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) { tmin = t1; nx = dx > 0 ? -1 : 1; nz = 0; }
    if (t2 < tmax) tmax = t2;
  } else if (ox < b.x0 || ox > b.x1) return Infinity;
  if (dz !== 0) {
    let t1 = (b.z0 - oz) * idz, t2 = (b.z1 - oz) * idz;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) { tmin = t1; nz = dz > 0 ? -1 : 1; nx = 0; }
    if (t2 < tmax) tmax = t2;
  } else if (oz < b.z0 || oz > b.z1) return Infinity;
  if (tmax < 0 || tmin > tmax) return Infinity;
  if (tmin < 0) return 0;
  rayBox.nx = nx; rayBox.nz = nz;
  return tmin;
}

// dx,dz must be normalized in 2D. Returns distance to first wall (<= maxD). Sets hitNormal.
export function raycast(map, ox, oz, dx, dz, maxD = 1e4) {
  const W = map.W, H = map.H;
  let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const idx = dx !== 0 ? 1 / dx : 0, idz = dz !== 0 ? 1 / dz : 0;
  const tdx = dx !== 0 ? Math.abs(CELL * idx) : Infinity, tdz = dz !== 0 ? Math.abs(CELL * idz) : Infinity;
  let tmx = dx > 0 ? ((cx + 1) * CELL - ox) * idx : dx < 0 ? (cx * CELL - ox) * idx : Infinity;
  let tmz = dz > 0 ? ((cz + 1) * CELL - oz) * idz : dz < 0 ? (cz * CELL - oz) * idz : Infinity;
  let best = maxD;
  const stamp = ++map.stampId, st = map.stamp, boxes = map.boxes;
  if (stamp > 4e9) { st.fill(0); map.stampId = 1; }
  for (let guard = 0; guard < 256; guard++) {
    if (cx >= 0 && cx < W && cz >= 0 && cz < H) {
      const list = map.grid[cz * W + cx];
      for (let i = 0; i < list.length; i++) {
        const bi = list[i];
        if (st[bi] === stamp) continue;
        st[bi] = stamp;
        const t = rayBox(boxes[bi], ox, oz, dx, dz, idx, idz);
        if (t < best) { best = t; hitNormal[0] = rayBox.nx; hitNormal[1] = rayBox.nz; }
      }
    } else if (cx < -1 || cz < -1 || cx > W || cz > H) break;
    const tn = tmx < tmz ? tmx : tmz;
    if (best <= tn || tn > maxD) break;
    if (tmx < tmz) { tmx += tdx; cx += stepX; } else { tmz += tdz; cz += stepZ; }
  }
  return best;
}

export function lineOfSight(map, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
  if (d < 1e-4) return true;
  return raycast(map, ax, az, dx / d, dz / d, d) >= d - 1e-3;
}

// --- Collision: circle vs wall boxes + crates ------------------------------
export function collide(map, p, r) {
  const W = map.W, H = map.H;
  for (let it = 0; it < 3; it++) {
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    let moved = false;
    for (let z = cz - 1; z <= cz + 1; z++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || z < 0 || x >= W || z >= H) continue;
      const list = map.grid[z * W + x];
      for (let i = 0; i < list.length; i++) moved = pushOut(map.boxes[list[i]], p, r) || moved;
      const ci = map.cellCrate[z * W + x];
      if (ci >= 0) {
        const c = map.crates[ci], e = 0.3;
        moved = pushOut({ x0: c.x - e, x1: c.x + e, z0: c.z - e, z1: c.z + e }, p, r) || moved;
      }
    }
    if (!moved) break;
  }
  const lim = map.W * CELL;
  p.x = Math.min(lim - r, Math.max(r, p.x));
  p.z = Math.min(lim - r, Math.max(r, p.z));
  return p;
}

function pushOut(b, p, r) {
  const qx = p.x < b.x0 ? b.x0 : p.x > b.x1 ? b.x1 : p.x;
  const qz = p.z < b.z0 ? b.z0 : p.z > b.z1 ? b.z1 : p.z;
  const dx = p.x - qx, dz = p.z - qz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2), k = (r - d) / d;
    p.x += dx * k; p.z += dz * k;
  } else {
    const l = p.x - b.x0, rr = b.x1 - p.x, t = p.z - b.z0, bb = b.z1 - p.z, m = Math.min(l, rr, t, bb);
    if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === t) p.z = b.z0 - r; else p.z = b.z1 + r;
  }
  return true;
}

// --- Navigation -------------------------------------------------------------
export function passable(map, cx, cz, dir) {
  const W = map.W, H = map.H;
  switch (dir) {
    case 0: return cx < W - 1 && map.v[cz * (W + 1) + cx + 1] !== 1;
    case 1: return cx > 0 && map.v[cz * (W + 1) + cx] !== 1;
    case 2: return cz < H - 1 && map.h[(cz + 1) * W + cx] !== 1;
    default: return cz > 0 && map.h[cz * W + cx] !== 1;
  }
}
const DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1];

export function findPath(map, from, to) {
  const W = map.W, N = W * map.H;
  if (from === to) return [to];
  const prev = new Int32Array(N).fill(-1);
  prev[from] = from;
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  q[qt++] = from;
  while (qh < qt) {
    const c = q[qh++];
    if (c === to) break;
    const cx = c % W, cz = (c / W) | 0;
    for (let d = 0; d < 4; d++) {
      if (!passable(map, cx, cz, d)) continue;
      const n = (cz + DZ[d]) * W + cx + DX[d];
      if (prev[n] !== -1) continue;
      prev[n] = c;
      q[qt++] = n;
    }
  }
  if (prev[to] === -1) return null;
  const path = [];
  for (let c = to; c !== from; c = prev[c]) path.push(c);
  return path.reverse();
}

export const cellIndex = (map, x, z) =>
  Math.min(map.H - 1, Math.max(0, Math.floor(z / CELL))) * map.W + Math.min(map.W - 1, Math.max(0, Math.floor(x / CELL)));
export const cellCenter = (map, i) => [((i % map.W) + 0.5) * CELL, (((i / map.W) | 0) + 0.5) * CELL];

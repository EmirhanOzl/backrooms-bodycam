// Shared (server + client) Backrooms Level 0 map: generation, raycasting, collision, pathfinding.
export const CELL = 4;          // meters per grid cell
export const CEIL = 2.9;        // ceiling height
export const WALL_T = 0.22;     // wall thickness
export const PILLAR = 0.5;      // pillar width
export const DOOR_W = 1.35;     // doorway width
export const DOOR_H = 2.15;     // doorway height
export const CRATE_W = 0.56, CRATE_D = 0.42, CRATE_H = 0.4;
export const VENDOR_W = 0.9, VENDOR_D = 0.66, VENDOR_H = 1.9; // almond-water vending machine

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
// light: 'normal' | 'dim' | 'dark' (how many troffers are dead or flickering)
export const LIGHT_PRESETS = {
  normal: { off: 0.05, flicker: 0.05, zones: 3, zr: [1.3, 1.2] },
  dim: { off: 0.28, flicker: 0.1, zones: 5, zr: [1.8, 1.8] },
  dark: { off: 0.8, flicker: 0.1, zones: 7, zr: [2.2, 2.2] },
};
function openEdge(W, h, v, a, b, value = 0) {
  const ax = a % W, az = (a / W) | 0, bx = b % W, bz = (b / W) | 0;
  if (az === bz) v[az * (W + 1) + Math.max(ax, bx)] = value;
  else h[Math.max(az, bz) * W + ax] = value;
}

function carveMaze(W, H, h, v, R, blocked = null, loops = 0.42, doors = 0.26) {
  const N = W * H, seen = new Uint8Array(N), stack = new Int32Array(N), choices = new Int32Array(4);
  let first = (R() * N) | 0;
  while (blocked?.[first]) first = (first + 1) % N;
  let top = 0;
  stack[top++] = first; seen[first] = 1;
  while (top) {
    const c = stack[top - 1], x = c % W, z = (c / W) | 0;
    let n = 0;
    if (x > 0 && !seen[c - 1] && !blocked?.[c - 1]) choices[n++] = c - 1;
    if (x < W - 1 && !seen[c + 1] && !blocked?.[c + 1]) choices[n++] = c + 1;
    if (z > 0 && !seen[c - W] && !blocked?.[c - W]) choices[n++] = c - W;
    if (z < H - 1 && !seen[c + W] && !blocked?.[c + W]) choices[n++] = c + W;
    if (!n) { top--; continue; }
    const next = choices[(R() * n) | 0];
    openEdge(W, h, v, c, next); seen[next] = 1; stack[top++] = next;
  }
  for (let z = 1; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x;
    if (!blocked?.[i] && !blocked?.[i - W] && h[i] && R() < loops) h[i] = 0;
  }
  for (let z = 0; z < H; z++) for (let x = 1; x < W; x++) {
    const i = z * W + x, e = z * (W + 1) + x;
    if (!blocked?.[i] && !blocked?.[i - 1] && v[e] && R() < loops) v[e] = 0;
  }
  for (let z = 1; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x;
    if (!blocked?.[i] && !blocked?.[i - W] && h[i] === 1 && R() < doors) h[i] = 2;
  }
  for (let z = 0; z < H; z++) for (let x = 1; x < W; x++) {
    const i = z * W + x, e = z * (W + 1) + x;
    if (!blocked?.[i] && !blocked?.[i - 1] && v[e] === 1 && R() < doors) v[e] = 2;
  }
}

function escapeLayout(W, H, h, v, R, safeMask, safeZones) {
  // A winding, bounded route across the level, with a much larger branching
  // labyrinth around it. Rest rooms never consume any part of this dark route.
  const route = [W + 1], routeMask = new Uint8Array(W * H);
  let x = 1, z = 1;
  routeMask[W + 1] = 1;
  while (x < W - 2 || z < H - 2) {
    const alongX = z === H - 2 || (x < W - 2 && (x < z - 5 || (x <= z + 5 && R() < 0.5)));
    const steps = Math.min(3 + ((R() * 5) | 0), alongX ? W - 2 - x : H - 2 - z);
    for (let s = 0; s < steps; s++) {
      if (alongX) x++; else z++;
      const cell = z * W + x;
      route.push(cell); routeMask[cell] = 1;
    }
  }
  const blocked = new Uint8Array(W * H);
  for (let milestone = 1; milestone <= 10; milestone++) {
    const anchor = route[Math.round((route.length - 1) * milestone / 11)];
    const ax = anchor % W, az = (anchor / W) | 0;
    let rx = -1, rz = -1, score = Infinity;
    for (let cz = 2; cz < H - 3; cz++) for (let cx = 2; cx < W - 3; cx++) {
      if (routeMask[cz * W + cx] || routeMask[cz * W + cx + 1] ||
          routeMask[(cz + 1) * W + cx] || routeMask[(cz + 1) * W + cx + 1]) continue;
      if (safeZones.some((s) => cx < s.cx + 4 && cx + 4 > s.cx && cz < s.cz + 4 && cz + 4 > s.cz)) continue;
      const d = (cx + 0.5 - ax) ** 2 + (cz + 0.5 - az) ** 2 + R() * 0.2;
      if (d < score) { score = d; rx = cx; rz = cz; }
    }
    const id = safeZones.length, cells = [rz * W + rx, rz * W + rx + 1, (rz + 1) * W + rx, (rz + 1) * W + rx + 1];
    for (const c of cells) { safeMask[c] = id; blocked[c] = 1; }
    const x0 = rx * CELL, z0 = rz * CELL;
    safeZones.push({
      id, cx: rx, cz: rz, x: x0 + CELL, z: z0 + CELL, cell: cells[3], cells,
      x0, z0, x1: x0 + CELL * 2, z1: z0 + CELL * 2,
      label: `SIĞINAK ${String(id + 1).padStart(2, '0')}`, milestone: anchor,
      board: { x: x0 + CELL * 0.62, z: z0 + WALL_T / 2 + 0.055, nx: 0, nz: 1 },
      bench: { x: x0 + CELL * 1.48, z: z0 + 0.62, rot: 0 },
    });
  }
  // Disjoint interior alcoves leave the underlying dark grid connected.
  // Generate the spanning maze around them, rather than hoping that removing
  // a lit cell from an already-generated maze preserves monster navigation.
  carveMaze(W, H, h, v, R, blocked, 0.14, 0.09);
  for (let i = 1; i < route.length; i++) openEdge(W, h, v, route[i - 1], route[i]);
  const linkPrev = new Int32Array(W * H), linkQueue = new Int32Array(W * H);
  for (const s of safeZones) {
    const { cx, cz } = s;
    for (let j = cz; j < cz + 2; j++) v[j * (W + 1) + cx + 1] = 0;
    for (let i = cx; i < cx + 2; i++) h[(cz + 1) * W + i] = 0;
    // A complete dark ring bypasses each room, with two independent entrances.
    for (let i = cx - 1; i < cx + 2; i++) {
      v[(cz - 1) * (W + 1) + i + 1] = 0;
      v[(cz + 2) * (W + 1) + i + 1] = 0;
    }
    for (let j = cz - 1; j < cz + 2; j++) {
      h[(j + 1) * W + cx - 1] = 0;
      h[(j + 1) * W + cx + 2] = 0;
    }
    h[(cz + 2) * W + cx] = 2;
    v[cz * (W + 1) + cx + 2] = 2;
    // A short branch from the milestone makes the refuge an actual rest stop,
    // not a nearby room accessible only through a long random maze detour.
    const target = (cz + 2) * W + cx;
    linkPrev.fill(-1); linkPrev[s.milestone] = s.milestone;
    let qh = 0, qt = 0; linkQueue[qt++] = s.milestone;
    while (qh < qt && linkPrev[target] < 0) {
      const c = linkQueue[qh++], x = c % W, z = (c / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], nz = z + DZ[d];
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const n = nz * W + nx;
        if (blocked[n] || linkPrev[n] >= 0) continue;
        linkPrev[n] = c; linkQueue[qt++] = n;
      }
    }
    for (let c = target; c !== s.milestone; c = linkPrev[c]) openEdge(W, h, v, c, linkPrev[c]);
  }
  return route;
}

function arenaLayout(W, H, h, v) {
  for (let z = 1; z < H; z++) for (let x = 0; x < W; x++) h[z * W + x] = 0;
  for (let z = 0; z < H; z++) for (let x = 1; x < W; x++) v[z * (W + 1) + x] = 0;
  // Two open flank lanes and a broad central depot. Spawn screens prevent
  // cross-map spawn fire; their ends open directly onto both flank routes.
  for (const x of [2, 8]) for (let z = 2; z < 7; z++) v[z * (W + 1) + x] = 1;
  for (const z of [3, 7]) for (let x = 2; x < 8; x++) if (x !== 3 && x !== 6) h[z * W + x] = 1;
  for (const x of [4, 6]) for (let z = 4; z < 6; z++) v[z * (W + 1) + x] = 1;
}

export function generateMap(seed, size = 18, light = 'normal', layout = 'maze') {
  layout = ['maze', 'arena', 'escape'].includes(layout) ? layout : 'maze';
  if (layout === 'escape') light = 'dark';
  const LP = LIGHT_PRESETS[light] || LIGHT_PRESETS.normal;
  const R = mulberry32(seed);
  const W = layout === 'arena' ? 10 : layout === 'escape' ? 44 : size, H = W;
  const h = new Uint8Array(W * (H + 1)).fill(1);
  const v = new Uint8Array((W + 1) * H).fill(1);
  const safeZones = [], safeMask = new Int16Array(W * H).fill(-1);
  let escapeRoute = null;
  if (layout === 'arena') arenaLayout(W, H, h, v);
  else if (layout === 'escape') escapeRoute = escapeLayout(W, H, h, v, R, safeMask, safeZones);
  else {
    carveMaze(W, H, h, v, R);
    const halls = 3 + ((R() * 3) | 0);
    for (let i = 0; i < halls; i++) {
      const rw = 2 + ((R() * 2) | 0), rh = 2 + ((R() * 2) | 0);
      const rx = (R() * (W - rw)) | 0, rz = (R() * (H - rh)) | 0;
      for (let z = rz; z < rz + rh; z++) for (let x = rx; x < rx + rw; x++) {
        if (x > rx) v[z * (W + 1) + x] = 0;
        if (z > rz) h[z * W + x] = 0;
      }
    }
  }

  const hAt = (x, z) => (x < 0 || x >= W || z < 0 || z > H ? 0 : h[z * W + x]);
  const vAt = (x, z) => (x < 0 || x > W || z < 0 || z >= H ? 0 : v[z * (W + 1) + x]);
  const hCorner = (cx, cz) => hAt(cx - 1, cz) || hAt(cx, cz); // any h-wall touching grid corner
  const vCorner = (cx, cz) => vAt(cx, cz - 1) || vAt(cx, cz);

  // Solid boxes retain the shared grid/raycast contract for every layout.
  const boxes = [];   // kind 0=h-wall 1=v-wall 2=pillar 3=vendor 4=industrial cover
  const lintels = []; // door undersides at DOOR_H
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
    if (layout !== 'arena' && safeMask[z * W + x] < 0 && safeMask[(z - 1) * W + x - 1] < 0 &&
        !hCorner(x, z) && !vCorner(x, z) && R() < 0.3) {
      const P = PILLAR / 2;
      boxes.push({ x0: x * CELL - P, x1: x * CELL + P, z0: z * CELL - P, z1: z * CELL + P, kind: 2, capA: 1, capB: 1 });
      pillarCorners.add(z * (W + 1) + x);
    }
  }
  if (layout === 'arena') {
    for (const x of [4 * CELL, 6 * CELL]) boxes.push({
      x0: x - 1, x1: x + 1, z0: 4 * CELL, z1: 6 * CELL, kind: 4, style: 'container',
    });
    for (const x of [3 * CELL, 5 * CELL, 7 * CELL]) for (const z of [CELL, 9 * CELL]) boxes.push({
      x0: x - 0.85, x1: x + 0.85, z0: z - 0.85, z1: z + 0.85, kind: 4, style: 'barrier',
    });
  }

  // 6) spatial grid (cell -> box indices)
  const grid = new Array(W * H);
  for (let i = 0; i < grid.length; i++) grid[i] = [];
  boxes.forEach((b, i) => {
    const cx0 = Math.max(0, Math.floor(b.x0 / CELL)), cx1 = Math.min(W - 1, Math.floor(b.x1 / CELL));
    const cz0 = Math.max(0, Math.floor(b.z0 / CELL)), cz1 = Math.min(H - 1, Math.floor(b.z1 / CELL));
    for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) grid[z * W + x].push(i);
  });

  // Keep cell-indexed fixtures for bounded nearby-light queries. Escape only
  // powers sanctuary fixtures: red emergency markers are emissive, not lights.
  const fixtures = [], dark = [];
  if (layout === 'maze') for (let i = 0; i < LP.zones; i++) dark.push([R() * W, R() * H, LP.zr[0] + R() * LP.zr[1]]);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const cell = z * W + x;
    let state = 0, emergency = false;
    if (layout === 'escape') {
      state = safeMask[cell] >= 0 ? 0 : 1;
      emergency = state === 1 && R() < 0.006;
    } else if (layout === 'maze') {
      const r = R();
      if (r < LP.off) state = 1; else if (r < LP.off + LP.flicker) state = 2;
      for (const d of dark) if (Math.hypot(x + 0.5 - d[0], z + 0.5 - d[1]) < d[2] && R() < 0.85) state = 1;
    } else if (light !== 'normal') {
      // Optional low-light depot sessions preserve equal lighting for teams.
      if (x >= W / 2) state = fixtures[z * W + W - 1 - x].state;
      else {
        const r = R();
        if (r < LP.off) state = 1; else if (r < LP.off + LP.flicker) state = 2;
      }
    }
    fixtures.push({
      x: (x + 0.5) * CELL, z: (z + 0.5) * CELL, state, rot: (x + z) & 1, emergency,
      visible: layout !== 'escape' || state !== 1 || emergency || (x * 13 + z * 7) % 9 === 0,
    });
  }

  const cellLight = new Float32Array(W * H);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (layout === 'escape') { cellLight[z * W + x] = safeMask[z * W + x] >= 0 ? 1 : 0; continue; }
    let L = 0;
    for (let j = Math.max(0, z - 2); j <= Math.min(H - 1, z + 2); j++) for (let i = Math.max(0, x - 2); i <= Math.min(W - 1, x + 2); i++) {
      const f = fixtures[j * W + i], I = f.state === 1 ? 0 : f.state === 2 ? 0.5 : 1;
      if (I) L += I * Math.exp(-((i - x) ** 2 + (j - z) ** 2) * CELL * CELL / 18);
    }
    cellLight[z * W + x] = L;
  }

  // 8) loot crates in cell corners (never blocking doorways or center paths)
  const crates = [];
  const cellCrate = new Int16Array(W * H).fill(-1);
  const addCrate = (x, z, rot, cell) => {
    const id = crates.length;
    crates.push({ id, x, z, rot, cos: Math.cos(rot), sin: Math.sin(rot) });
    cellCrate[cell] = id;
  };
  if (layout === 'arena') {
    for (const [cx, cz] of [[1, 1], [3, 2], [3, 7], [1, 8]]) {
      const x = cx * CELL + 0.78, z = cz * CELL + 0.78;
      addCrate(x, z, 0, cz * W + cx);
      addCrate(W * CELL - x, z, 0, cz * W + W - 1 - cx);
    }
  } else for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (R() > (layout === 'escape' ? 0.1 : 0.24)) continue;
    const ox = R() < 0.5 ? 0.72 : CELL - 0.72, oz = R() < 0.5 ? 0.72 : CELL - 0.72;
    const rot = (R() - 0.5) * 0.35 + ((R() * 4) | 0) * (Math.PI / 2);
    addCrate(x * CELL + ox, z * CELL + oz, rot, z * W + x);
  }
  if (layout === 'escape') for (const s of safeZones) {
    const cell = (s.cz + 1) * W + s.cx + 1;
    if (cellCrate[cell] < 0) addCrate(s.x1 - 0.78, s.z1 - 0.78, 0, cell);
  }

  // 9) vending machines against solid walls, spread across the level (solid boxes, kind 3)
  const cand = [];
  if (layout === 'arena') cand.push([0, 4, 1, 0], [W - 1, 4, -1, 0]);
  else if (layout === 'escape') for (const s of safeZones) cand.push([s.cx, s.cz + 1, 1, 0]);
  else for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (h[z * W + x] === 1) cand.push([x, z, 0, 1]);
    if (h[(z + 1) * W + x] === 1) cand.push([x, z, 0, -1]);
    if (v[z * (W + 1) + x] === 1) cand.push([x, z, 1, 0]);
    if (v[z * (W + 1) + x + 1] === 1) cand.push([x, z, -1, 0]);
  }
  const vendors = [];
  const nV = layout === 'escape' ? safeZones.length : layout === 'arena' ? 2 : Math.max(2, Math.round((W * H) / 80));
  for (let k = 0; k < nV && cand.length; k++) {
    let pick = layout === 'maze' ? null : cand[0], bestD = -1;
    if (layout === 'maze') for (let tries = 0; tries < (k ? 60 : 1); tries++) {
      const c = cand[(R() * cand.length) | 0];
      const px = (c[0] + 0.5) * CELL, pz = (c[1] + 0.5) * CELL;
      let dmin = 1e9;
      for (const o of vendors) dmin = Math.min(dmin, Math.hypot(o.x - px, o.z - pz));
      // spread out, but not all pushed to the outer walls
      const edge = c[0] === 0 || c[1] === 0 || c[0] === W - 1 || c[1] === H - 1;
      const sc = Math.min(dmin, CELL * 7) + R() * CELL * 1.5 - (edge ? CELL * 2 : 0);
      if (sc > bestD) { bestD = sc; pick = c; }
    }
    const [x, z, nx, nz] = pick;
    cand.splice(cand.indexOf(pick), 1);
    const cx = (x + 0.5) * CELL, cz = (z + 0.5) * CELL, back = CELL / 2 - T, half = VENDOR_W / 2;
    const vx = cx - nx * (back - VENDOR_D / 2), vz = cz - nz * (back - VENDOR_D / 2);
    const hx = nx ? VENDOR_D / 2 : half, hz = nz ? VENDOR_D / 2 : half;
    const bi = boxes.length;
    boxes.push({ x0: vx - hx, x1: vx + hx, z0: vz - hz, z1: vz + hz, kind: 3, capA: 1, capB: 1 });
    grid[z * W + x].push(bi);
    vendors.push({ id: vendors.length, x: vx, z: vz, nx, nz, rot: Math.atan2(nx, nz), cell: z * W + x });
  }

  const lintelGrid = Array.from({ length: W * H }, () => []);
  lintels.forEach((b, i) => {
    const x0 = Math.max(0, Math.floor(b.x0 / CELL)), x1 = Math.min(W - 1, Math.floor(b.x1 / CELL));
    const z0 = Math.max(0, Math.floor(b.z0 / CELL)), z1 = Math.min(H - 1, Math.floor(b.z1 / CELL));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) lintelGrid[z * W + x].push(i);
  });
  const point = (cell) => ({ x: (cell % W + 0.5) * CELL, z: (((cell / W) | 0) + 0.5) * CELL, cell });
  const start = point(W + 1), exit = { ...point(W * H - W - 2), r: 1.5 };
  const monsterSpawn = point(escapeRoute ? escapeRoute[Math.floor(escapeRoute.length * 0.58)] : Math.floor(H / 2) * W + Math.floor(W / 2));
  const teamSpawns = [[], []];
  if (layout === 'arena') for (let z = 2; z <= 6; z++) {
    teamSpawns[0].push({ ...point(z * W + 1), yaw: -Math.PI / 2 });
    teamSpawns[1].push({ ...point(z * W + W - 2), yaw: Math.PI / 2 });
  } else {
    for (let i = 0; i < 5; i++) {
      teamSpawns[0].push({ ...point(W + 1 + i), yaw: -Math.PI / 2 });
      teamSpawns[1].push({ ...point(W * H - W - 2 - i), yaw: Math.PI / 2 });
    }
  }
  return {
    seed, W, H, h, v, boxes, lintels, lintelGrid, grid, fixtures, crates, cellCrate, pillarCorners, cellLight, light, vendors,
    layout, safeZones, safeMask, start, exit, monsterSpawn, teamSpawns,
    size: W * CELL, stamp: new Uint32Array(boxes.length), stampId: 0,
  };
}

// --- Raycasting (2D, walls are full height) --------------------------------
export const hitNormal = [0, 0];
export const rayInfo = { box: -1 }; // index of the box the last raycast hit (-1: none)

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
  rayInfo.box = -1;
  const st = map.stamp, boxes = map.boxes;
  if (++map.stampId > 4e9) { st.fill(0); map.stampId = 1; }
  const stamp = map.stampId;
  for (let guard = 0; guard < 256; guard++) {
    if (cx >= 0 && cx < W && cz >= 0 && cz < H) {
      const list = map.grid[cz * W + cx];
      for (let i = 0; i < list.length; i++) {
        const bi = list[i];
        if (st[bi] === stamp) continue;
        st[bi] = stamp;
        if (boxes[bi].off) continue;
        const t = rayBox(boxes[bi], ox, oz, dx, dz, idx, idz);
        if (t < best) { best = t; hitNormal[0] = rayBox.nx; hitNormal[1] = rayBox.nz; rayInfo.box = bi; }
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
      if (!(p.y >= CRATE_H - 1e-6) && ci >= 0) moved = pushCrate(map.crates[ci], p, r) || moved;
      if (Number.isFinite(p.y) && Number.isFinite(p.height) && p.y + p.height > DOOR_H + 1e-7) {
        const doors = map.lintelGrid[z * W + x];
        for (let i = 0; i < doors.length; i++) moved = pushOut(map.lintels[doors[i]], p, r) || moved;
      }
    }
    if (!moved) break;
  }
  p.x = Math.min(W * CELL - r, Math.max(r, p.x));
  p.z = Math.min(H * CELL - r, Math.max(r, p.z));
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

function crateOverlap(c, x, z, r) {
  const dx = x - c.x, dz = z - c.z;
  const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
  const qx = Math.max(-CRATE_W / 2, Math.min(CRATE_W / 2, lx));
  const qz = Math.max(-CRATE_D / 2, Math.min(CRATE_D / 2, lz));
  return (lx - qx) ** 2 + (lz - qz) ** 2 <= r * r;
}

function pushCrate(c, p, r) {
  const dx = p.x - c.x, dz = p.z - c.z;
  const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
  const hx = CRATE_W / 2, hz = CRATE_D / 2;
  const qx = Math.max(-hx, Math.min(hx, lx)), qz = Math.max(-hz, Math.min(hz, lz));
  let ux = lx - qx, uz = lz - qz;
  const d2 = ux * ux + uz * uz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2), k = (r - d) / d;
    ux *= k; uz *= k;
  } else {
    const a = lx + hx, b = hx - lx, d = lz + hz, e = hz - lz, m = Math.min(a, b, d, e);
    ux = 0; uz = 0;
    if (m === a) ux = -hx - r - lx;
    else if (m === b) ux = hx + r - lx;
    else if (m === d) uz = -hz - r - lz;
    else uz = hz + r - lz;
  }
  p.x += ux * c.cos + uz * c.sin;
  p.z += -ux * c.sin + uz * c.cos;
  return true;
}

// Feet-height support and head clearance use the same footprints as collide.
export function groundHeight(map, x, z, r = 0, maxY = Infinity) {
  if (maxY < CRATE_H - 1e-6) return 0;
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
    if (i < 0 || j < 0 || i >= map.W || j >= map.H) continue;
    const id = map.cellCrate[j * map.W + i];
    if (id >= 0 && crateOverlap(map.crates[id], x, z, r)) return CRATE_H;
  }
  return 0;
}

export function ceilingHeight(map, x, z, r = 0) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
    if (i < 0 || j < 0 || i >= map.W || j >= map.H) continue;
    const doors = map.lintelGrid[j * map.W + i];
    for (let k = 0; k < doors.length; k++) {
      const b = map.lintels[doors[k]];
      const qx = Math.max(b.x0, Math.min(x, b.x1)), qz = Math.max(b.z0, Math.min(z, b.z1));
      if ((x - qx) ** 2 + (z - qz) ** 2 <= r * r) return DOOR_H;
    }
  }
  return CEIL;
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

// blocked is an optional truthy cell mask, not the -1/zone-id safeMask.
export function findPath(map, from, to, blocked = null) {
  const W = map.W, N = W * map.H;
  if (from < 0 || to < 0 || from >= N || to >= N || (blocked && (blocked[from] || blocked[to]))) return null;
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
      if (prev[n] !== -1 || blocked?.[n]) continue;
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

export function safeAt(map, x, z) {
  if (x < 0 || z < 0 || x >= map.W * CELL || z >= map.H * CELL) return -1;
  return map.safeMask[Math.floor(z / CELL) * map.W + Math.floor(x / CELL)];
}

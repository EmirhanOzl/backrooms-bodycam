// Builds the Backrooms Level 0 geometry with baked fluorescent lighting.
import * as THREE from 'three';
import { CELL, CEIL, DOOR_H, CRATE_W, CRATE_D, CRATE_H, VENDOR_W, VENDOR_D, VENDOR_H, raycast, mulberry32 } from './shared/map.js';
import * as TX from './textures.js';

const K_DIRECT = 7.5;
const LIGHT_TINT = [1.0, 0.95, 0.8];
const TEX_PER_M = 4; // lightmap texels per meter

// Lambert material with baked irradiance: per-vertex attribute (attr) and/or per-object uniform (uniform).
export function bakeMaterial(params, { attr = false, uniform = false, phong = false } = {}) {
  const m = phong ? new THREE.MeshPhongMaterial(params) : new THREE.MeshLambertMaterial(params);
  const uLight = { value: new THREE.Color(1, 1, 1) };
  m.userData.uLight = uLight;
  m.onBeforeCompile = (sh) => {
    if (uniform) sh.uniforms.uLight = uLight;
    if (attr) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float bake;\nvarying float vBake;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = bake;');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + (attr ? 'varying float vBake;\n' : '') + (uniform ? 'uniform vec3 uLight;\n' : ''))
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' +
        (attr ? `irradiance += vec3(${LIGHT_TINT.map((v) => v.toFixed(3)).join(',')}) * vBake * PI;\n` : '') +
        (uniform ? '{ vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz); irradiance += uLight * PI * (0.62 + 0.38 * dot(normal, upV)); }\n' : ''));
  };
  m.customProgramCacheKey = () => (attr ? 'bakeA' : '') + (uniform ? 'bakeU' : '') + (phong ? 'P' : 'L');
  return m;
}

function fixtureIntensity(f) { return f.state === 1 ? 0 : f.state === 2 ? 0.6 : 1; }

export function buildWorld(map, scene, renderer, onProgress = () => {}) {
  const size = map.W * CELL;
  const N = size * TEX_PER_M;
  const fx = map.fixtures;
  const group = new THREE.Group();
  scene.add(group);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // ---------- visibility-tested direct light from nearby troffers ----------
  function visibleFixtures(x, z, out) {
    out.length = 0;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let j = cz - 2; j <= cz + 2; j++) {
      if (j < 0 || j >= map.H) continue;
      for (let i = cx - 2; i <= cx + 2; i++) {
        if (i < 0 || i >= map.W) continue;
        const f = fx[j * map.W + i], I = fixtureIntensity(f);
        if (!I) continue;
        const dx = f.x - x, dz = f.z - z, d = Math.hypot(dx, dz);
        if (d > 9.5) continue;
        if (d > 0.05 && raycast(map, x, z, dx / d, dz / d, d) < d - 0.05) continue;
        out.push(f.x, f.z, I);
      }
    }
    return out;
  }
  const vis = [];
  const H2 = CEIL * CEIL;

  // ---------- floor direct + bounce ----------
  const direct = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = (j + 0.5) / TEX_PER_M;
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / TEX_PER_M;
      visibleFixtures(x, z, vis);
      let E = 0;
      for (let k = 0; k < vis.length; k += 3) {
        const dx = vis[k] - x, dz = vis[k + 1] - z, r2 = dx * dx + dz * dz + H2;
        E += vis[k + 2] * K_DIRECT * H2 / (r2 * r2);
      }
      direct[j * N + i] = E;
    }
  }
  onProgress(0.45);
  const blur = (src, rad, passes) => {
    let a = src.slice(), b = new Float32Array(src.length);
    for (let p = 0; p < passes; p++) {
      for (let j = 0; j < N; j++) { let s = 0, c = 0; for (let i = -rad; i < N + rad; i++) { if (i + rad < N) { s += a[j * N + i + rad]; c++; } if (i - rad - 1 >= 0) { s -= a[j * N + i - rad - 1]; c--; } if (i >= 0 && i < N) b[j * N + i] = s / c; } }
      for (let i = 0; i < N; i++) { let s = 0, c = 0; for (let j = -rad; j < N + rad; j++) { if (j + rad < N) { s += b[(j + rad) * N + i]; c++; } if (j - rad - 1 >= 0) { s -= b[(j - rad - 1) * N + i]; c--; } if (j >= 0 && j < N) a[j * N + i] = s / c; } }
    }
    return a;
  };
  const soft = blur(direct, 1, 1);
  const bounce = blur(direct, 6, 2);

  // ambient occlusion near walls
  const aoAt = (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let dmin = 1;
    for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
      if (i < 0 || j < 0 || i >= map.W || j >= map.H) continue;
      for (const bi of map.grid[j * map.W + i]) {
        const b = map.boxes[bi];
        const qx = Math.max(b.x0, Math.min(x, b.x1)), qz = Math.max(b.z0, Math.min(z, b.z1));
        dmin = Math.min(dmin, Math.hypot(x - qx, z - qz));
      }
    }
    return 0.62 + 0.38 * Math.min(1, dmin / 0.7) ** 0.7;
  };

  const R = mulberry32(map.seed ^ 0x5eed);
  // damp stains on the carpet (big soft blotches)
  const stain = new Float32Array(N * N);
  for (let s = 0; s < map.W * map.H * 0.5; s++) {
    const sx = R() * N, sz = R() * N, rad = (1 + R() * 3) * TEX_PER_M, str = 0.15 + R() * 0.3;
    for (let j = Math.max(0, (sz - rad) | 0); j < Math.min(N, sz + rad); j++) for (let i = Math.max(0, (sx - rad) | 0); i < Math.min(N, sx + rad); i++) {
      const d = Math.hypot(i - sx, j - sz) / rad;
      if (d < 1) stain[j * N + i] = Math.max(stain[j * N + i], str * (1 - d * d));
    }
  }

  const light = new Float32Array(N * N); // used for dynamic objects
  const floorData = new Uint8Array(N * N * 4), ceilData = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = (i + 0.5) / TEX_PER_M, z = (j + 0.5) / TEX_PER_M;
    const ao = aoAt(x, z);
    const L = soft[k] + 0.35 * bounce[k] + 0.015;
    light[k] = L;
    const F = L * ao * (1 - stain[k]);
    // ceiling: bounce light + halo around lit troffers
    const f = fx[Math.min(map.H - 1, Math.floor(z / CELL)) * map.W + Math.min(map.W - 1, Math.floor(x / CELL))];
    const hd2 = (f.x - x) ** 2 + ((f.z - z) * 0.6) ** 2;
    const C = (0.03 + 0.5 * bounce[k] + 0.12 * soft[k] + fixtureIntensity(f) * 0.5 * Math.exp(-hd2 / 0.6)) * (0.75 + 0.25 * ao);
    for (let c = 0; c < 3; c++) {
      floorData[k * 4 + c] = Math.min(255, (F * LIGHT_TINT[c] / 2) * 255);
      ceilData[k * 4 + c] = Math.min(255, (C * LIGHT_TINT[c] / 2) * 255);
    }
    floorData[k * 4 + 3] = ceilData[k * 4 + 3] = 255;
  }
  const lmTex = (data) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  const sampleLight = (x, z) => {
    const fxi = Math.max(0, Math.min(N - 1.001, x * TEX_PER_M - 0.5)), fzi = Math.max(0, Math.min(N - 1.001, z * TEX_PER_M - 0.5));
    const i = fxi | 0, j = fzi | 0, u = fxi - i, v = fzi - j;
    const a = light[j * N + i], b = light[j * N + i + 1], c = light[(j + 1) * N + i], d = light[(j + 1) * N + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  onProgress(0.6);

  // ---------- floor & ceiling ----------
  const plane = (y, up) => {
    const g = new THREE.PlaneGeometry(size, size, 1, 1);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    g.translate(size / 2, y, size / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / size, p.getZ(i) / size);
    return g;
  };
  const carpet = TX.carpetTextures();
  carpet.map.repeat.set(size / 4, size / 4); carpet.bump.repeat.copy(carpet.map.repeat);
  carpet.map.anisotropy = carpet.bump.anisotropy = aniso;
  const floorMat = new THREE.MeshLambertMaterial({ map: carpet.map, bumpMap: carpet.bump, bumpScale: 1.2, lightMap: lmTex(floorData), lightMapIntensity: 2 * Math.PI });
  const floor = new THREE.Mesh(plane(0, true), floorMat);
  group.add(floor);
  const ceilTex = TX.ceilingTexture();
  ceilTex.repeat.set(size / 4, size / 4); ceilTex.anisotropy = aniso;
  const ceilMat = new THREE.MeshLambertMaterial({ map: ceilTex, lightMap: lmTex(ceilData), lightMapIntensity: 2 * Math.PI });
  const ceiling = new THREE.Mesh(plane(CEIL, false), ceilMat);
  group.add(ceiling);

  // ---------- walls (subdivided, vertex-baked) ----------
  const pos = [], nor = [], uvs = [], bake = [], idx = [];
  const ROWS = [0, 0.09, 0.45, 1.0, 1.6, 2.15, 2.55, 2.8, CEIL];
  const wallLight = (px, pz, nx, nz, y, visList, bnc) => {
    let E = 0;
    for (let k = 0; k < visList.length; k += 3) {
      const lx = visList[k] - px, lz = visList[k + 1] - pz, ly = CEIL - y + 0.02;
      const r2 = lx * lx + ly * ly + lz * lz, r = Math.sqrt(r2);
      const cosR = (lx * nx + lz * nz) / r;
      if (cosR <= 0) continue;
      const cosE = ly / r;
      E += visList[k + 2] * K_DIRECT * 0.9 * (0.3 + 0.7 * cosE) * cosR / r2;
    }
    const ao = (y < 0.25 ? 0.72 + y * 1.1 : 1) * (y > CEIL - 0.2 ? 0.8 + (CEIL - y) : 1);
    return Math.min(1.9, (E + bnc * (0.3 + 0.18 * (1 - y / CEIL)) + 0.015) * ao);
  };
  function face(ax, az, bx, bz, nx, nz, y0, y1, uoff) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) return;
    const segs = Math.max(1, Math.ceil(len / 0.5));
    const rows = [y0, ...ROWS.filter((r) => r > y0 + 0.01 && r < y1 - 0.01), y1];
    const base = pos.length / 3;
    const vl = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      visibleFixtures(px + nx * 0.06, pz + nz * 0.06, vl);
      const bnc = sampleBounce(px + nx * 0.5, pz + nz * 0.5);
      for (const y of rows) {
        pos.push(px, y, pz); nor.push(nx, 0, nz);
        uvs.push((uoff + len * t) / 4, y / CEIL);
        bake.push(wallLight(px, pz, nx, nz, y, vl, bnc));
      }
    }
    const nr = rows.length;
    const flip = -(bz - az) * nx + (bx - ax) * nz > 0;
    for (let s = 0; s < segs; s++) for (let r = 0; r < nr - 1; r++) {
      const a = base + s * nr + r, b = base + (s + 1) * nr + r, c = b + 1, d = a + 1;
      if (flip) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c);
    }
  }
  const sampleBounce = (x, z) => {
    const i = Math.max(0, Math.min(N - 1, (x * TEX_PER_M) | 0)), j = Math.max(0, Math.min(N - 1, (z * TEX_PER_M) | 0));
    return bounce[j * N + i];
  };
  for (const b of map.boxes) {
    const uo = R() * 4;
    if (b.kind === 0) {
      face(b.x0, b.z0, b.x1, b.z0, 0, -1, 0, CEIL, uo);
      face(b.x0, b.z1, b.x1, b.z1, 0, 1, 0, CEIL, uo);
      if (b.capA) face(b.x0, b.z0, b.x0, b.z1, -1, 0, 0, CEIL, uo);
      if (b.capB) face(b.x1, b.z0, b.x1, b.z1, 1, 0, 0, CEIL, uo);
    } else if (b.kind === 1) {
      face(b.x0, b.z0, b.x0, b.z1, -1, 0, 0, CEIL, uo);
      face(b.x1, b.z0, b.x1, b.z1, 1, 0, 0, CEIL, uo);
      if (b.capA) face(b.x0, b.z0, b.x1, b.z0, 0, -1, 0, CEIL, uo);
      if (b.capB) face(b.x0, b.z1, b.x1, b.z1, 0, 1, 0, CEIL, uo);
    } else if (b.kind === 2) {
      face(b.x0, b.z0, b.x1, b.z0, 0, -1, 0, CEIL, uo);
      face(b.x0, b.z1, b.x1, b.z1, 0, 1, 0, CEIL, uo);
      face(b.x0, b.z0, b.x0, b.z1, -1, 0, 0, CEIL, uo);
      face(b.x1, b.z0, b.x1, b.z1, 1, 0, 0, CEIL, uo);
    }
  }
  for (const l of map.lintels) {
    const alongX = l.x1 - l.x0 > l.z1 - l.z0;
    if (alongX) { face(l.x0, l.z0, l.x1, l.z0, 0, -1, DOOR_H, CEIL, 0); face(l.x0, l.z1, l.x1, l.z1, 0, 1, DOOR_H, CEIL, 0); }
    else { face(l.x0, l.z0, l.x0, l.z1, -1, 0, DOOR_H, CEIL, 0); face(l.x1, l.z0, l.x1, l.z1, 1, 0, DOOR_H, CEIL, 0); }
    // underside
    const base = pos.length / 3, bn = sampleBounce((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2) * 0.35 + 0.02;
    for (const [x, z] of [[l.x0, l.z0], [l.x1, l.z0], [l.x1, l.z1], [l.x0, l.z1]]) {
      pos.push(x, DOOR_H, z); nor.push(0, -1, 0); uvs.push(x / 4, 0.02); bake.push(bn);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  wg.setAttribute('bake', new THREE.Float32BufferAttribute(bake, 1));
  wg.setIndex(idx);
  wg.computeBoundingSphere();
  const wp = TX.wallpaperTextures();
  wp.map.anisotropy = wp.bump.anisotropy = aniso;
  const walls = new THREE.Mesh(wg, bakeMaterial({ map: wp.map, bumpMap: wp.bump, bumpScale: 0.8 }, { attr: true }));
  group.add(walls);
  onProgress(0.85);

  // ---------- troffer light fixtures ----------
  const nF = fx.length;
  const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.56, 0.035, 1.06), new THREE.MeshBasicMaterial({ color: 0x77736a }), nF);
  const panel = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.48, 0.98).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.lensTexture() }), nF);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const ON = new THREE.Color(3.2, 3.05, 2.6), OFF = new THREE.Color(0.1, 0.1, 0.09);
  const flickers = [];
  fx.forEach((f, i) => {
    m4.makeTranslation(f.x, CEIL - 0.012, f.z); housing.setMatrixAt(i, m4);
    const hl = sampleLight(f.x, f.z) * 0.35 + 0.05; housing.setColorAt(i, col.setRGB(hl, hl, hl * 0.95));
    m4.makeTranslation(f.x, CEIL - 0.031, f.z); panel.setMatrixAt(i, m4);
    panel.setColorAt(i, f.state === 1 ? OFF : ON);
    if (f.state === 2) flickers.push({ i, f, next: 0, on: true, phase: R() * 100 });
  });
  group.add(housing, panel);

  // ---------- loot crates ----------
  const crateTex = TX.crateTexture();
  crateTex.anisotropy = aniso;
  const bodyGeo = new THREE.BoxGeometry(CRATE_W, CRATE_H, CRATE_D);
  bodyGeo.translate(0, CRATE_H / 2, 0);
  { const ix = Array.from(bodyGeo.index.array); ix.splice(12, 6); bodyGeo.setIndex(ix); } // open top
  // the bottom face (vertices 12..15) doubles as the inner floor: lifted off the carpet so the two never z-fight
  { const p = bodyGeo.attributes.position; for (let k = 12; k < 16; k++) p.setY(k, 0.04); }
  const lidGeo = new THREE.BoxGeometry(CRATE_W + 0.02, 0.035, CRATE_D + 0.02);
  lidGeo.translate(0, 0.0175, (CRATE_D + 0.02) / 2);
  const nC = map.crates.length;
  const cBake = new Float32Array(nC);
  map.crates.forEach((c, i) => { cBake[i] = Math.min(1.4, sampleLight(c.x, c.z) * 0.9 + 0.02); });
  bodyGeo.setAttribute('bake', new THREE.InstancedBufferAttribute(cBake, 1));
  lidGeo.setAttribute('bake', new THREE.InstancedBufferAttribute(cBake, 1));
  const crateMat = bakeMaterial({ map: crateTex, side: THREE.DoubleSide }, { attr: true });
  const lidMat = bakeMaterial({ map: crateTex }, { attr: true });
  const crateBody = new THREE.InstancedMesh(bodyGeo, crateMat, nC);
  const crateLid = new THREE.InstancedMesh(lidGeo, lidMat, nC);
  const crateState = map.crates.map((c) => ({ open: 0, target: 0 }));
  const q = new THREE.Quaternion(), qa = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  const setCrate = (i) => {
    const c = map.crates[i];
    q.setFromAxisAngle(Y, c.rot);
    m4.compose(v.set(c.x, 0, c.z), q, s1); crateBody.setMatrixAt(i, m4);
    const a = -1.95 * crateState[i].open;
    qa.setFromAxisAngle(X, a);
    const hinge = v.set(0, CRATE_H, -(CRATE_D + 0.02) / 2).applyQuaternion(q).add({ x: c.x, y: 0, z: c.z });
    m4.compose(hinge, q.clone().multiply(qa), s1); crateLid.setMatrixAt(i, m4);
  };
  for (let i = 0; i < nC; i++) setCrate(i);
  group.add(crateBody, crateLid);

  // ---------- almond-water vending machines ----------
  const VT = TX.vendorTextures();
  const vendorGeo = new THREE.BoxGeometry(VENDOR_W, VENDOR_H, VENDOR_D).translate(0, VENDOR_H / 2, 0);
  const glowGeo = new THREE.PlaneGeometry(VENDOR_W, VENDOR_H).translate(0, VENDOR_H / 2, VENDOR_D / 2 + 0.003);
  const floorGlowGeo = new THREE.PlaneGeometry(1.7, 1.3).rotateX(-Math.PI / 2);
  const floorGlowTex = TX.softDotTexture();
  const vendorGlows = [];
  for (const vd of map.vendors) {
    const L = Math.min(1.4, sampleLight(vd.x + vd.nx * 0.8, vd.z + vd.nz * 0.8) * 0.9 + 0.05);
    const side = bakeMaterial({ color: 0xb9ab86 }, { uniform: true });
    const front = bakeMaterial({ map: VT.front }, { uniform: true });
    for (const m of [side, front]) m.userData.uLight.value.setRGB(L, L * 0.97, L * 0.88);
    const body = new THREE.Mesh(vendorGeo, [side, side, side, side, front, side]);
    body.position.set(vd.x, 0, vd.z); body.rotation.y = vd.rot;
    const glowMat = new THREE.MeshBasicMaterial({ map: VT.glow, transparent: true, color: new THREE.Color(1.25, 1.25, 1.15), fog: true });
    const glow = new THREE.Mesh(glowGeo, glowMat); body.add(glow);
    const floor = new THREE.Mesh(floorGlowGeo, new THREE.MeshBasicMaterial({ map: floorGlowTex, color: new THREE.Color(0.2, 0.21, 0.16), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    floor.position.set(vd.x + vd.nx * 0.95, 0.004, vd.z + vd.nz * 0.95); floor.rotation.y = vd.rot;
    group.add(body, floor);
    vendorGlows.push({ glowMat, floorMat: floor.material, next: 3 + Math.random() * 20, off: 0 });
  }

  scene.fog = new THREE.Fog(0x2a2410, 14, 58);

  let flickerT = 0;
  return {
    group, sampleLight, crateState,
    setCrateOpen(i, open, instant) { crateState[i].target = open ? 1 : 0; if (instant) { crateState[i].open = crateState[i].target; setCrate(i); crateLid.instanceMatrix.needsUpdate = true; } },
    flickers,
    update(dt, time) {
      let dirty = false;
      for (let i = 0; i < nC; i++) {
        const s = crateState[i];
        if (s.open !== s.target) {
          s.open += Math.sign(s.target - s.open) * dt * 4;
          s.open = s.target > s.open ? Math.min(s.target, s.open) : Math.max(s.target, s.open);
          if (Math.abs(s.open - s.target) < 0.01) s.open = s.target;
          setCrate(i); dirty = true;
        }
      }
      if (dirty) crateLid.instanceMatrix.needsUpdate = true;
      flickerT += dt;
      if (flickerT > 0.03) {
        flickerT = 0;
        for (const fl of flickers) {
          if (time > fl.next) {
            fl.on = !fl.on;
            fl.next = time + (fl.on ? 0.3 + Math.random() * 3 : 0.03 + Math.random() * 0.15);
            panel.setColorAt(fl.i, fl.on ? ON : col.setRGB(0.3, 0.29, 0.25));
          }
        }
        if (flickers.length) panel.instanceColor.needsUpdate = true;
        // the machines' tubes stutter now and then
        for (const g of vendorGlows) {
          if (time > g.next) { g.off = g.off ? 0 : 1; g.next = time + (g.off ? 0.04 + Math.random() * 0.12 : 4 + Math.random() * 25); }
          const k = g.off ? 0.35 : 1;
          g.glowMat.color.setRGB(1.25 * k, 1.25 * k, 1.15 * k);
          g.floorMat.color.setRGB(0.2 * k, 0.21 * k, 0.16 * k);
        }
      }
    },
  };
}

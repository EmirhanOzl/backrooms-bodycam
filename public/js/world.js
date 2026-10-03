// Builds the Backrooms Level 0 geometry with baked fluorescent lighting.
import * as THREE from 'three';
import { CELL, CEIL, DOOR_H, VENDOR_W, VENDOR_D, VENDOR_H, raycast, mulberry32, safeAt } from './shared/map.js';
import * as TX from './textures.js';
import { chestGeometries, chestLabelTexture, CHEST_HINGE_Y, CHEST_HINGE_Z } from './chest.js';

const K_DIRECT = 7.5;
const LIGHT_TINT = [1.0, 0.95, 0.8];
const TEX_PER_M = 4; // lightmap texels per meter

// Lambert material with baked irradiance: per-vertex attribute (attr) and/or per-object uniform (uniform).
export function bakeMaterial(params, { attr = false, uniform = false, phong = false, tint = LIGHT_TINT } = {}) {
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
        (attr ? `irradiance += vec3(${tint.map((v) => v.toFixed(3)).join(',')}) * vBake * PI;\n` : '') +
        (uniform ? '{ vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz); irradiance += uLight * PI * (0.62 + 0.38 * dot(normal, upV)); }\n' : ''));
  };
  m.customProgramCacheKey = () => (attr ? `bakeA${tint.join(',')}` : '') + (uniform ? 'bakeU' : '') + (phong ? 'P' : 'L');
  return m;
}

function fixtureIntensity(f) { return f.state === 1 ? 0 : f.state === 2 ? 0.6 : 1; }

export function buildWorld(map, scene, renderer, onProgress = () => {}) {
  const arena = map.layout === 'arena', escape = map.layout === 'escape';
  const size = map.W * CELL, N = Math.min(512, Math.ceil(size * TEX_PER_M)), texPerM = N / size;
  const lightTint = arena ? [0.96, 0.99, 1] : escape ? [0.88, 1, 0.91] : LIGHT_TINT;
  const fx = map.fixtures, group = new THREE.Group();
  scene.add(group);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const CHUNK = CELL * 4, chunkCount = Math.ceil(size / CHUNK), chunks = new Map();
  function chunkAt(x, z) {
    const cx = Math.max(0, Math.min(chunkCount - 1, Math.floor(x / CHUNK)));
    const cz = Math.max(0, Math.min(chunkCount - 1, Math.floor(z / CHUNK))), key = cz * chunkCount + cx;
    let chunk = chunks.get(key);
    if (!chunk) {
      const root = new THREE.Group();
      group.add(root);
      chunk = { root, cx, cz, x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK };
      chunks.set(key, chunk);
    }
    return chunk;
  }

  // Direct light only examines a fixed 5x5 neighborhood. Lit sanctuaries
  // cannot accidentally illuminate distant cells through a global light list.
  function visibleFixtures(x, z, out) {
    out.length = 0;
    const zone = escape ? safeAt(map, x, z) : -1;
    if (escape && zone < 0) return out;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let j = cz - 2; j <= cz + 2; j++) {
      if (j < 0 || j >= map.H) continue;
      for (let i = cx - 2; i <= cx + 2; i++) {
        if (i < 0 || i >= map.W) continue;
        if (escape && map.safeMask[j * map.W + i] !== zone) continue;
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
  const vis = [], H2 = CEIL * CEIL, direct = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = (j + 0.5) / texPerM;
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / texPerM;
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
      for (let j = 0; j < N; j++) {
        let sum = 0, count = 0;
        for (let i = -rad; i < N + rad; i++) {
          if (i + rad < N) { sum += a[j * N + i + rad]; count++; }
          if (i - rad - 1 >= 0) { sum -= a[j * N + i - rad - 1]; count--; }
          if (i >= 0 && i < N) b[j * N + i] = sum / count;
        }
      }
      for (let i = 0; i < N; i++) {
        let sum = 0, count = 0;
        for (let j = -rad; j < N + rad; j++) {
          if (j + rad < N) { sum += b[(j + rad) * N + i]; count++; }
          if (j - rad - 1 >= 0) { sum -= b[(j - rad - 1) * N + i]; count--; }
          if (j >= 0 && j < N) a[j * N + i] = sum / count;
        }
      }
    }
    return a;
  };
  const soft = blur(direct, 1, 1), bounce = blur(direct, Math.max(1, Math.round(1.5 * texPerM)), 2);
  const aoAt = (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let dmin = 1;
    for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
      if (i < 0 || j < 0 || i >= map.W || j >= map.H) continue;
      for (const bi of map.grid[j * map.W + i]) {
        const b = map.boxes[bi], qx = Math.max(b.x0, Math.min(x, b.x1)), qz = Math.max(b.z0, Math.min(z, b.z1));
        dmin = Math.min(dmin, Math.hypot(x - qx, z - qz));
      }
    }
    return 0.62 + 0.38 * Math.min(1, dmin / 0.7) ** 0.7;
  };
  const R = mulberry32(map.seed ^ 0x5eed), stain = new Float32Array(N * N);
  if (!arena) for (let s = 0; s < map.W * map.H * 0.5; s++) {
    const sx = R() * N, sz = R() * N, rad = (1 + R() * 3) * texPerM, str = 0.15 + R() * 0.3;
    for (let j = Math.max(0, (sz - rad) | 0); j < Math.min(N, sz + rad); j++) for (let i = Math.max(0, (sx - rad) | 0); i < Math.min(N, sx + rad); i++) {
      const d = Math.hypot(i - sx, j - sz) / rad;
      if (d < 1) stain[j * N + i] = Math.max(stain[j * N + i], str * (1 - d * d));
    }
  }
  const light = new Float32Array(N * N), floorData = new Uint8Array(N * N * 4), ceilData = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = (i + 0.5) / texPerM, z = (j + 0.5) / texPerM;
    const lit = !escape || safeAt(map, x, z) >= 0, ao = lit ? aoAt(x, z) : 1;
    const L = lit ? soft[k] + 0.35 * bounce[k] + 0.015 : 0.004;
    light[k] = L;
    const F = L * ao * (1 - stain[k]);
    const f = fx[Math.floor(z / CELL) * map.W + Math.floor(x / CELL)], hd2 = (f.x - x) ** 2 + ((f.z - z) * 0.6) ** 2;
    const C = lit ? (0.03 + 0.5 * bounce[k] + 0.12 * soft[k] + fixtureIntensity(f) * 0.5 * Math.exp(-hd2 / 0.6)) * (0.75 + 0.25 * ao) : 0.006;
    for (let c = 0; c < 3; c++) {
      floorData[k * 4 + c] = Math.min(255, F * lightTint[c] * 127.5);
      ceilData[k * 4 + c] = Math.min(255, C * lightTint[c] * 127.5);
    }
    floorData[k * 4 + 3] = ceilData[k * 4 + 3] = 255;
  }
  const lmTex = (data) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    return t;
  };
  const sampleLight = (x, z) => {
    const fxi = Math.max(0, Math.min(N - 1.001, x * texPerM - 0.5)), fzi = Math.max(0, Math.min(N - 1.001, z * texPerM - 0.5));
    const i = fxi | 0, j = fzi | 0, u = fxi - i, v = fzi - j;
    const a = light[j * N + i], b = light[j * N + i + 1], c = light[(j + 1) * N + i], d = light[(j + 1) * N + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  const sampleBounce = (x, z) => {
    if (escape && safeAt(map, x, z) < 0) return 0;
    const i = Math.max(0, Math.min(N - 1, (x * texPerM) | 0)), j = Math.max(0, Math.min(N - 1, (z * texPerM) | 0));
    return bounce[j * N + i];
  };
  onProgress(0.6);

  // Floors, ceilings, walls, fixtures and chests share small spatial chunks.
  // The camera frustum and update's distance bound can cull them independently.
  const plane = (x0, z0, x1, z1, y, up) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / size, p.getZ(i) / size);
    return g;
  };
  const carpet = arena ? TX.industrialTextures('floor') : TX.carpetTextures();
  carpet.map.repeat.set(size / CELL, size / CELL); carpet.bump.repeat.copy(carpet.map.repeat);
  carpet.map.anisotropy = carpet.bump.anisotropy = aniso;
  const floorMat = new THREE.MeshLambertMaterial({ map: carpet.map, bumpMap: carpet.bump, bumpScale: arena ? 0.16 : 1.2, lightMap: lmTex(floorData), lightMapIntensity: 2 * Math.PI });
  const ceilTex = arena ? TX.industrialCeilingTexture() : TX.ceilingTexture();
  ceilTex.repeat.set(size / CELL, size / CELL); ceilTex.anisotropy = aniso;
  const ceilMat = new THREE.MeshLambertMaterial({ map: ceilTex, lightMap: lmTex(ceilData), lightMapIntensity: 2 * Math.PI });
  for (let z = 0; z < size; z += CHUNK) for (let x = 0; x < size; x += CHUNK) {
    const root = chunkAt(x, z).root, x1 = Math.min(size, x + CHUNK), z1 = Math.min(size, z + CHUNK);
    root.add(new THREE.Mesh(plane(x, z, x1, z1, 0, true), floorMat), new THREE.Mesh(plane(x, z, x1, z1, CEIL, false), ceilMat));
  }

  const ROWS = escape ? [0, 0.09, 0.7, 1.5, DOOR_H, CEIL] : [0, 0.09, 0.45, 1, 1.6, DOOR_H, 2.55, 2.8, CEIL];
  const wallLight = (px, pz, nx, nz, y, visList, bnc) => {
    let E = 0;
    for (let k = 0; k < visList.length; k += 3) {
      const lx = visList[k] - px, lz = visList[k + 1] - pz, ly = CEIL - y + 0.02, r2 = lx * lx + ly * ly + lz * lz, r = Math.sqrt(r2);
      const cosR = (lx * nx + lz * nz) / r;
      if (cosR > 0) E += visList[k + 2] * K_DIRECT * 0.9 * (0.3 + 0.7 * ly / r) * cosR / r2;
    }
    const ao = (y < 0.25 ? 0.72 + y * 1.1 : 1) * (y > CEIL - 0.2 ? 0.8 + CEIL - y : 1);
    return Math.min(1.9, (E + bnc * (0.3 + 0.18 * (1 - y / CEIL)) + (escape ? 0.004 : 0.015)) * ao);
  };
  const wallBuffer = (x, z) => {
    const chunk = chunkAt(x, z);
    if (!chunk.walls) chunk.walls = { pos: [], nor: [], uvs: [], bake: [], idx: [] };
    return chunk.walls;
  };
  function faceSection(ax, az, bx, bz, nx, nz, y0, y1, uoff) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) return;
    const { pos, nor, uvs, bake, idx } = wallBuffer((ax + bx) / 2, (az + bz) / 2);
    const segs = Math.max(1, Math.ceil(len / (escape ? 1 : 0.5)));
    const rows = [y0, ...ROWS.filter((r) => r > y0 + 0.01 && r < y1 - 0.01), y1], base = pos.length / 3, vl = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      visibleFixtures(px + nx * 0.06, pz + nz * 0.06, vl);
      const bnc = sampleBounce(px + nx * 0.5, pz + nz * 0.5);
      for (const y of rows) {
        pos.push(px, y, pz); nor.push(nx, 0, nz); uvs.push((uoff + len * t) / CELL, y / CEIL);
        bake.push(wallLight(px, pz, nx, nz, y, vl, bnc));
      }
    }
    const nr = rows.length, flip = -(bz - az) * nx + (bx - ax) * nz > 0;
    for (let s = 0; s < segs; s++) for (let r = 0; r < nr - 1; r++) {
      const a = base + s * nr + r, b = base + (s + 1) * nr + r, c = b + 1, d = a + 1;
      if (flip) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c);
    }
  }
  function face(ax, az, bx, bz, nx, nz, y0, y1, uoff) {
    const len = Math.hypot(bx - ax, bz - az), sections = Math.max(1, Math.ceil(len / CHUNK));
    for (let i = 0; i < sections; i++) {
      const t0 = i / sections, t1 = (i + 1) / sections;
      faceSection(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, nx, nz, y0, y1, uoff + len * t0);
    }
  }
  for (const b of map.boxes) {
    if (b.kind > 2) continue;
    const uo = R() * CELL;
    if (b.kind === 0 || b.kind === 2) {
      face(b.x0, b.z0, b.x1, b.z0, 0, -1, 0, CEIL, uo); face(b.x0, b.z1, b.x1, b.z1, 0, 1, 0, CEIL, uo);
    }
    if (b.kind === 1 || b.kind === 2 || b.capA) face(b.x0, b.z0, b.x0, b.z1, -1, 0, 0, CEIL, uo);
    if (b.kind === 1 || b.kind === 2 || b.capB) face(b.x1, b.z0, b.x1, b.z1, 1, 0, 0, CEIL, uo);
    if (b.kind === 1 && b.capA) face(b.x0, b.z0, b.x1, b.z0, 0, -1, 0, CEIL, uo);
    if (b.kind === 1 && b.capB) face(b.x0, b.z1, b.x1, b.z1, 0, 1, 0, CEIL, uo);
  }
  for (const l of map.lintels) {
    if (l.x1 - l.x0 > l.z1 - l.z0) {
      face(l.x0, l.z0, l.x1, l.z0, 0, -1, DOOR_H, CEIL, 0); face(l.x0, l.z1, l.x1, l.z1, 0, 1, DOOR_H, CEIL, 0);
    } else {
      face(l.x0, l.z0, l.x0, l.z1, -1, 0, DOOR_H, CEIL, 0); face(l.x1, l.z0, l.x1, l.z1, 1, 0, DOOR_H, CEIL, 0);
    }
    const { pos, nor, uvs, bake, idx } = wallBuffer((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2);
    const base = pos.length / 3, bn = sampleBounce((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2) * 0.35 + (escape ? 0.004 : 0.02);
    for (const [x, z] of [[l.x0, l.z0], [l.x1, l.z0], [l.x1, l.z1], [l.x0, l.z1]]) {
      pos.push(x, DOOR_H, z); nor.push(0, -1, 0); uvs.push(x / CELL, 0.02); bake.push(bn);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const wp = arena ? TX.industrialTextures() : TX.wallpaperTextures();
  wp.map.anisotropy = wp.bump.anisotropy = aniso;
  const wallMat = bakeMaterial({ map: wp.map, bumpMap: wp.bump, bumpScale: arena ? 0.18 : 0.8 }, { attr: true, tint: lightTint });
  for (const chunk of chunks.values()) if (chunk.walls) {
    const { pos, nor, uvs, bake, idx } = chunk.walls, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setAttribute('bake', new THREE.Float32BufferAttribute(bake, 1)); g.setIndex(idx);
    g.computeBoundingSphere(); chunk.root.add(new THREE.Mesh(g, wallMat));
    delete chunk.walls;
  }
  const bakedColor = (color, x, z) => {
    const mat = bakeMaterial({ color }, { uniform: true });
    const L = Math.min(1.4, sampleLight(x, z) * 0.9 + (escape ? 0.005 : 0.02));
    mat.userData.uLight.value.setRGB(L * lightTint[0], L * lightTint[1], L * lightTint[2]);
    return mat;
  };
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const boxMesh = (root, mat, x, y, z, w, h, d) => {
    const mesh = new THREE.Mesh(unitBox, mat);
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); root.add(mesh); return mesh;
  };
  for (const b of map.boxes) if (b.kind === 4) {
    const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2;
    boxMesh(chunkAt(x, z).root, bakedColor(b.style === 'container' ? (x < size / 2 ? 0x577186 : 0x8e7555) : 0x626c6d, x, z), x, CEIL / 2, z, b.x1 - b.x0, CEIL, b.z1 - b.z0);
  }
  onProgress(0.85);

  const m4 = new THREE.Matrix4(), col = new THREE.Color(), flickers = [];
  const ON = new THREE.Color(arena ? 3.1 : 3.2, 3.05, arena ? 3.1 : escape ? 2.95 : 2.6), OFF = new THREE.Color(0.055, 0.06, 0.055);
  const housingGeo = new THREE.BoxGeometry(0.56, 0.035, 1.06), panelGeo = new THREE.PlaneGeometry(0.48, 0.98).rotateX(Math.PI / 2);
  const housingMat = new THREE.MeshBasicMaterial({ color: 0x777b78 }), panelMat = new THREE.MeshBasicMaterial({ map: TX.lensTexture() });
  for (const f of fx) if (f.visible !== false) {
    const chunk = chunkAt(f.x, f.z);
    if (!chunk.fixtures) chunk.fixtures = [];
    chunk.fixtures.push(f);
  }
  for (const chunk of chunks.values()) if (chunk.fixtures) {
    const housing = new THREE.InstancedMesh(housingGeo, housingMat, chunk.fixtures.length);
    const panel = new THREE.InstancedMesh(panelGeo, panelMat, chunk.fixtures.length);
    panel.userData.noShadow = true;
    chunk.fixtures.forEach((f, i) => {
      m4.makeRotationY(f.rot * Math.PI / 2); m4.setPosition(f.x, CEIL - 0.012, f.z); housing.setMatrixAt(i, m4);
      const hl = sampleLight(f.x, f.z) * 0.35 + (escape ? 0.006 : 0.05); housing.setColorAt(i, col.setRGB(hl, hl, hl));
      m4.setPosition(f.x, CEIL - 0.031, f.z); panel.setMatrixAt(i, m4);
      panel.setColorAt(i, f.emergency ? col.setRGB(0.35, 0.009, 0.003) : f.state === 1 ? OFF : ON);
      if (f.state === 2) flickers.push({ i, f, panel, next: 0, on: true });
    });
    housing.computeBoundingSphere(); panel.computeBoundingSphere(); chunk.root.add(housing, panel);
    delete chunk.fixtures;
  }

  // Chests remain addressed by global loot id, but render in local batches.
  const CG = chestGeometries(), nC = map.crates.length, crateState = map.crates.map(() => ({ open: 0, target: 0 }));
  const chestMat = bakeMaterial({ vertexColors: true, color: 0xffffff }, { attr: true, tint: lightTint });
  const labelMat = bakeMaterial({ map: chestLabelTexture(), alphaTest: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, { attr: true, tint: lightTint });
  const lidLabelGeo = new THREE.PlaneGeometry(0.3, 0.1875).rotateX(-Math.PI / 2).translate(0, 0.0965, -CHEST_HINGE_Z);
  const frontLabelGeo = new THREE.PlaneGeometry(0.16, 0.1).translate(0, 0.125, -CHEST_HINGE_Z + 0.0045);
  const ledGeo = new THREE.SphereGeometry(0.0065, 8, 6), ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const LED_ON = new THREE.Color(0.35, 3.2, 0.6), LED_OFF = new THREE.Color(1.1, 0.08, 0.05), crateRefs = new Array(nC);
  const instanceGeo = (source, bake) => {
    const g = new THREE.BufferGeometry();
    for (const [key, attr] of Object.entries(source.attributes)) g.setAttribute(key, attr);
    g.setIndex(source.index); g.setAttribute('bake', bake); return g;
  };
  for (const c of map.crates) {
    const chunk = chunkAt(c.x, c.z);
    if (!chunk.crates) chunk.crates = [];
    chunk.crates.push(c.id);
  }
  const crateBatches = [];
  for (const chunk of chunks.values()) if (chunk.crates) {
    const ids = chunk.crates, bake = new THREE.InstancedBufferAttribute(new Float32Array(ids.map((id) => Math.min(1.4, sampleLight(map.crates[id].x, map.crates[id].z) * 0.9 + (escape ? 0.005 : 0.02)))), 1);
    const batch = {
      body: new THREE.InstancedMesh(instanceGeo(CG.body, bake), chestMat, ids.length),
      lid: new THREE.InstancedMesh(instanceGeo(CG.lid, bake), chestMat, ids.length),
      lidLabel: new THREE.InstancedMesh(instanceGeo(lidLabelGeo, bake), labelMat, ids.length),
      frontLabel: new THREE.InstancedMesh(instanceGeo(frontLabelGeo, bake), labelMat, ids.length),
      led: new THREE.InstancedMesh(ledGeo, ledMat, ids.length),
    };
    batch.led.userData.noShadow = true;
    ids.forEach((id, i) => { crateRefs[id] = { batch, i }; });
    chunk.root.add(batch.body, batch.lid, batch.lidLabel, batch.frontLabel, batch.led); crateBatches.push(batch); delete chunk.crates;
  }
  const q = new THREE.Quaternion(), qa = new THREE.Quaternion(), qlid = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  const setCrate = (id, initial = false) => {
    const c = map.crates[id], { batch, i } = crateRefs[id];
    q.setFromAxisAngle(Y, c.rot);
    if (initial) {
      m4.compose(v.set(c.x, 0, c.z), q, s1); batch.body.setMatrixAt(i, m4); batch.frontLabel.setMatrixAt(i, m4);
      v.copy(CG.ledPos).applyQuaternion(q); v.x += c.x; v.z += c.z;
      m4.compose(v, q, s1); batch.led.setMatrixAt(i, m4);
    }
    batch.led.setColorAt(i, crateState[id].target ? LED_OFF : LED_ON);
    qa.setFromAxisAngle(X, -1.95 * crateState[id].open);
    v.set(0, CHEST_HINGE_Y, CHEST_HINGE_Z).applyQuaternion(q); v.x += c.x; v.z += c.z;
    m4.compose(v, qlid.copy(q).multiply(qa), s1); batch.lid.setMatrixAt(i, m4); batch.lidLabel.setMatrixAt(i, m4);
    batch.lid.instanceMatrix.needsUpdate = batch.lidLabel.instanceMatrix.needsUpdate = true;
    if (batch.led.instanceColor) batch.led.instanceColor.needsUpdate = true;
  };
  for (let i = 0; i < nC; i++) setCrate(i, true);
  for (const batch of crateBatches) for (const mesh of Object.values(batch)) {
    mesh.computeBoundingSphere();
    if (mesh === batch.lid || mesh === batch.lidLabel) mesh.boundingSphere.radius += 0.8;
  }

  const VT = TX.vendorTextures(), vendorGlows = [];
  const vendorGeo = new THREE.BoxGeometry(VENDOR_W, VENDOR_H, VENDOR_D).translate(0, VENDOR_H / 2, 0);
  const glowGeo = new THREE.PlaneGeometry(VENDOR_W, VENDOR_H).translate(0, VENDOR_H / 2, VENDOR_D / 2 + 0.003);
  const floorGlowGeo = new THREE.PlaneGeometry(1.7, 1.3).rotateX(-Math.PI / 2), floorGlowTex = TX.softDotTexture();
  for (const vd of map.vendors) {
    const side = bakedColor(arena ? 0x94a5a9 : 0xb9ab86, vd.x + vd.nx * 0.8, vd.z + vd.nz * 0.8);
    const front = bakeMaterial({ map: VT.front }, { uniform: true }); front.userData.uLight.value.copy(side.userData.uLight.value);
    const body = new THREE.Mesh(vendorGeo, [side, side, side, side, front, side]);
    body.position.set(vd.x, 0, vd.z); body.rotation.y = vd.rot;
    const glowMat = new THREE.MeshBasicMaterial({ map: VT.glow, transparent: true, color: new THREE.Color(1.25, 1.25, 1.15), depthWrite: false });
    body.add(new THREE.Mesh(glowGeo, glowMat));
    const floor = new THREE.Mesh(floorGlowGeo, new THREE.MeshBasicMaterial({ map: floorGlowTex, color: new THREE.Color(0.2, 0.21, 0.16), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    floor.position.set(vd.x + vd.nx * 0.95, 0.004, vd.z + vd.nz * 0.95); floor.rotation.y = vd.rot;
    chunkAt(vd.x, vd.z).root.add(body, floor); vendorGlows.push({ glowMat, floorMat: floor.material, next: 3 + R() * 20, off: 0 });
  }

  const sign = (root, title, subtitle, x, y, z, rot = 0, color = '#a3ffd0', width = 1.9) => {
    const frame = boxMesh(root, bakedColor(0x374a43, x, z), x, y, z, width + 0.08, width * 160 / 512 + 0.08, 0.045);
    frame.rotation.y = rot;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 160 / 512), new THREE.MeshBasicMaterial({ map: TX.signTexture(title, subtitle, color) }));
    face.position.set(x + Math.sin(rot) * 0.028, y, z + Math.cos(rot) * 0.028); face.rotation.y = rot;
    face.userData.noShadow = true; root.add(face);
  };
  if (escape) {
    for (const zone of map.safeZones) {
      const root = chunkAt(zone.x, zone.z).root;
      sign(root, 'SAFE', zone.label, zone.x0 + CELL / 2, 2.47, zone.z1 + 0.12, 0);
      sign(root, 'SAFE', 'GÜVENLİ BÖLGE', zone.x0 + CELL / 2, 2.47, zone.z1 - 0.12, Math.PI);
      sign(root, 'SAFE', zone.label, zone.x1 + 0.12, 2.47, zone.z0 + CELL / 2, Math.PI / 2);
      sign(root, 'SAFE', 'GÜVENLİ BÖLGE', zone.x1 - 0.12, 2.47, zone.z0 + CELL / 2, -Math.PI / 2);
      const { board, bench } = zone;
      boxMesh(root, bakedColor(0x364b40, board.x, board.z + 0.15), board.x, 1.5, board.z, 2.14, 2.39, 0.055);
      const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.25), new THREE.MeshBasicMaterial({ map: TX.sanctuaryMapTexture(map, zone), color: 0xb5c9b7 }));
      boardFace.position.set(board.x, 1.5, board.z + 0.031); boardFace.userData.noShadow = true; root.add(boardFace);
      const wood = bakedColor(0x7c7052, bench.x, bench.z + 0.5), metal = bakedColor(0x384742, bench.x, bench.z + 0.5);
      boxMesh(root, wood, bench.x, 0.44, bench.z, 2.15, 0.12, 0.52);
      boxMesh(root, wood, bench.x, 0.78, bench.z - 0.21, 2.15, 0.48, 0.1);
      for (const dx of [-0.85, 0.85]) boxMesh(root, metal, bench.x + dx, 0.2, bench.z, 0.1, 0.4, 0.46);
      const threshold = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2a6550 }));
      threshold.position.set(zone.x0 + CELL / 2, 0.007, zone.z1); threshold.userData.noShadow = true; root.add(threshold);
    }
    const root = chunkAt(map.exit.x, map.exit.z).root;
    sign(root, 'EXIT / ÇIKIŞ', 'TAHLİYE NOKTASI', map.exit.x, 2.58, map.exit.z, Math.PI, '#b5ffd6', 2.8);
    sign(root, 'EXIT / ÇIKIŞ', 'TAHLİYE NOKTASI', map.exit.x, 2.58, map.exit.z + 0.08, 0, '#b5ffd6', 2.8);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.35, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4ba47b }));
    ring.position.set(map.exit.x, 0.008, map.exit.z); ring.userData.noShadow = true; root.add(ring);
  }
  if (arena) {
    for (const [z, title, subtitle, color] of [[CELL, '01 / YÜKLEME', 'KUZEY KANAT', '#d3dfef'], [size / 2, '02 / DEPO', 'MERKEZ AVLU', '#ffe4a4'], [size - CELL, '03 / SERVİS', 'GÜNEY KANAT', '#c5e6d2']]) {
      const root = chunkAt(size / 2, z).root;
      sign(root, title, subtitle, size / 2, 2.45, z, 0, color, 2.5);
      sign(root, title, subtitle, size / 2, 2.45, z + 0.08, Math.PI, color, 2.5);
    }
    for (const team of [0, 1]) {
      const x = team ? size - CELL : CELL, root = chunkAt(x, size / 2).root;
      sign(root, team ? 'B / BRAVO' : 'A / ALFA', 'EĞİTİM DEPOSU', x, 2.48, size / 2, team ? -Math.PI / 2 : Math.PI / 2, team ? '#f4bd9e' : '#9eccf2', 2.4);
    }
  }

  // Keep Three's normal shadow shader chunks intact. Only genuinely opaque
  // meshes cast shadows; decals, additive floor glows and emissive panels do not.
  group.traverse((object) => {
    if (!object.isMesh || object.userData.noShadow) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every((m) => !m.transparent)) object.castShadow = object.receiveShadow = true;
  });
  const fogColor = arena ? 0x66737b : escape ? 0x040806 : 0x2a2410;
  scene.fog = new THREE.Fog(fogColor, escape ? 10 : arena ? 28 : 14, escape ? 42 : arena ? 66 : 58);
  scene.background = new THREE.Color(fogColor);
  let flickerT = 0;
  return {
    group, sampleLight, crateState, flickers,
    setCrateOpen(i, open, instant) {
      crateState[i].target = open ? 1 : 0;
      if (instant) crateState[i].open = crateState[i].target;
      setCrate(i);
    },
    update(dt, time, viewer = null) {
      if (viewer) {
        const range2 = ((escape ? 44 : 64) + CHUNK) ** 2;
        for (const chunk of chunks.values()) chunk.root.visible = (chunk.x - viewer.x) ** 2 + (chunk.z - viewer.z) ** 2 <= range2;
      }
      for (let i = 0; i < nC; i++) {
        const state = crateState[i];
        if (state.open === state.target) continue;
        state.open += Math.sign(state.target - state.open) * Math.min(Math.abs(state.target - state.open), dt * 4);
        setCrate(i);
      }
      flickerT += dt;
      if (flickerT > 0.03) {
        flickerT = 0;
        for (const fl of flickers) if (time > fl.next) {
          fl.on = !fl.on; fl.next = time + (fl.on ? 0.3 + R() * 3 : 0.03 + R() * 0.15);
          fl.panel.setColorAt(fl.i, fl.on ? ON : col.setRGB(0.3, 0.29, 0.25)); fl.panel.instanceColor.needsUpdate = true;
        }
        for (const g of vendorGlows) {
          if (time > g.next) { g.off = g.off ? 0 : 1; g.next = time + (g.off ? 0.04 + R() * 0.12 : 4 + R() * 25); }
          const k = g.off ? 0.35 : 1;
          g.glowMat.color.setRGB(1.25 * k, 1.25 * k, 1.15 * k); g.floorMat.color.setRGB(0.2 * k, 0.21 * k, 0.16 * k);
        }
      }
    },
  };
}

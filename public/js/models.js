// Procedural models: detailed firearms (profile-extruded), gloved arms, third-person operators.
import * as THREE from 'three';
import { bakeMaterial } from './world.js';

// ---------- materials ----------
export function gunMaterials() {
  const P = (color, specular, shininess) => new THREE.MeshPhongMaterial({ color, specular, shininess });
  return {
    metal: P(0x1d1e21, 0x5a5a5e, 70),
    metal2: P(0x2a2b2e, 0x3a3a3c, 38),
    poly: P(0x19191a, 0x262626, 16),
    wood: P(0x3d2818, 0x2a1a0c, 26),
    bakelite: P(0x3e1a0c, 0x3a1c0e, 40),
    brass: P(0xb38b40, 0xffe2a0, 90),
    dark: P(0x050505, 0x000000, 1),
    dot: new THREE.MeshBasicMaterial({ color: 0xd8f0b8 }),
    glove: P(0x151515, 0x2a2a2a, 12),
    glove2: P(0x2a2a28, 0x222222, 8),
    sleeve: P(0x22252b, 0x16181c, 8),
    cuff: P(0x2d3342, 0x111318, 6),
  };
}

// ---------- geometry helpers (profile space: x forward, y up, z right) ----------
function mkShape(pts, holes) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  if (holes) for (const h of holes) { const p = new THREE.Path(); p.moveTo(h[0][0], h[0][1]); for (let i = 1; i < h.length; i++) p.lineTo(h[i][0], h[i][1]); p.closePath(); s.holes.push(p); }
  return s;
}
function ext(parent, pts, depth, mat, bevel = 0.002, holes = null, z = 0) {
  const d = Math.max(0.001, depth - bevel * 2);
  const g = new THREE.ExtrudeGeometry(mkShape(pts, holes), { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -d / 2 + z);
  const m = new THREE.Mesh(g, mat);
  parent.add(m);
  return m;
}
function cylX(parent, r, x0, x1, y, mat, z = 0, seg = 18, r1 = r) {
  const g = new THREE.CylinderGeometry(r1, r, x1 - x0, seg);
  g.rotateZ(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, z);
  const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
function cylZ(parent, r, len, x, y, z, mat, seg = 14) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2); g.translate(x, y, z);
  const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
function box(parent, w, h, d, x, y, z, mat) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
  const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
function curve(fn, n) { const out = []; for (let i = 0; i <= n; i++) out.push(fn(i / n)); return out; }
const P2L = (x, y, z = 0) => new THREE.Vector3(z, y, -x); // profile → gun local (forward = -Z)

function gunRoot() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.y = Math.PI / 2;
  g.add(inner);
  return [g, inner];
}

// ---------- firearms ----------
function buildPistol(M) {
  const [g, p] = gunRoot();
  const slide = new THREE.Group(); p.add(slide);
  ext(slide, [[-0.036, 0], [0.152, 0], [0.152, 0.026], [0.146, 0.032], [-0.031, 0.032], [-0.036, 0.027]], 0.026, M.metal, 0.002);
  for (let i = 0; i < 6; i++) box(slide, 0.0022, 0.02, 0.0272, -0.03 + i * 0.0045, 0.015, 0, M.metal2);
  box(slide, 0.042, 0.002, 0.017, 0.05, 0.0325, 0, M.metal2);           // ejection port
  box(slide, 0.034, 0.0015, 0.0102, 0.05, 0.0335, 0, M.brass);          // chamber hood
  box(slide, 0.008, 0.007, 0.02, -0.027, 0.0355, 0, M.metal);           // rear sight
  box(slide, 0.004, 0.007, 0.0045, 0.14, 0.0355, 0, M.metal);           // front sight
  box(slide, 0.0012, 0.003, 0.003, 0.14, 0.037, 0, M.dot);
  box(slide, 0.0012, 0.003, 0.003, -0.023, 0.0375, 0.0065, M.dot);
  box(slide, 0.0012, 0.003, 0.003, -0.023, 0.0375, -0.0065, M.dot);
  cylX(slide, 0.0068, 0.148, 0.1535, 0.017, M.metal2);
  cylX(slide, 0.0047, 0.15, 0.1545, 0.017, M.dark);
  ext(p, [[-0.03, -0.019], [0.142, -0.019], [0.142, -0.001], [-0.03, -0.001]], 0.024, M.poly, 0.0015);
  for (let i = 0; i < 3; i++) box(p, 0.006, 0.004, 0.0245, 0.1 + i * 0.013, -0.019, 0, M.poly);
  ext(p, [[-0.047, -0.004], [-0.034, -0.018], [0.03, -0.018], [0.012, -0.112], [0.0, -0.121], [-0.046, -0.121], [-0.058, -0.108], [-0.05, -0.03]], 0.029, M.poly, 0.0035);
  for (let i = 0; i < 5; i++) box(p, 0.0035, 0.005, 0.03, 0.022 - i * 0.004, -0.04 - i * 0.017, 0, M.metal2);
  ext(p, [[0.015, -0.019], [0.074, -0.019], [0.072, -0.04], [0.056, -0.051], [0.019, -0.051]], 0.012, M.poly, 0.001,
    [[[0.022, -0.021], [0.065, -0.021], [0.063, -0.038], [0.052, -0.045], [0.024, -0.045]]]);
  box(p, 0.005, 0.02, 0.007, 0.036, -0.03, 0, M.metal2);
  box(p, 0.05, 0.009, 0.031, -0.024, -0.124, 0, M.poly);
  g.userData = { muzzle: P2L(0.156, 0.017), gripR: P2L(-0.014, -0.06), gripL: P2L(-0.008, -0.07, -0.028), slide, slideAxis: 'x' };
  return g;
}

function buildRifle(M) {
  const [g, p] = gunRoot();
  ext(p, [[-0.07, 0], [0.25, 0], [0.25, 0.05], [0.235, 0.062], [-0.05, 0.064], [-0.07, 0.052]], 0.046, M.metal2, 0.004);
  box(p, 0.3, 0.004, 0.047, 0.09, 0.028, 0, M.metal);  // rivet line
  for (const x of [-0.04, 0.02, 0.2, 0.23]) { cylZ(p, 0.003, 0.049, x, 0.012, 0, M.metal); }
  ext(p, [[-0.068, 0.006], [-0.068, 0.056], [-0.12, 0.05], [-0.43, 0.036], [-0.438, -0.105], [-0.405, -0.11], [-0.21, -0.04], [-0.12, -0.012]], 0.04, M.wood, 0.005);
  box(p, 0.008, 0.15, 0.042, -0.438, -0.034, 0, M.metal);
  ext(p, [[-0.034, 0], [0.01, 0], [-0.028, -0.108], [-0.07, -0.104]], 0.03, M.bakelite, 0.005);
  ext(p, [[0.0, -0.001], [0.085, -0.001], [0.085, -0.009], [0.055, -0.046], [0.0, -0.046], [-0.004, -0.02]], 0.012, M.metal, 0.001,
    [[[0.006, -0.008], [0.07, -0.008], [0.05, -0.04], [0.006, -0.04]]]);
  box(p, 0.005, 0.022, 0.007, 0.03, -0.018, 0, M.metal);
  const front = curve((t) => [0.122 + 0.1 * t * t, -0.255 * t], 10);
  const back = curve((t) => [0.075 + 0.085 * t * t, -0.245 * t], 10).reverse();
  ext(p, [...front, ...back], 0.028, M.bakelite, 0.003);
  for (let i = 1; i < 5; i++) { const t = i / 5; box(p, 0.03, 0.003, 0.03, 0.1 + 0.092 * t * t, -0.25 * t, 0, M.bakelite); }
  box(p, 0.058, 0.012, 0.03, 0.098, 0.004, 0, M.metal);
  ext(p, [[0.25, -0.004], [0.47, -0.004], [0.47, 0.044], [0.25, 0.044]], 0.054, M.wood, 0.009);
  for (let i = 0; i < 3; i++) box(p, 0.05, 0.004, 0.0555, 0.33 + i * 0.03, 0.022 + (i % 2) * 0.004, 0, M.wood);
  ext(p, [[0.262, 0.05], [0.448, 0.05], [0.448, 0.078], [0.262, 0.078]], 0.036, M.wood, 0.009);
  box(p, 0.02, 0.06, 0.03, 0.478, 0.052, 0, M.metal);
  cylX(p, 0.0105, 0.47, 0.665, 0.03, M.metal);
  cylX(p, 0.0036, 0.47, 0.64, 0.012, M.metal);
  box(p, 0.015, 0.045, 0.02, 0.6, 0.052, 0, M.metal);
  box(p, 0.004, 0.012, 0.003, 0.6, 0.08, 0, M.metal);
  box(p, 0.012, 0.018, 0.003, 0.6, 0.078, 0.009, M.metal);
  box(p, 0.012, 0.018, 0.003, 0.6, 0.078, -0.009, M.metal);
  cylX(p, 0.0125, 0.665, 0.7, 0.03, M.metal2, 0, 12);
  cylX(p, 0.007, 0.699, 0.701, 0.03, M.dark, 0, 10);
  ext(p, [[0.2, 0.062], [0.262, 0.062], [0.262, 0.082], [0.215, 0.08]], 0.034, M.metal, 0.002);
  box(p, 0.05, 0.004, 0.014, 0.21, 0.084, 0, M.metal);
  cylZ(p, 0.0055, 0.025, 0.19, 0.046, 0.034, M.metal);
  box(p, 0.11, 0.012, 0.003, 0.06, 0.03, 0.025, M.metal);
  g.userData = { muzzle: P2L(0.705, 0.03), gripR: P2L(-0.03, -0.05), gripL: P2L(0.36, 0.005, -0.006) };
  return g;
}

function buildSMG(M) {
  const [g, p] = gunRoot();
  ext(p, [[-0.1, 0], [0.205, 0], [0.205, 0.062], [-0.1, 0.062]], 0.05, M.metal2, 0.011);
  cylX(p, 0.013, 0.195, 0.345, 0.07, M.metal2);
  cylZ(p, 0.004, 0.026, 0.3, 0.07, -0.024, M.metal);
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.0032, 8, 16), M.metal2);
  hood.rotation.y = Math.PI / 2; hood.position.set(0.33, 0.094, 0); p.add(hood);
  box(p, 0.02, 0.022, 0.012, 0.33, 0.078, 0, M.metal2);
  box(p, 0.003, 0.012, 0.002, 0.33, 0.095, 0, M.metal);
  cylZ(p, 0.012, 0.024, -0.07, 0.083, 0, M.metal2);
  box(p, 0.03, 0.014, 0.03, -0.07, 0.068, 0, M.metal2);
  ext(p, [[0.205, -0.036], [0.345, -0.028], [0.35, 0.046], [0.205, 0.052]], 0.058, M.poly, 0.011);
  for (let i = 0; i < 4; i++) box(p, 0.004, 0.05, 0.06, 0.23 + i * 0.03, 0.01, 0, M.poly);
  cylX(p, 0.0095, 0.34, 0.4, 0.03, M.metal);
  cylX(p, 0.012, 0.37, 0.395, 0.03, M.metal2);
  cylX(p, 0.0065, 0.399, 0.401, 0.03, M.dark, 0, 10);
  const front = curve((t) => [0.108 + 0.04 * t, -0.2 * t], 6);
  const back = curve((t) => [0.07 + 0.035 * t, -0.195 * t], 6).reverse();
  ext(p, [...front, ...back], 0.025, M.metal, 0.003);
  ext(p, [[-0.055, 0.001], [0.085, 0.001], [0.085, -0.016], [0.018, -0.02], [-0.006, -0.112], [-0.048, -0.112], [-0.056, -0.022]], 0.034, M.poly, 0.005,
    [[[0.004, -0.018], [0.05, -0.018], [0.05, -0.036], [0.012, -0.036]]]);
  box(p, 0.005, 0.018, 0.007, 0.028, -0.02, 0, M.metal);
  ext(p, [[-0.1, 0.056], [-0.38, 0.046], [-0.388, -0.085], [-0.35, -0.092], [-0.1, -0.006]], 0.038, M.poly, 0.008,
    [[[-0.14, 0.03], [-0.3, 0.025], [-0.3, -0.03], [-0.14, 0.005]]]);
  box(p, 0.01, 0.14, 0.04, -0.388, -0.02, 0, M.metal2);
  g.userData = { muzzle: P2L(0.405, 0.03), gripR: P2L(-0.028, -0.055), gripL: P2L(0.27, -0.004, -0.006) };
  return g;
}

function buildShotgun(M) {
  const [g, p] = gunRoot();
  ext(p, [[-0.08, 0], [0.14, 0], [0.14, 0.076], [-0.06, 0.076], [-0.08, 0.062]], 0.044, M.metal, 0.003);
  box(p, 0.08, 0.026, 0.002, 0.04, 0.045, 0.0225, M.dark);    // ejection port
  cylX(p, 0.012, 0.14, 0.71, 0.058, M.metal, 0, 18);
  box(p, 0.55, 0.004, 0.008, 0.43, 0.071, 0, M.metal2);
  cylX(p, 0.0082, 0.709, 0.711, 0.058, M.dark, 0, 12);
  cylX(p, 0.013, 0.14, 0.6, 0.024, M.metal2);
  cylX(p, 0.0142, 0.6, 0.625, 0.024, M.metal, 0, 14);
  box(p, 0.02, 0.05, 0.03, 0.59, 0.042, 0, M.metal);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), M.brass);
  bead.position.set(0.695, 0.073, 0); p.add(bead);
  const pump = new THREE.Group(); p.add(pump);
  ext(pump, [[0.2, 0.0], [0.4, 0.0], [0.4, 0.048], [0.2, 0.048]], 0.058, M.poly, 0.012);
  for (let i = 0; i < 8; i++) box(pump, 0.006, 0.05, 0.0625, 0.215 + i * 0.024, 0.024, 0, M.dark);
  ext(p, [[-0.08, 0.062], [-0.08, 0.0], [-0.115, -0.03], [-0.16, -0.06], [-0.48, -0.125], [-0.488, 0.01], [-0.46, 0.036], [-0.14, 0.056]], 0.042, M.wood, 0.005);
  box(p, 0.022, 0.16, 0.046, -0.495, -0.05, 0, M.dark);
  ext(p, [[0.0, 0.001], [0.085, 0.001], [0.085, -0.008], [0.055, -0.045], [0.0, -0.045], [-0.004, -0.02]], 0.012, M.metal, 0.001,
    [[[0.006, -0.008], [0.07, -0.008], [0.05, -0.039], [0.006, -0.039]]]);
  box(p, 0.005, 0.022, 0.007, 0.03, -0.018, 0, M.metal);
  g.userData = { muzzle: P2L(0.715, 0.058), gripR: P2L(-0.1, -0.03), gripL: P2L(0.3, 0.0, -0.006), pump, slideAxis: 'x' };
  return g;
}

const BUILDERS = { pistol: buildPistol, smg: buildSMG, shotgun: buildShotgun, rifle: buildRifle };
export function buildGun(type, M) { return BUILDERS[type](M); }

// ---------- merging (third-person: 1 draw call per rigid part) ----------
function mergeToVertexColors(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pos = [], nor = [], col = [];
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), c = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    m.multiplyMatrices(inv, o.matrixWorld); nm.getNormalMatrix(m);
    c.copy(o.material.color);
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const gunGeoCache = {};
export function mergedGunGeometry(type) {
  if (!gunGeoCache[type]) {
    const M = gunMaterials();
    const gun = buildGun(type, M);
    const geo = mergeToVertexColors(gun);
    gunGeoCache[type] = { geo, data: gun.userData };
  }
  return gunGeoCache[type];
}

// ---------- limbs ----------
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
// orient a unit-length Y-axis mesh between points a and b (in the mesh parent's space)
export function spanBetween(mesh, a, b) {
  tmpV.subVectors(b, a);
  const len = tmpV.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, tmpV.divideScalar(len || 1));
  mesh.scale.set(1, len, 1);
}
function limbGeo(r0, r1, seg = 12) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, seg, 1, false);
  return g;
}

// Gloved hand gripping (fist) oriented along local -Y (fingers wrap around +Z)
function fistGeometry(M) {
  const grp = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.07), M.glove);
  grp.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.038, 3, 8), M.glove);
    f.rotation.z = Math.PI / 2;
    f.position.set(0.026, 0.033 - i * 0.022, 0.02);
    grp.add(f);
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.03), M.glove2);
    k.position.set(0.018, 0.033 - i * 0.022, 0.028);
    grp.add(k);
  }
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.04, 3, 8), M.glove);
  th.position.set(0.02, 0.04, -0.032); th.rotation.set(0.4, 0, 1.2);
  grp.add(th);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.05, 12), M.glove2);
  cuff.rotation.x = Math.PI / 2; cuff.position.set(-0.004, 0.0, -0.07);
  grp.add(cuff);
  return grp;
}

// First-person arms attached to a viewmodel gun
export class FPArms {
  constructor(M) {
    this.group = new THREE.Group();
    const up = limbGeo(0.052, 0.046), fore = limbGeo(0.043, 0.035);
    this.rU = new THREE.Mesh(up, M.sleeve); this.rF = new THREE.Mesh(fore, M.sleeve);
    this.lU = new THREE.Mesh(up, M.sleeve); this.lF = new THREE.Mesh(fore, M.sleeve);
    this.rH = fistGeometry(M); this.lH = fistGeometry(M);
    this.lH.scale.x = -1;
    this.group.add(this.rU, this.rF, this.lU, this.lF, this.rH, this.lH);
    this.shR = new THREE.Vector3(0.21, -0.36, 0.02);
    this.shL = new THREE.Vector3(-0.24, -0.38, 0.0);
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); this.e = new THREE.Vector3(); this.wrist = new THREE.Vector3();
    this.back = new THREE.Vector3();
  }
  // gun: viewmodel gun group (same parent space as this.group)
  update(gun, type) {
    const d = gun.userData;
    gun.updateMatrix();
    const q = gun.quaternion;
    // right hand
    const hR = this.a.copy(d.gripR).applyMatrix4(gun.matrix);
    this.rH.position.copy(hR);
    this.rH.quaternion.copy(q).multiply(tmpQ.setFromEuler(new THREE.Euler(type === 'pistol' || type === 'shotgun' ? -0.25 : -0.3, 0, 0)));
    this.wrist.set(-0.006, 0, 0.075).applyQuaternion(this.rH.quaternion).add(hR);
    this.limb(this.shR, this.wrist, this.rU, this.rF, 1);
    // left (support) hand
    const hL = this.b.copy(d.gripL).applyMatrix4(gun.matrix);
    this.lH.position.copy(hL);
    if (type === 'pistol') {
      this.lH.quaternion.copy(q).multiply(tmpQ.setFromEuler(new THREE.Euler(-0.25, 0, 0.35)));
      this.back.set(0.02, -0.02, 0.075);
    } else {
      this.lH.quaternion.copy(q).multiply(tmpQ.setFromEuler(new THREE.Euler(Math.PI / 2 - 0.2, 0.0, -1.25)));
      this.back.set(-0.03, 0.02, 0.07);
    }
    this.wrist.copy(this.back).applyQuaternion(this.lH.quaternion).add(hL);
    this.limb(this.shL, this.wrist, this.lU, this.lF, -1);
  }
  limb(sh, hand, upper, fore, side) {
    const e = this.e.addVectors(sh, hand).multiplyScalar(0.5);
    e.x += side * 0.07; e.y -= 0.1;
    spanBetween(upper, sh, e);
    spanBetween(fore, e, hand);
  }
}

// ---------- third-person operator ----------
function part(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
}
const soldierGeoCache = {};
function soldierGeometries() {
  if (soldierGeoCache.torso) return soldierGeoCache;
  const tmp = new THREE.Group();
  const mat = (c) => new THREE.MeshBasicMaterial({ color: c });
  const VEST = 0xffffff; // tinted per player via vertex color white → replaced below
  // torso: shirt + plate carrier + pouches + bodycam
  const t = new THREE.Group(); tmp.add(t);
  part(new THREE.CapsuleGeometry(0.19, 0.3, 4, 12).scale(1.12, 1, 0.75), mat(0x1e2431), t, 0, 0.3, 0);
  part(new THREE.BoxGeometry(0.3, 0.34, 0.12), mat(0x2b2e24), t, 0, 0.33, 0.2);   // assault pack
  part(new THREE.BoxGeometry(0.06, 0.12, 0.05), mat(0x151515), t, 0.13, 0.52, 0.2);   // radio
  part(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), mat(0x111111), t, 0.13, 0.72, 0.2);
  part(new THREE.BoxGeometry(0.42, 0.4, 0.31), mat(VEST), t, 0, 0.33, 0);
  for (let i = -1; i <= 1; i++) part(new THREE.BoxGeometry(0.09, 0.11, 0.05), mat(0xeeeeee), t, i * 0.11, 0.22, -0.175);
  part(new THREE.BoxGeometry(0.07, 0.09, 0.035), mat(0x111111), t, 0.08, 0.45, -0.172);
  part(new THREE.BoxGeometry(0.02, 0.02, 0.01), mat(0xff2020), t, 0.1, 0.48, -0.192);
  part(new THREE.BoxGeometry(0.3, 0.06, 0.24), mat(0x2b2b25), t, 0, 0.02, 0);   // belt
  // head: balaclava + helmet + goggles
  const h = new THREE.Group(); tmp.add(h);
  part(new THREE.SphereGeometry(0.11, 16, 12).scale(0.95, 1.1, 1), mat(0x1a1a1a), h, 0, 0.1, 0);
  part(new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.9), mat(0x3b3f36), h, 0, 0.13, 0.005);
  part(new THREE.BoxGeometry(0.17, 0.045, 0.06), mat(0x0a0a0a), h, 0, 0.11, -0.09);
  part(new THREE.BoxGeometry(0.2, 0.012, 0.02), mat(0x222222), h, 0, 0.11, -0.06);
  const pelvis = new THREE.Group(); tmp.add(pelvis);
  part(new THREE.BoxGeometry(0.36, 0.2, 0.24), mat(0x262a2f), pelvis, 0, -0.02, 0);
  const merge = (grp) => { const g = mergeToVertexColors(grp); return g; };
  soldierGeoCache.torso = merge(t);
  soldierGeoCache.head = merge(h);
  soldierGeoCache.pelvis = merge(pelvis);
  const leg = new THREE.Group();
  part(new THREE.CylinderGeometry(0.095, 0.078, 1, 10).translate(0, -0.5, 0), mat(0x262a2f), leg);
  soldierGeoCache.thigh = merge(leg);
  const shin = new THREE.Group();
  part(new THREE.CylinderGeometry(0.076, 0.06, 0.42, 10).translate(0, -0.21, 0), mat(0x262a2f), shin);
  part(new THREE.SphereGeometry(0.075, 8, 6).scale(1, 0.8, 0.7).translate(0, 0, -0.06), mat(0x1a1a1a), shin);   // knee pad
  part(new THREE.BoxGeometry(0.11, 0.1, 0.26).translate(0, -0.44, -0.04), mat(0x15130f), shin);
  soldierGeoCache.shin = merge(shin);
  const arm = new THREE.Group();
  part(new THREE.CylinderGeometry(0.058, 0.064, 1, 10), mat(0x1e2431), arm);
  soldierGeoCache.arm = merge(arm);
  const hand = new THREE.Group();
  part(new THREE.SphereGeometry(0.045, 10, 8).scale(0.8, 1, 1.2), mat(0x151515), hand);
  soldierGeoCache.hand = merge(hand);
  return soldierGeoCache;
}

export class Soldier {
  constructor(color, weapon) {
    const G = soldierGeometries();
    this.mat = bakeMaterial({ vertexColors: true, color: 0xffffff, shininess: 12, specular: 0x111111 }, { uniform: true, phong: true });
    const vest = new THREE.Color(color);
    // per-player vest tint: separate material for the vest-colored vertices would cost a draw call;
    // instead we recolor white vertices of a cloned torso geometry.
    const torsoGeo = G.torso.clone();
    const cattr = torsoGeo.attributes.color;
    for (let i = 0; i < cattr.count; i++) {
      const r = cattr.getX(i);
      if (r > 0.99) cattr.setXYZ(i, vest.r, vest.g, vest.b);
      else if (r > 0.8) cattr.setXYZ(i, vest.r * 0.8, vest.g * 0.8, vest.b * 0.8);
    }
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    this.pelvis = part(G.pelvis, this.mat, this.body, 0, 0.95, 0);
    this.spine = new THREE.Group(); this.spine.position.set(0, 0.97, 0); this.body.add(this.spine);
    this.torso = part(torsoGeo, this.mat, this.spine, 0, 0, 0);
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.56, 0); this.spine.add(this.neck);
    this.head = part(G.head, this.mat, this.neck, 0, 0, 0);
    this.legs = [-1, 1].map((s) => {
      const hip = new THREE.Group(); hip.position.set(0.11 * s, 0.92, 0); this.body.add(hip);
      const thigh = part(G.thigh, this.mat, hip); thigh.scale.y = 0.46;
      const knee = new THREE.Group(); knee.position.set(0, -0.46, 0); hip.add(knee);
      part(G.shin, this.mat, knee);
      return { hip, knee };
    });
    this.aim = new THREE.Group(); this.aim.position.set(0.0, 0.42, -0.02); this.spine.add(this.aim);
    this.arms = [0, 1].map(() => ({ u: part(G.arm, this.mat, this.spine), f: part(G.arm, this.mat, this.spine), h: part(G.hand, this.mat, this.spine) }));
    this.flash = null;
    this.gun = null; this.gunType = null;
    this.setWeapon(weapon || 'pistol');
    this.phase = 0; this.deadT = 0;
    this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3();
    // flashlight beam (cheap additive cone)
    const cone = new THREE.ConeGeometry(0.9, 7, 16, 1, true); cone.translate(0, -3.5, 0); cone.rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    this.beam.visible = false;
  }
  setWeapon(type) {
    if (this.gunType === type) return;
    if (this.gun) this.aim.remove(this.gun);
    const { geo, data } = mergedGunGeometry(type);
    this.gun = new THREE.Mesh(geo, this.mat);
    this.gun.userData = data;
    this.gunType = type;
    const pistol = type === 'pistol';
    this.gun.position.set(pistol ? 0.0 : 0.09, pistol ? 0.0 : -0.02, pistol ? -0.36 : -0.12);
    this.aim.add(this.gun);
    if (this.beam) { this.gun.add(this.beam); this.beam.position.copy(data.muzzle); }
  }
  muzzleWorld(out) { return out.copy(this.gun.userData.muzzle).applyMatrix4(this.gun.matrixWorld); }
  flinch(k) { this.flinchK = Math.min(1.2, (this.flinchK || 0) + 0.5 + k); this.flinchDir = Math.random() < 0.5 ? -1 : 1; }
  // s: {yaw, pitch, crouch, speed, alive, flash, lean}
  update(dt, s, light) {
    this.mat.userData.uLight.value.setRGB(light, light * 0.96, light * 0.85);
    this.beam.visible = !!s.flash && s.alive;
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
    const cr = s.crouch ? 1 : 0;
    this.cr = (this.cr ?? cr) + (cr - (this.cr ?? cr)) * Math.min(1, dt * 10);
    const c = this.cr;
    this.phase += dt * s.speed * 2.2;
    const sw = Math.min(1, s.speed / 3) * 0.55;
    // crouch: thighs forward, knees bent back; drop keeps boots on the carpet
    const drop = c * 0.4;
    const fk = (this.flinchK = Math.max(0, (this.flinchK || 0) - dt * 5));
    const lean = s.lean || 0;
    this.pelvis.position.y = 0.95 - drop;
    this.spine.position.y = 0.97 - drop + Math.abs(Math.sin(this.phase)) * 0.025 * sw;
    // rotation.x > 0 tilts up/back; the gun's total pitch (spine + aim) equals the view pitch
    this.spine.rotation.x = s.pitch * 0.3 - c * 0.22 + fk * 0.22;
    this.spine.rotation.z = -lean * 0.36 + fk * 0.12 * (this.flinchDir || 1);
    this.neck.rotation.x = s.pitch * 0.4 + fk * 0.3;
    this.neck.rotation.z = lean * 0.15;
    this.aim.rotation.x = s.pitch * 0.7 + c * 0.22 - fk * 0.2;
    this.legs.forEach((l, i) => {
      const ph = Math.sin(this.phase + i * Math.PI) * sw;
      l.hip.position.y = 0.92 - drop;
      l.hip.rotation.x = ph + c * 1.1;
      l.knee.rotation.x = -(Math.max(0, -Math.cos(this.phase + i * Math.PI)) * sw * 1.2 + c * 2.0);
    });
    // arms to gun grips (spine space)
    this.spine.updateMatrixWorld(true);
    const inv = this.v3;
    const gm = this.gun.matrixWorld, sInv = new THREE.Matrix4().copy(this.spine.matrixWorld).invert();
    const d = this.gun.userData;
    [[d.gripR, 0.23], [d.gripL, -0.23]].forEach(([g, sx], i) => {
      const a = this.arms[i];
      const hand = this.v1.copy(g).applyMatrix4(gm).applyMatrix4(sInv);
      const sh = this.v2.set(sx, 0.5, 0.02);
      const e = inv.addVectors(sh, hand).multiplyScalar(0.5); e.x += Math.sign(sx) * 0.09; e.y -= 0.12;
      spanBetween(a.u, sh, e); spanBetween(a.f, e, hand);
      a.h.position.copy(hand);
    });
    // death animation
    if (!s.alive) {
      this.deadT = Math.min(1, this.deadT + dt * 2.5);
      const k = this.deadT;
      this.body.rotation.x = -k * k * 1.45;
      this.body.position.y = k * 0.12;
    } else { this.deadT = 0; this.body.rotation.x = 0; this.body.position.y = 0; }
  }
}

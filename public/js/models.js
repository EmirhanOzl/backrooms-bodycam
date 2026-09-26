// Procedural models: detailed firearms (profile-extruded) with animated parts, knife, grenade,
// gloved first-person arms with hand targets, and third-person operators.
import * as THREE from 'three';
import { bakeMaterial } from './world.js';

// ---------- materials ----------
export function gunMaterials() {
  const P = (color, specular, shininess) => new THREE.MeshPhongMaterial({ color, specular, shininess });
  return {
    metal: P(0x1d1e21, 0x5a5a5e, 70),
    metal2: P(0x2a2b2e, 0x3a3a3c, 38),
    steel: P(0x8d9196, 0xffffff, 110),
    poly: P(0x19191a, 0x262626, 16),
    fde: P(0x6b5a40, 0x2a2418, 14),
    green: P(0x2e3527, 0x1c2016, 14),
    olive: P(0x3a4428, 0x2a2e1c, 24),
    wood: P(0x3d2818, 0x2a1a0c, 26),
    bakelite: P(0x3e1a0c, 0x3a1c0e, 40),
    rubber: P(0x121212, 0x151515, 6),
    brass: P(0xb38b40, 0xffe2a0, 90),
    dark: P(0x050505, 0x000000, 1),
    glass: new THREE.MeshPhongMaterial({ color: 0x0c1a24, specular: 0x9fc4ff, shininess: 140, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
    dot: new THREE.MeshBasicMaterial({ color: 0xd8f0b8 }),
    red: new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 0.5, 0.35) }),
    glove: P(0x151515, 0x2a2a2a, 12),
    glove2: P(0x2a2a28, 0x222222, 8),
    sleeve: P(0x22252b, 0x16181c, 8),
    cuff: P(0x2d3342, 0x111318, 6),
    watch: P(0x0e0e0e, 0x555555, 60),
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
function cylX(parent, r, x0, x1, y, mat, z = 0, seg = 18, r1 = r, open = false) {
  const g = new THREE.CylinderGeometry(r1, r, x1 - x0, seg, 1, open);
  g.rotateZ(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, z);
  const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
function cylZ(parent, r, len, x, y, z, mat, seg = 14) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2); g.translate(x, y, z);
  const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
function cylY(parent, r, len, x, y, z, mat, seg = 14) {
  const g = new THREE.CylinderGeometry(r, r, len, seg); g.translate(x, y, z);
  const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
function box(parent, w, h, d, x, y, z, mat) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
  const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
function disc(parent, r, x, y, mat, z = 0) {
  const g = new THREE.CircleGeometry(r, 20); g.rotateY(Math.PI / 2); g.translate(x, y, z);
  const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
function grp(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
function curve(fn, n) { const out = []; for (let i = 0; i <= n; i++) out.push(fn(i / n)); return out; }
const P2L = (x, y, z = 0) => new THREE.Vector3(z, y, -x); // profile → gun local (forward = -Z)
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);     // profile-space point (for part-local anchors)

function gunRoot() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.y = Math.PI / 2;
  g.add(inner);
  return [g, inner];
}
function triggerGroup(p, M, x0 = 0.0) {
  ext(p, [[x0, -0.001], [x0 + 0.085, -0.001], [x0 + 0.085, -0.009], [x0 + 0.055, -0.046], [x0, -0.046], [x0 - 0.004, -0.02]], 0.012, M.metal, 0.001,
    [[[x0 + 0.006, -0.008], [x0 + 0.07, -0.008], [x0 + 0.05, -0.04], [x0 + 0.006, -0.04]]]);
  box(p, 0.005, 0.022, 0.007, x0 + 0.03, -0.018, 0, M.metal);
}
// curved box magazine (profile space) inside group `m`
function curvedMag(m, M, mat, x0f, x0b, bend, h, depth, ribs = 4) {
  const front = curve((t) => [x0f + bend * t * t, -h * t], 10);
  const back = curve((t) => [x0b + bend * 0.85 * t * t, -h * 0.97 * t], 10).reverse();
  ext(m, [...front, ...back], depth, mat, 0.003);
  for (let i = 1; i < ribs + 1; i++) { const t = i / (ribs + 1); box(m, (x0f - x0b) * 1.02, 0.003, depth + 0.002, (x0f + x0b) / 2 + bend * 0.92 * t * t, -h * t, 0, mat); }
}

// ---------- firearms ----------
function buildPistol(M) {
  const [g, p] = gunRoot();
  const slide = grp(p);
  ext(slide, [[-0.036, 0], [0.152, 0], [0.152, 0.026], [0.146, 0.032], [-0.031, 0.032], [-0.036, 0.027]], 0.026, M.metal, 0.002);
  for (let i = 0; i < 6; i++) box(slide, 0.0022, 0.02, 0.0272, -0.03 + i * 0.0045, 0.015, 0, M.metal2);
  box(slide, 0.042, 0.002, 0.017, 0.05, 0.0325, 0, M.metal2);           // ejection port
  box(slide, 0.034, 0.0015, 0.0102, 0.05, 0.0335, 0, M.brass);          // chamber hood
  box(slide, 0.008, 0.004, 0.02, -0.027, 0.034, 0, M.metal);            // rear sight base
  box(slide, 0.008, 0.005, 0.0072, -0.027, 0.0365, 0.0064, M.metal);    // rear sight ears (notch between)
  box(slide, 0.008, 0.005, 0.0072, -0.027, 0.0365, -0.0064, M.metal);
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
  box(p, 0.004, 0.006, 0.031, -0.004, -0.022, 0, M.metal2);            // mag release
  const mag = grp(p);
  ext(mag, [[-0.04, -0.03], [0.004, -0.03], [-0.012, -0.118], [-0.048, -0.118]], 0.022, M.metal, 0.001);
  box(mag, 0.05, 0.009, 0.031, -0.024, -0.124, 0, M.poly);
  g.userData = {
    cls: 'pistol', muzzle: P2L(0.156, 0.017), gripR: P2L(-0.014, -0.06), gripL: P2L(-0.008, -0.07, -0.028), sight: P2L(0.14, 0.039),
    eject: P2L(0.05, 0.036, 0.012), slide, mag, magDir: [-0.19, -0.98], magAnchor: V(-0.026, -0.127), rack: V(-0.025, 0.018, -0.013),
  };
  return g;
}

function buildRevolver(M) {
  const [g, p] = gunRoot();
  ext(p, [[-0.034, -0.012], [0.058, -0.012], [0.058, 0.044], [0.0, 0.05], [-0.024, 0.05], [-0.04, 0.03]], 0.03, M.metal, 0.003,
    [[[0.002, 0.004], [0.048, 0.004], [0.048, 0.04], [0.002, 0.04]]]);
  cylX(p, 0.0095, 0.058, 0.215, 0.031, M.metal, 0, 18);
  box(p, 0.157, 0.006, 0.012, 0.137, 0.042, 0, M.metal2);               // top rib
  ext(p, [[0.058, 0.024], [0.212, 0.024], [0.212, 0.004], [0.2, -0.004], [0.058, -0.004]], 0.019, M.metal, 0.002); // full underlug
  cylX(p, 0.0045, 0.214, 0.216, 0.031, M.dark, 0, 12);
  ext(p, [[0.196, 0.045], [0.212, 0.045], [0.212, 0.055], [0.204, 0.055]], 0.004, M.metal, 0.0005);
  box(p, 0.003, 0.004, 0.0035, 0.21, 0.053, 0, M.red);
  box(p, 0.012, 0.004, 0.018, -0.018, 0.052, 0, M.metal);                // rear sight base
  box(p, 0.012, 0.0045, 0.0062, -0.018, 0.0555, 0.0059, M.metal);
  box(p, 0.012, 0.0045, 0.0062, -0.018, 0.0555, -0.0059, M.metal);
  const hammer = grp(p, -0.03, 0.04, 0);
  ext(hammer, [[0.0, -0.004], [0.006, -0.004], [0.004, 0.012], [-0.012, 0.02], [-0.014, 0.016], [-0.004, 0.006]], 0.008, M.metal2, 0.001);
  // cylinder on a swing-out crane (pivot below-left of the bore axis)
  const crane = grp(p, 0.025, 0.006, -0.011);
  const cyl = grp(crane, 0, 0.017, 0.011);
  cylX(cyl, 0.021, -0.022, 0.022, 0, M.metal2, 0, 6);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + Math.PI / 6;
    box(cyl, 0.03, 0.004, 0.007, 0, Math.sin(a) * 0.02, Math.cos(a) * 0.02, M.dark).rotation.x = -a;
    cylX(cyl, 0.0048, 0.0215, 0.0225, Math.sin(a + Math.PI / 6) * 0.0125, M.dark, Math.cos(a + Math.PI / 6) * 0.0125, 10);
    cylX(cyl, 0.0052, -0.0225, -0.0215, Math.sin(a + Math.PI / 6) * 0.0125, M.brass, Math.cos(a + Math.PI / 6) * 0.0125, 10);
  }
  box(crane, 0.03, 0.006, 0.006, 0, 0.002, 0.003, M.metal);
  ext(p, [[-0.034, 0.02], [-0.004, -0.004], [-0.008, -0.024], [-0.028, -0.09], [-0.058, -0.094], [-0.068, -0.075], [-0.058, -0.02]], 0.033, M.rubber, 0.006);
  for (let i = 0; i < 4; i++) box(p, 0.004, 0.012, 0.0345, -0.018 - i * 0.008, -0.03 - i * 0.014, 0, M.poly);
  triggerGroup(p, M, -0.005);
  g.userData = {
    cls: 'revolver', muzzle: P2L(0.22, 0.031), gripR: P2L(-0.03, -0.048), gripL: P2L(-0.024, -0.058, -0.03), sight: P2L(0.206, 0.0572),
    eject: P2L(0.025, 0.02, -0.02), hammer, crane, cyl, magAnchor: V(-0.022, 0.0, -0.012),
  };
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
  triggerGroup(p, M, 0);
  box(p, 0.02, 0.012, 0.032, 0.056, -0.003, 0, M.metal);                 // mag catch
  const mag = grp(p);
  curvedMag(mag, M, M.bakelite, 0.122, 0.075, 0.1, 0.255, 0.028);
  box(mag, 0.058, 0.012, 0.03, 0.098, 0.004, 0, M.metal);
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
  box(p, 0.05, 0.004, 0.0048, 0.21, 0.084, 0.0047, M.metal);             // rear leaf (notch in the middle)
  box(p, 0.05, 0.004, 0.0048, 0.21, 0.084, -0.0047, M.metal);
  box(p, 0.05, 0.002, 0.014, 0.21, 0.081, 0, M.metal);
  box(p, 0.11, 0.012, 0.003, 0.06, 0.03, 0.025, M.metal);
  const charge = grp(p);
  cylZ(charge, 0.0055, 0.025, 0.19, 0.046, 0.034, M.metal);
  box(charge, 0.08, 0.008, 0.004, 0.155, 0.046, 0.024, M.metal);
  g.userData = {
    cls: 'rifle', muzzle: P2L(0.705, 0.03), gripR: P2L(-0.03, -0.05), gripL: P2L(0.36, 0.005, -0.006), sight: P2L(0.6, 0.086),
    eject: P2L(0.1, 0.06, 0.024), mag, magDir: [0.25, -0.97], magRot: 0.5, magAnchor: V(0.18, -0.23), charge, rack: V(0.19, 0.046, 0.05),
  };
  return g;
}

function buildM4(M) {
  const [g, p] = gunRoot();
  ext(p, [[-0.07, -0.022], [0.125, -0.022], [0.125, 0.02], [-0.07, 0.02]], 0.036, M.metal2, 0.003);         // lower
  ext(p, [[0.035, -0.022], [0.108, -0.022], [0.103, -0.062], [0.04, -0.062]], 0.034, M.metal2, 0.003);       // mag well
  ext(p, [[-0.072, 0.02], [0.2, 0.02], [0.2, 0.058], [-0.06, 0.058], [-0.072, 0.048]], 0.033, M.metal, 0.003); // upper
  box(p, 0.27, 0.008, 0.022, 0.065, 0.062, 0, M.metal2);                                                     // top rail
  for (let i = 0; i < 18; i++) box(p, 0.006, 0.004, 0.023, -0.064 + i * 0.015, 0.066, 0, M.metal);
  box(p, 0.06, 0.02, 0.002, 0.075, 0.042, 0.0172, M.dark);                                                    // ejection port
  cylZ(p, 0.006, 0.02, 0.0, 0.045, 0.022, M.metal);                                                           // forward assist
  const charge = grp(p);
  box(charge, 0.03, 0.008, 0.03, -0.085, 0.052, 0, M.metal);
  box(charge, 0.012, 0.008, 0.05, -0.095, 0.052, 0, M.metal);
  // handguard (M-LOK slots) + barrel, gas block, birdcage
  ext(p, [[0.2, -0.008], [0.47, -0.008], [0.47, 0.058], [0.2, 0.058]], 0.052, M.poly, 0.013);
  for (let i = 0; i < 5; i++) { box(p, 0.03, 0.009, 0.053, 0.235 + i * 0.047, 0.03, 0, M.dark); }
  box(p, 0.27, 0.007, 0.022, 0.335, 0.062, 0, M.metal2);
  cylX(p, 0.0085, 0.47, 0.57, 0.026, M.metal);
  box(p, 0.024, 0.03, 0.024, 0.49, 0.03, 0, M.metal);
  cylX(p, 0.0105, 0.57, 0.612, 0.026, M.metal2, 0, 10);
  for (let i = 0; i < 3; i++) box(p, 0.02, 0.003, 0.022, 0.595, 0.026 + (i - 1) * 0.007, 0, M.dark);
  cylX(p, 0.005, 0.611, 0.613, 0.026, M.dark, 0, 10);
  // stock: buffer tube + collapsible stock
  cylX(p, 0.014, -0.26, -0.07, 0.036, M.metal2, 0, 14);
  ext(p, [[-0.17, 0.056], [-0.3, 0.056], [-0.312, -0.075], [-0.285, -0.08], [-0.2, -0.0], [-0.17, 0.016]], 0.042, M.poly, 0.006);
  box(p, 0.012, 0.14, 0.045, -0.31, -0.01, 0, M.rubber);
  ext(p, [[-0.03, -0.022], [0.006, -0.022], [-0.018, -0.118], [-0.057, -0.112]], 0.03, M.poly, 0.005);        // grip
  triggerGroup(p, M, 0.0);
  box(p, 0.008, 0.006, 0.006, 0.02, 0.0, -0.02, M.metal);                                                    // bolt catch
  const mag = grp(p);
  curvedMag(mag, M, M.metal2, 0.1, 0.043, 0.035, 0.2, 0.024);
  box(mag, 0.064, 0.01, 0.028, 0.089, -0.203, 0, M.poly);
  // red dot (T-1 style) on the rail: sight axis y = 0.108
  ext(p, [[0.012, 0.068], [0.075, 0.068], [0.07, 0.084], [0.017, 0.084]], 0.02, M.metal, 0.002);
  cylX(p, 0.0175, 0.018, 0.074, 0.108, M.metal, 0, 20, 0.0175, true);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0175, 0.0035, 8, 20), M.metal); ring.rotation.y = Math.PI / 2; ring.position.set(0.074, 0.108, 0); p.add(ring);
  const ring2 = ring.clone(); ring2.position.x = 0.018; p.add(ring2);
  cylY(p, 0.006, 0.014, 0.046, 0.128, 0, M.metal);
  cylZ(p, 0.006, 0.014, 0.046, 0.108, 0.02, M.metal);
  disc(p, 0.0172, 0.072, 0.108, M.glass);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0009, 10), M.red); dot.rotation.y = -Math.PI / 2; dot.position.set(0.0705, 0.108, 0); p.add(dot);
  g.userData = {
    cls: 'm4', muzzle: P2L(0.615, 0.026), gripR: P2L(-0.03, -0.055), gripL: P2L(0.34, 0.0, -0.006), sight: P2L(0.07, 0.108),
    eject: P2L(0.08, 0.045, 0.02), mag, magDir: [0.08, -1], magAnchor: V(0.09, -0.21), charge, rack: V(-0.095, 0.052, 0.0), catchPt: V(0.02, 0.0, -0.028), redDot: true,
  };
  return g;
}

function buildSMG(M) {
  const [g, p] = gunRoot();
  ext(p, [[-0.1, 0], [0.205, 0], [0.205, 0.062], [-0.1, 0.062]], 0.05, M.metal2, 0.011);
  cylX(p, 0.013, 0.195, 0.345, 0.07, M.metal2);
  const charge = grp(p);
  cylZ(charge, 0.004, 0.026, 0.3, 0.07, -0.024, M.metal);
  box(charge, 0.006, 0.006, 0.01, 0.3, 0.07, -0.036, M.metal);
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.0032, 8, 16), M.metal2);
  hood.rotation.y = Math.PI / 2; hood.position.set(0.33, 0.094, 0); p.add(hood);
  box(p, 0.02, 0.022, 0.012, 0.33, 0.078, 0, M.metal2);
  box(p, 0.003, 0.012, 0.002, 0.33, 0.088, 0, M.metal);
  const aperture = new THREE.Mesh(new THREE.TorusGeometry(0.0075, 0.0045, 8, 18), M.metal2);
  aperture.rotation.y = Math.PI / 2; aperture.position.set(-0.07, 0.094, 0); p.add(aperture);
  box(p, 0.016, 0.02, 0.026, -0.07, 0.074, 0, M.metal2);
  box(p, 0.03, 0.014, 0.03, -0.07, 0.068, 0, M.metal2);
  ext(p, [[0.205, -0.036], [0.345, -0.028], [0.35, 0.046], [0.205, 0.052]], 0.058, M.poly, 0.011);
  for (let i = 0; i < 4; i++) box(p, 0.004, 0.05, 0.06, 0.23 + i * 0.03, 0.01, 0, M.poly);
  cylX(p, 0.0095, 0.34, 0.4, 0.03, M.metal);
  cylX(p, 0.012, 0.37, 0.395, 0.03, M.metal2);
  cylX(p, 0.0065, 0.399, 0.401, 0.03, M.dark, 0, 10);
  const mag = grp(p);
  curvedMag(mag, M, M.metal, 0.108, 0.07, 0.04, 0.2, 0.025, 3);
  ext(p, [[-0.055, 0.001], [0.085, 0.001], [0.085, -0.016], [0.018, -0.02], [-0.006, -0.112], [-0.048, -0.112], [-0.056, -0.022]], 0.034, M.poly, 0.005,
    [[[0.004, -0.018], [0.05, -0.018], [0.05, -0.036], [0.012, -0.036]]]);
  box(p, 0.005, 0.018, 0.007, 0.028, -0.02, 0, M.metal);
  ext(p, [[-0.1, 0.056], [-0.38, 0.046], [-0.388, -0.085], [-0.35, -0.092], [-0.1, -0.006]], 0.038, M.poly, 0.008,
    [[[-0.14, 0.03], [-0.3, 0.025], [-0.3, -0.03], [-0.14, 0.005]]]);
  box(p, 0.01, 0.14, 0.04, -0.388, -0.02, 0, M.metal2);
  g.userData = {
    cls: 'smg', muzzle: P2L(0.405, 0.03), gripR: P2L(-0.028, -0.055), gripL: P2L(0.27, -0.004, -0.006), sight: P2L(0.33, 0.094),
    eject: P2L(0.1, 0.05, 0.026), mag, magDir: [0.1, -0.99], magAnchor: V(0.12, -0.2), charge, rack: V(0.3, 0.07, -0.04),
  };
  return g;
}

function buildShotgun(M) {
  const [g, p] = gunRoot();
  ext(p, [[-0.08, 0], [0.14, 0], [0.14, 0.076], [-0.06, 0.076], [-0.08, 0.062]], 0.044, M.metal, 0.003);
  box(p, 0.08, 0.026, 0.002, 0.04, 0.045, 0.0225, M.dark);    // ejection port
  box(p, 0.07, 0.003, 0.02, 0.05, 0.0, 0, M.dark);            // loading port
  cylX(p, 0.012, 0.14, 0.71, 0.058, M.metal, 0, 18);
  box(p, 0.55, 0.004, 0.008, 0.43, 0.071, 0, M.metal2);
  cylX(p, 0.0082, 0.709, 0.711, 0.058, M.dark, 0, 12);
  cylX(p, 0.013, 0.14, 0.6, 0.024, M.metal2);
  cylX(p, 0.0142, 0.6, 0.625, 0.024, M.metal, 0, 14);
  box(p, 0.02, 0.05, 0.03, 0.59, 0.042, 0, M.metal);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), M.brass);
  bead.position.set(0.695, 0.073, 0); p.add(bead);
  const pump = grp(p);
  ext(pump, [[0.2, 0.0], [0.4, 0.0], [0.4, 0.048], [0.2, 0.048]], 0.058, M.poly, 0.012);
  for (let i = 0; i < 8; i++) box(pump, 0.006, 0.05, 0.0625, 0.215 + i * 0.024, 0.024, 0, M.dark);
  ext(p, [[-0.08, 0.062], [-0.08, 0.0], [-0.115, -0.03], [-0.16, -0.06], [-0.48, -0.125], [-0.488, 0.01], [-0.46, 0.036], [-0.14, 0.056]], 0.042, M.wood, 0.005);
  box(p, 0.022, 0.16, 0.046, -0.495, -0.05, 0, M.dark);
  triggerGroup(p, M, 0);
  const shell = grp(p);
  cylX(shell, 0.0095, 0.0, 0.058, 0, M.red, 0, 10); cylX(shell, 0.0098, -0.012, 0.0, 0, M.brass, 0, 10);
  shell.visible = false;
  g.userData = {
    cls: 'shotgun', muzzle: P2L(0.715, 0.058), gripR: P2L(-0.1, -0.03), gripL: V(0.3, 0.0, -0.006), gripLObj: pump, sight: P2L(0.695, 0.0768),
    eject: P2L(0.04, 0.05, 0.024), pump, shell, port: V(0.05, -0.008, 0),
  };
  return g;
}

function buildSniper(M) {
  const [g, p] = gunRoot();
  ext(p, [[0.47, 0.022], [0.47, -0.022], [0.1, -0.034], [0.03, -0.048], [-0.01, -0.12], [-0.055, -0.122], [-0.06, -0.06], [-0.1, -0.05], [-0.39, -0.105], [-0.41, 0.04], [-0.13, 0.04], [-0.075, 0.024]], 0.046, M.green, 0.008);
  box(p, 0.014, 0.15, 0.05, -0.41, -0.032, 0, M.rubber);
  for (let i = 0; i < 4; i++) box(p, 0.004, 0.03, 0.047, -0.015 - i * 0.009, -0.075, 0, M.poly);
  cylX(p, 0.017, -0.085, 0.12, 0.036, M.metal, 0, 20);
  cylX(p, 0.011, 0.12, 0.72, 0.036, M.metal, 0, 16, 0.0085);
  cylX(p, 0.0125, 0.72, 0.765, 0.036, M.metal2, 0, 10);
  for (let i = 0; i < 3; i++) box(p, 0.008, 0.02, 0.027, 0.73 + i * 0.012, 0.036, 0, M.dark);
  cylX(p, 0.005, 0.764, 0.766, 0.036, M.dark, 0, 10);
  box(p, 0.03, 0.004, 0.002, 0.055, 0.048, 0.0172, M.dark);
  const mag = grp(p);
  box(mag, 0.075, 0.03, 0.03, 0.045, -0.04, 0, M.metal2);
  box(mag, 0.08, 0.006, 0.034, 0.045, -0.056, 0, M.metal);
  triggerGroup(p, M, -0.005);
  // bolt: rotates up about the bore axis, then slides back
  const bolt = grp(p, 0, 0.036, 0);
  cylX(bolt, 0.0105, -0.115, -0.083, 0, M.metal2, 0, 14);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.05, 8), M.metal);
  handle.geometry.translate(0, 0.025, 0); handle.rotation.x = Math.PI / 2 - 0.35; handle.position.set(-0.045, 0, 0.0); bolt.add(handle);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 12, 10), M.poly); knob.position.set(-0.045, -0.016, 0.047); bolt.add(knob);
  // scope: rings, tube, bells, turrets, lenses
  for (const x of [-0.04, 0.1]) { box(p, 0.018, 0.04, 0.03, x, 0.066, 0, M.metal); }
  cylX(p, 0.0135, -0.085, 0.16, 0.087, M.metal, 0, 20);
  cylX(p, 0.0135, 0.16, 0.25, 0.087, M.metal, 0, 20, 0.0235);
  cylX(p, 0.019, -0.15, -0.085, 0.087, M.metal, 0, 20, 0.0135);
  cylX(p, 0.02, -0.165, -0.15, 0.087, M.rubber, 0, 20);
  cylY(p, 0.0095, 0.016, 0.035, 0.108, 0, M.metal);
  cylZ(p, 0.0095, 0.016, 0.035, 0.087, 0.021, M.metal);
  disc(p, 0.022, 0.2505, 0.087, M.glass);
  disc(p, 0.018, -0.1655, 0.087, M.glass);
  g.userData = {
    cls: 'bolt', muzzle: P2L(0.768, 0.036), gripR: P2L(-0.035, -0.078), gripL: P2L(0.3, -0.03, -0.006), sight: P2L(0.1, 0.087),
    eject: P2L(0.055, 0.05, 0.02), bolt, knob, mag, magDir: [0, -1], magAnchor: V(0.045, -0.06), scope: true,
  };
  return g;
}

function buildKnife(M) {
  const [g, p] = gunRoot();
  const k = grp(p);
  k.rotation.z = 1.0; // blade forward-up, handle down-back like a pistol grip
  ext(k, [[0.0, 0.009], [0.13, 0.013], [0.168, 0.021], [0.19, 0.001], [0.165, -0.011], [0.0, -0.014]], 0.0045, M.steel, 0.0009);
  box(k, 0.12, 0.004, 0.0048, 0.07, 0.004, 0, M.metal2);                   // fuller
  box(k, 0.13, 0.003, 0.0035, 0.07, -0.012, 0, new THREE.MeshPhongMaterial({ color: 0xc8ccd0, specular: 0xffffff, shininess: 160 })); // edge
  box(k, 0.01, 0.052, 0.02, -0.004, -0.002, 0, M.metal);                   // guard
  ext(k, [[-0.12, 0.015], [-0.008, 0.013], [-0.008, -0.016], [-0.12, -0.017]], 0.026, M.rubber, 0.006);
  for (let i = 0; i < 5; i++) box(k, 0.005, 0.034, 0.028, -0.025 - i * 0.02, -0.001, 0, M.poly);
  box(k, 0.014, 0.036, 0.028, -0.126, -0.001, 0, M.metal);                 // pommel
  const c = Math.cos(1.0), s = Math.sin(1.0), rot = (x, y) => [x * c - y * s, x * s + y * c];
  const [hx, hy] = rot(-0.062, 0), [tx, ty] = rot(0.19, 0.001);
  g.userData = { cls: 'knife', muzzle: P2L(tx, ty), tip: P2L(tx, ty), gripR: P2L(hx, hy), gripL: null, sight: P2L(0.05, 0.12), knife: k };
  return g;
}

export function buildGrenade(M) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12).scale(1, 1.08, 1), M.olive); g.add(body);
  cylY(g, 0.011, 0.02, 0, 0.038, 0, M.metal2);
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.004), M.metal2); spoon.position.set(0, 0.022, 0.03); spoon.rotation.x = -0.25; g.add(spoon);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0015, 6, 14), M.steel); ring.position.set(-0.016, 0.046, 0); ring.rotation.y = Math.PI / 2; g.add(ring);
  g.userData = { ring, spoon };
  return g;
}

const BUILDERS = { pistol: buildPistol, revolver: buildRevolver, smg: buildSMG, shotgun: buildShotgun, rifle: buildRifle, m4: buildM4, sniper: buildSniper, knife: buildKnife };
export function buildGun(type, M) { return BUILDERS[type](M); }

// ---------- merging (third-person / world drops: 1 draw call per rigid part) ----------
function mergeToVertexColors(root, boost = 1) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pos = [], nor = [], col = [];
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), c = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let par = o.parent, vis = true;
    while (par) { if (!par.visible) vis = false; par = par.parent; }
    if (!vis) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    m.multiplyMatrices(inv, o.matrixWorld); nm.getNormalMatrix(m);
    c.copy(o.material.color);
    if (o.material.transparent) c.multiplyScalar(0.3);
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      col.push(Math.min(c.r * boost, 1.5), Math.min(c.g * boost, 1.5), Math.min(c.b * boost, 1.5));
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
let cacheMats = null;
export function mergedGunGeometry(type) {
  if (!gunGeoCache[type]) {
    cacheMats ||= gunMaterials();
    const gun = type === 'nade' ? buildGrenade(cacheMats) : buildGun(type, cacheMats);
    const geo = mergeToVertexColors(gun, 1.8);
    gunGeoCache[type] = { geo, data: gun.userData };
  }
  return gunGeoCache[type];
}

// ---------- limbs ----------
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
// orient a unit-length Y-axis mesh between points a and b (in the mesh parent's space)
export function spanBetween(mesh, a, b) {
  tmpV.subVectors(b, a);
  const len = tmpV.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, tmpV.divideScalar(len || 1));
  mesh.scale.set(1, len, 1);
}
function limbGeo(r0, r1, seg = 12) { return new THREE.CylinderGeometry(r1, r0, 1, seg, 1, false); }

// Gloved hand gripping (fist) oriented along local -Y (fingers wrap around +Z)
function fistGeometry(M, watch) {
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
  if (watch) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.032, 0.012), M.watch);
    w.position.set(-0.03, 0.0, -0.1); grp.add(w);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.9, 0.5) }));
    face.rotation.y = -Math.PI / 2; face.position.set(-0.0475, 0.0, -0.1); grp.add(face);
  }
  return grp;
}

const HAND_ROT = {
  pistol: [-0.25, 0, 0], revolver: [-0.2, 0, 0], shotgun: [-0.25, 0, 0], knife: [-0.55, 0, 0.1], default: [-0.3, 0, 0],
};

// First-person arms attached to a viewmodel gun. Hand targets can be overridden by animations.
export class FPArms {
  constructor(M) {
    this.group = new THREE.Group();
    const up = limbGeo(0.052, 0.046), fore = limbGeo(0.043, 0.035);
    this.rU = new THREE.Mesh(up, M.sleeve); this.rF = new THREE.Mesh(fore, M.sleeve);
    this.lU = new THREE.Mesh(up, M.sleeve); this.lF = new THREE.Mesh(fore, M.sleeve);
    this.rH = fistGeometry(M, false); this.lH = fistGeometry(M, true);
    this.lH.scale.x = -1;
    this.group.add(this.rU, this.rF, this.lU, this.lF, this.rH, this.lH);
    this.shR = new THREE.Vector3(0.21, -0.36, 0.02);
    this.shL = new THREE.Vector3(-0.24, -0.38, 0.0);
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); this.e = new THREE.Vector3(); this.wrist = new THREE.Vector3();
    this.back = new THREE.Vector3(); this.t = new THREE.Vector3();
    this.lRest = new THREE.Vector3(-0.2, -0.46, -0.3);
    this.q = new THREE.Quaternion(); this.q2 = new THREE.Quaternion();
  }
  // gun: viewmodel gun group (same parent space as this.group); o: { lh: {w, p, r}, rh: {w, p, r}, lFree }
  update(gun, cls, o = {}) {
    const d = gun.userData;
    gun.updateMatrixWorld(true);
    const gq = gun.quaternion;
    // right hand
    const hr = HAND_ROT[cls] || HAND_ROT.default;
    const hR = this.a.copy(d.gripR).applyMatrix4(gun.matrix);
    this.rH.quaternion.copy(gq).multiply(tmpQ.setFromEuler(tmpE.set(hr[0], hr[1], hr[2])));
    if (o.rh && o.rh.w > 0) {
      hR.lerp(o.rh.p, o.rh.w);
      if (o.rh.r) this.rH.quaternion.slerp(this.q.copy(gq).multiply(tmpQ.setFromEuler(tmpE.set(o.rh.r[0], o.rh.r[1], o.rh.r[2]))), o.rh.w);
    }
    this.rH.position.copy(hR);
    this.wrist.set(-0.006, 0, 0.075).applyQuaternion(this.rH.quaternion).add(hR);
    this.limb(this.shR, this.wrist, this.rU, this.rF, 1);
    // left (support) hand
    let hL;
    if (d.gripL) {
      hL = d.gripLObj ? this.b.copy(d.gripL).applyMatrix4(d.gripLObj.matrixWorld) : this.b.copy(d.gripL).applyMatrix4(gun.matrix);
      if (cls === 'pistol' || cls === 'revolver') {
        this.lH.quaternion.copy(gq).multiply(tmpQ.setFromEuler(tmpE.set(-0.25, 0, 0.35)));
        this.back.set(0.02, -0.02, 0.075);
      } else {
        this.lH.quaternion.copy(gq).multiply(tmpQ.setFromEuler(tmpE.set(Math.PI / 2 - 0.2, 0.0, -1.25)));
        this.back.set(-0.03, 0.02, 0.07);
      }
    } else {
      hL = this.b.copy(this.lRest);
      this.lH.quaternion.setFromEuler(tmpE.set(0.3, 0.2, 0.9));
      this.back.set(-0.03, 0.02, 0.07);
    }
    if (o.lh && o.lh.w > 0) {
      hL.lerp(o.lh.p, o.lh.w);
      if (o.lh.r) this.lH.quaternion.slerp(this.q.copy(gq).multiply(tmpQ.setFromEuler(tmpE.set(o.lh.r[0], o.lh.r[1], o.lh.r[2]))), o.lh.w);
    }
    this.lH.position.copy(hL);
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
  const VEST = 0xffffff; // white vertices are recolored per player
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
  part(new THREE.SphereGeometry(0.035, 8, 6), mat(0x3a4428), t, -0.14, 0.05, -0.12); // grenade on belt
  // head: balaclava + helmet + goggles
  const h = new THREE.Group(); tmp.add(h);
  part(new THREE.SphereGeometry(0.11, 16, 12).scale(0.95, 1.1, 1), mat(0x1a1a1a), h, 0, 0.1, 0);
  part(new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.9), mat(0x3b3f36), h, 0, 0.13, 0.005);
  part(new THREE.BoxGeometry(0.17, 0.045, 0.06), mat(0x0a0a0a), h, 0, 0.11, -0.09);
  part(new THREE.BoxGeometry(0.2, 0.012, 0.02), mat(0x222222), h, 0, 0.11, -0.06);
  const pelvis = new THREE.Group(); tmp.add(pelvis);
  part(new THREE.BoxGeometry(0.36, 0.2, 0.24), mat(0x262a2f), pelvis, 0, -0.02, 0);
  soldierGeoCache.torso = mergeToVertexColors(t, 2.6);
  soldierGeoCache.head = mergeToVertexColors(h, 2.6);
  soldierGeoCache.pelvis = mergeToVertexColors(pelvis, 2.6);
  const leg = new THREE.Group();
  part(new THREE.CylinderGeometry(0.095, 0.078, 1, 10).translate(0, -0.5, 0), mat(0x262a2f), leg);
  soldierGeoCache.thigh = mergeToVertexColors(leg, 2.6);
  const shin = new THREE.Group();
  part(new THREE.CylinderGeometry(0.076, 0.06, 0.42, 10).translate(0, -0.21, 0), mat(0x262a2f), shin);
  part(new THREE.SphereGeometry(0.075, 8, 6).scale(1, 0.8, 0.7).translate(0, 0, -0.06), mat(0x1a1a1a), shin);   // knee pad
  part(new THREE.BoxGeometry(0.11, 0.1, 0.26).translate(0, -0.44, -0.04), mat(0x15130f), shin);
  soldierGeoCache.shin = mergeToVertexColors(shin, 2.6);
  const arm = new THREE.Group();
  part(new THREE.CylinderGeometry(0.058, 0.064, 1, 10), mat(0x1e2431), arm);
  soldierGeoCache.arm = mergeToVertexColors(arm, 2.6);
  const hand = new THREE.Group();
  part(new THREE.SphereGeometry(0.045, 10, 8).scale(0.8, 1, 1.2), mat(0x151515), hand);
  soldierGeoCache.hand = mergeToVertexColors(hand, 2.6);
  return soldierGeoCache;
}

let friendMat = null;
function friendMarkerMaterial() {
  if (friendMat) return friendMat;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0.5)'; x.beginPath(); x.moveTo(6, 12); x.lineTo(58, 12); x.lineTo(32, 56); x.closePath(); x.fill();
  x.fillStyle = '#6fb4ff'; x.beginPath(); x.moveTo(12, 16); x.lineTo(52, 16); x.lineTo(32, 48); x.closePath(); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  friendMat = new THREE.SpriteMaterial({ map: t, color: new THREE.Color(1.6, 1.6, 1.6), depthWrite: false, transparent: true, fog: false });
  return friendMat;
}

const HOLD = {
  pistol: [0.0, 0.0, -0.36], revolver: [0.0, 0.0, -0.36], knife: [0.12, -0.12, -0.3], default: [0.09, -0.02, -0.12],
};
const easeOut = (x) => 1 - (1 - x) * (1 - x);

export class Soldier {
  constructor(color, weapon) {
    const G = soldierGeometries();
    this.mat = bakeMaterial({ vertexColors: true, color: 0xffffff, shininess: 12, specular: 0x111111 }, { uniform: true, phong: true });
    const vest = new THREE.Color(color);
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
    this.gun = null; this.gunType = null;
    this.phase = 0; this.deadT = 0; this.act = null; this.actT = 0;
    this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3();
    this.sInv = new THREE.Matrix4(); this.axis = new THREE.Vector3(); this.q = new THREE.Quaternion();
    this.lRest = new THREE.Vector3(-0.16, 0.26, -0.26);
    // flashlight beam (cheap additive cone)
    const cone = new THREE.ConeGeometry(0.9, 7, 16, 1, true); cone.translate(0, -3.5, 0); cone.rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    this.beam.visible = false;
    this.setWeapon(weapon || 'pistol');
  }
  setWeapon(type) {
    if (this.gunType === type) return;
    if (this.gun) this.aim.remove(this.gun);
    const { geo, data } = mergedGunGeometry(type);
    this.gun = new THREE.Mesh(geo, this.mat);
    this.gun.userData = data;
    this.gunType = type;
    const h = HOLD[type] || HOLD.default;
    this.gun.position.set(h[0], h[1], h[2]);
    this.aim.add(this.gun);
    this.gun.add(this.beam); this.beam.position.copy(data.muzzle);
  }
  muzzleWorld(out) { return out.copy(this.gun.userData.muzzle).applyMatrix4(this.gun.matrixWorld); }
  // small blue chevron over teammates' heads (team deathmatch)
  setFriendly(on) {
    if (on && !this.marker) {
      this.marker = new THREE.Sprite(friendMarkerMaterial());
      this.marker.scale.set(0.11, 0.11, 1);
      this.marker.position.set(0, 2.02, 0);
      this.root.add(this.marker);
    }
    if (this.marker) this.marker.visible = !!on;
  }
  flinch(k, side) { this.flinchK = Math.min(1.2, (this.flinchK || 0) + 0.5 + k); this.flinchDir = side || (Math.random() < 0.5 ? -1 : 1); }
  // one-shot upper-body actions: 'swing', 'heavy', 'throw'
  action(name) { this.act = name; this.actT = 0; }
  // dir: fall direction in the model's local space (radians, 0 = backwards)
  die(dir, head) { this.dieDir = dir; this.dieFast = head ? 1.6 : 1; this.deadT = 0; this.dieTwist = (Math.random() - 0.5) * 0.6; }
  // s: {x,y,z,yaw, pitch, crouch, speed, alive, flash, lean, reload, sprint, ads}
  update(dt, s, light) {
    this.mat.userData.uLight.value.setRGB(light, light * 0.96, light * 0.85);
    this.beam.visible = !!s.flash && s.alive;
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
    const cr = s.crouch ? 1 : 0;
    this.cr = (this.cr ?? cr) + (cr - (this.cr ?? cr)) * Math.min(1, dt * 10);
    this.rl = (this.rl ?? 0) + ((s.reload ? 1 : 0) - (this.rl ?? 0)) * Math.min(1, dt * 8);
    this.sp = (this.sp ?? 0) + ((s.sprint ? 1 : 0) - (this.sp ?? 0)) * Math.min(1, dt * 8);
    const c = this.cr;
    this.phase += dt * s.speed * 2.2;
    const sw = Math.min(1, s.speed / 3) * 0.55;
    const drop = c * 0.4;
    const fk = (this.flinchK = Math.max(0, (this.flinchK || 0) - dt * 5));
    const lean = s.lean || 0;
    // upper-body action curve
    let ax = 0, ay = 0, az = 0;
    if (this.act) {
      this.actT += dt;
      const dur = this.act === 'heavy' ? 0.7 : this.act === 'throw' ? 0.6 : 0.38, u = this.actT / dur;
      if (u >= 1) this.act = null;
      else if (this.act === 'swing') { const k = Math.sin(u * Math.PI); ay = (0.9 - 1.8 * easeOut(u)) * k; ax = -0.3 * k; }
      else if (this.act === 'heavy') { const k = u < 0.45 ? u / 0.45 : 1 - (u - 0.45) / 0.55; ax = u < 0.45 ? 0.6 * k : -0.5 * k; }
      else { const k = Math.sin(u * Math.PI); ax = u < 0.5 ? 0.9 * k : -0.6 * k; az = 0.4 * k; }
    }
    this.pelvis.position.y = 0.95 - drop;
    this.spine.position.y = 0.97 - drop + Math.abs(Math.sin(this.phase)) * 0.025 * sw;
    this.spine.rotation.x = s.pitch * 0.3 - c * 0.22 + fk * 0.22 - this.sp * 0.12;
    this.spine.rotation.z = -lean * 0.36 + fk * 0.12 * (this.flinchDir || 1);
    this.spine.rotation.y = ay * 0.4;
    this.neck.rotation.x = s.pitch * 0.4 + fk * 0.3;
    this.neck.rotation.z = lean * 0.15;
    const low = Math.max(this.rl, this.sp * 0.8);
    this.aim.rotation.x = s.pitch * 0.7 + c * 0.22 - fk * 0.2 - low * 0.55 + ax;
    this.aim.rotation.y = ay;
    this.aim.rotation.z = this.rl * 0.5 + az;
    this.legs.forEach((l, i) => {
      const ph = Math.sin(this.phase + i * Math.PI) * sw;
      l.hip.position.y = 0.92 - drop;
      l.hip.rotation.x = ph + c * 1.1;
      l.knee.rotation.x = -(Math.max(0, -Math.cos(this.phase + i * Math.PI)) * sw * 1.2 + c * 2.0);
    });
    // arms to the weapon grips (spine space)
    this.spine.updateMatrixWorld(true);
    const gm = this.gun.matrixWorld;
    this.sInv.copy(this.spine.matrixWorld).invert();
    const d = this.gun.userData;
    for (let i = 0; i < 2; i++) {
      const a = this.arms[i], g = i === 0 ? d.gripR : d.gripL, sx = i === 0 ? 0.23 : -0.23;
      const hand = g ? this.v1.copy(g).applyMatrix4(gm).applyMatrix4(this.sInv) : this.v1.copy(this.lRest);
      const sh = this.v2.set(sx, 0.5, 0.02);
      const e = this.v3.addVectors(sh, hand).multiplyScalar(0.5); e.x += Math.sign(sx) * 0.09; e.y -= 0.12;
      spanBetween(a.u, sh, e); spanBetween(a.f, e, hand);
      a.h.position.copy(hand);
    }
    // death: topple around the feet in the direction of the killing blow; weapon is dropped (world drop)
    if (this.marker) this.marker.material.opacity = s.alive ? 0.9 : 0;
    if (!s.alive) {
      this.deadT = Math.min(1, this.deadT + dt * 2.3 * (this.dieFast || 1));
      const k = this.deadT, e = k * k * (3 - 2 * k);
      const dir = this.dieDir ?? 0;
      this.axis.set(Math.cos(dir), 0, -Math.sin(dir));
      this.body.quaternion.setFromAxisAngle(this.axis, e * 1.5);
      this.q.setFromAxisAngle(UP, (this.dieTwist || 0) * e);
      this.body.quaternion.premultiply(this.q);
      this.body.position.y = e * 0.1;
      this.legs.forEach((l, i) => { l.knee.rotation.x -= e * (0.6 + i * 0.3); });
      this.gun.visible = false;
    } else {
      this.deadT = 0; this.body.quaternion.identity(); this.body.position.y = 0; this.gun.visible = true;
    }
  }
}

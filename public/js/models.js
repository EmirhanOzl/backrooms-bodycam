// Procedural models: detailed firearms (profile-extruded) with animated parts, knife, grenade,
// gloved first-person arms with hand targets, and third-person operators.
import * as THREE from 'three';
import { bakeMaterial } from './world.js';
import { APPEARANCE_OPTIONS, APPEARANCE_PALETTES, DEFAULT_APPEARANCE, normalizeAppearance } from './shared/customization.js';

// ---------- materials ----------
export function gunMaterials() {
  const P = (color, specular, shininess) => new THREE.MeshPhongMaterial({ color, specular, shininess });
  return {
    metal: P(0x24282c, 0x777f89, 82),
    metal2: P(0x363b40, 0x505963, 44),
    steel: P(0x929ca5, 0xffffff, 120),
    poly: P(0x202326, 0x353a3f, 20),
    fde: P(0x79684b, 0x3a3224, 18),
    green: P(0x48543b, 0x2d3525, 18),
    olive: P(0x485335, 0x353e28, 24),
    wood: P(0x69412a, 0x382519, 32),
    bakelite: P(0x63301a, 0x4b2918, 44),
    rubber: P(0x16191b, 0x1b2022, 8),
    brass: P(0xb38b40, 0xffe2a0, 90),
    shell: P(0x8c2821, 0x441812, 24),
    dark: P(0x060809, 0x000000, 1),
    glass: new THREE.MeshPhongMaterial({ color: 0x74909a, specular: 0xbde4ff, shininess: 140, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide }),
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
function modelShadows(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !o.material.transparent && !o.material.isMeshBasicMaterial;
    o.receiveShadow = !o.material.isMeshBasicMaterial;
  });
  return root;
}

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
  box(slide, 0.042, 0.002, 0.017, 0.05, 0.0325, 0, M.dark);
  box(slide, 0.033, 0.0015, 0.01, 0.05, 0.0335, 0, M.steel);
  box(slide, 0.008, 0.003, 0.023, -0.027, 0.034, 0, M.metal);
  box(slide, 0.008, 0.006, 0.0045, -0.027, 0.037, 0.0085, M.metal);
  box(slide, 0.008, 0.006, 0.0045, -0.027, 0.037, -0.0085, M.metal);
  box(slide, 0.004, 0.006, 0.0035, 0.14, 0.036, 0, M.metal);
  box(slide, 0.0012, 0.002, 0.0022, 0.138, 0.038, 0, M.dot);
  box(slide, 0.0012, 0.002, 0.0022, -0.0315, 0.038, 0.0085, M.dot);
  box(slide, 0.0012, 0.002, 0.0022, -0.0315, 0.038, -0.0085, M.dot);
  cylX(p, 0.0068, 0.12, 0.156, 0.017, M.metal2);
  cylX(p, 0.0047, 0.155, 0.157, 0.017, M.dark);
  ext(p, [[-0.03, -0.019], [0.142, -0.019], [0.142, -0.001], [-0.03, -0.001]], 0.024, M.poly, 0.0015);
  for (let i = 0; i < 3; i++) box(p, 0.006, 0.004, 0.0245, 0.1 + i * 0.013, -0.019, 0, M.poly);
  ext(p, [[-0.047, -0.004], [-0.034, -0.018], [0.03, -0.018], [0.012, -0.112], [0.0, -0.121], [-0.046, -0.121], [-0.058, -0.108], [-0.05, -0.03]], 0.029, M.poly, 0.0035);
  for (let i = 0; i < 5; i++) box(p, 0.0035, 0.005, 0.03, 0.022 - i * 0.004, -0.04 - i * 0.017, 0, M.metal2);
  ext(p, [[0.015, -0.019], [0.074, -0.019], [0.072, -0.04], [0.056, -0.051], [0.019, -0.051]], 0.012, M.poly, 0.001,
    [[[0.022, -0.021], [0.065, -0.021], [0.063, -0.038], [0.052, -0.045], [0.024, -0.045]]]);
  box(p, 0.005, 0.02, 0.007, 0.036, -0.03, 0, M.metal2);
  box(p, 0.004, 0.006, 0.031, -0.004, -0.022, 0, M.metal2);            // mag release
  cylZ(p, 0.0025, 0.0305, -0.018, -0.005, 0, M.steel, 10);
  box(p, 0.019, 0.004, 0.003, -0.006, -0.007, -0.016, M.metal2);
  for (let i = 0; i < 7; i++) box(p, 0.024, 0.0016, 0.0015, -0.029, -0.046 - i * 0.008, 0.016, M.glove2);
  const mag = grp(p);
  ext(mag, [[-0.04, -0.03], [0.004, -0.03], [-0.012, -0.118], [-0.048, -0.118]], 0.022, M.metal, 0.001);
  box(mag, 0.05, 0.009, 0.031, -0.024, -0.124, 0, M.poly);
  g.userData = {
    cls: 'pistol', muzzle: P2L(0.159, 0.017), gripR: P2L(-0.014, -0.06), gripL: P2L(-0.005, -0.066, -0.03), sight: P2L(0.14, 0.041),
    eject: P2L(0.05, 0.034, 0.014), ejectObj: slide, ejectAnchor: V(0.05, 0.034, 0.014), slide, mag, magDir: [-0.19, -0.98], magAnchor: V(-0.026, -0.127), rack: V(-0.025, 0.018, -0.013),
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
  box(p, 0.012, 0.005, 0.0045, -0.018, 0.0555, 0.008, M.metal);
  box(p, 0.012, 0.005, 0.0045, -0.018, 0.0555, -0.008, M.metal);
  const hammer = grp(p, -0.03, 0.04, 0);
  ext(hammer, [[0.0, -0.004], [0.006, -0.004], [0.004, 0.012], [-0.012, 0.02], [-0.014, 0.016], [-0.004, 0.006]], 0.008, M.metal2, 0.001);
  // cylinder on a swing-out crane (pivot below-left of the bore axis)
  const crane = grp(p, 0.025, 0.006, -0.011);
  const cyl = grp(crane, 0, 0.017, 0.011);
  cylX(cyl, 0.021, -0.022, 0.022, 0, M.metal2, 0, 24);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + Math.PI / 6;
    box(cyl, 0.03, 0.004, 0.007, 0, Math.sin(a) * 0.02, Math.cos(a) * 0.02, M.dark).rotation.x = -a;
    cylX(cyl, 0.0048, 0.0215, 0.0225, Math.sin(a + Math.PI / 6) * 0.0125, M.dark, Math.cos(a + Math.PI / 6) * 0.0125, 10);
    cylX(cyl, 0.0052, -0.0225, -0.0215, Math.sin(a + Math.PI / 6) * 0.0125, M.brass, Math.cos(a + Math.PI / 6) * 0.0125, 10);
  }
  box(crane, 0.03, 0.006, 0.006, 0, 0.002, 0.003, M.metal);
  ext(p, [[-0.034, 0.02], [-0.004, -0.004], [-0.008, -0.024], [-0.028, -0.09], [-0.058, -0.094], [-0.068, -0.075], [-0.058, -0.02]], 0.033, M.rubber, 0.006);
  for (let i = 0; i < 4; i++) box(p, 0.004, 0.012, 0.0345, -0.018 - i * 0.008, -0.03 - i * 0.014, 0, M.poly);
  cylZ(p, 0.003, 0.032, -0.018, 0.026, 0, M.steel, 12);
  box(p, 0.018, 0.008, 0.003, -0.02, 0.02, -0.017, M.metal2);
  triggerGroup(p, M, -0.005);
  g.userData = {
    cls: 'revolver', muzzle: P2L(0.22, 0.031), gripR: P2L(-0.03, -0.048), gripL: P2L(-0.022, -0.058, -0.031), sight: P2L(0.206, 0.060),
    eject: P2L(0.003, 0.023, -0.011), ejectObj: crane, ejectAnchor: V(-0.022, 0.017, 0.011), hammer, crane, cyl, magAnchor: V(-0.022, 0.0, -0.012),
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
  ext(p, [[0.262, 0.046], [0.448, 0.046], [0.448, 0.067], [0.262, 0.067]], 0.036, M.wood, 0.005);
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
  box(p, 0.038, 0.004, 0.005, 0.21, 0.085, 0.008, M.metal);
  box(p, 0.038, 0.004, 0.005, 0.21, 0.085, -0.008, M.metal);
  box(p, 0.045, 0.002, 0.021, 0.21, 0.080, 0, M.metal);
  box(p, 0.11, 0.012, 0.003, 0.06, 0.03, 0.025, M.metal);
  const charge = grp(p);
  cylZ(charge, 0.0055, 0.025, 0.19, 0.046, 0.034, M.metal);
  box(charge, 0.08, 0.008, 0.004, 0.155, 0.046, 0.024, M.metal);
  box(p, 0.11, 0.005, 0.002, 0.057, 0.047, 0.025, M.metal);
  cylZ(p, 0.004, 0.002, 0.012, 0.034, 0.026, M.steel, 12);
  for (const x of [-0.33, -0.29, -0.25]) box(p, 0.003, 0.046, 0.0015, x, 0.004, 0.022, M.wood);
  g.userData = {
    cls: 'rifle', muzzle: P2L(0.705, 0.03), gripR: P2L(-0.03, -0.056), gripL: P2L(0.36, 0.004, -0.007), sight: P2L(0.6, 0.089),
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
  const carrier = grp(p);
  box(carrier, 0.05, 0.014, 0.001, 0.078, 0.042, 0.0185, M.steel);
  box(p, 0.055, 0.003, 0.003, 0.073, 0.028, 0.019, M.metal2);
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
  cylZ(p, 0.0035, 0.002, -0.031, -0.003, -0.020, M.steel, 12);
  box(p, 0.02, 0.004, 0.003, -0.037, -0.003, -0.022, M.metal);
  box(p, 0.04, 0.008, 0.03, -0.238, -0.033, 0, M.metal2);
  for (let i = 0; i < 5; i++) box(p, 0.009, 0.028, 0.0015, -0.037 - i * 0.003, -0.066, 0.017, M.metal2);
  const mag = grp(p);
  curvedMag(mag, M, M.metal2, 0.1, 0.043, 0.035, 0.2, 0.024);
  box(mag, 0.064, 0.01, 0.028, 0.089, -0.203, 0, M.poly);
  // Hollow T-1 optic; the red-dot axis clears the receiver and handguard.
  ext(p, [[0.012, 0.068], [0.075, 0.068], [0.07, 0.084], [0.017, 0.084]], 0.02, M.metal, 0.002);
  cylX(p, 0.02, 0.018, 0.080, 0.112, M.metal, 0, 24, 0.02, true);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.020, 0.0023, 8, 24), M.metal); ring.rotation.y = Math.PI / 2; ring.position.set(0.080, 0.112, 0); p.add(ring);
  const ring2 = ring.clone(); ring2.position.x = 0.018; p.add(ring2);
  cylY(p, 0.006, 0.012, 0.049, 0.137, 0, M.metal);
  cylZ(p, 0.006, 0.012, 0.049, 0.112, 0.024, M.metal);
  disc(p, 0.0172, 0.078, 0.112, M.glass);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0007, 12), M.red); dot.rotation.y = -Math.PI / 2; dot.position.set(0.0765, 0.112, 0); p.add(dot);
  g.userData = {
    cls: 'm4', muzzle: P2L(0.615, 0.026), gripR: P2L(-0.03, -0.055), gripL: P2L(0.34, 0.001, -0.007), sight: P2L(0.0765, 0.112),
    eject: P2L(0.08, 0.045, 0.02), carrier, mag, magDir: [0.08, -1], magAnchor: V(0.09, -0.21), charge, rack: V(-0.095, 0.052, 0.0), catchPt: V(0.02, 0.0, -0.028), redDot: true,
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
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.0018, 8, 20), M.metal2);
  hood.rotation.y = Math.PI / 2; hood.position.set(0.33, 0.100, 0); p.add(hood);
  box(p, 0.017, 0.017, 0.012, 0.33, 0.078, 0, M.metal2);
  box(p, 0.003, 0.012, 0.002, 0.33, 0.091, 0, M.metal);
  const aperture = new THREE.Mesh(new THREE.TorusGeometry(0.0105, 0.0020, 8, 20), M.metal2);
  aperture.rotation.y = Math.PI / 2; aperture.position.set(-0.07, 0.100, 0); p.add(aperture);
  box(p, 0.016, 0.014, 0.022, -0.07, 0.078, 0, M.metal2);
  box(p, 0.026, 0.008, 0.03, -0.07, 0.068, 0, M.metal2);
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
  for (const z of [-0.025, 0.025]) cylX(p, 0.004, -0.34, -0.1, 0.03, M.steel, z, 10);
  ext(p, [[-0.32, 0.054], [-0.35, 0.054], [-0.36, -0.082], [-0.33, -0.09], [-0.314, -0.02]], 0.045, M.poly, 0.003);
  box(p, 0.009, 0.145, 0.052, -0.359, -0.018, 0, M.rubber);
  box(p, 0.060, 0.022, 0.002, 0.055, 0.042, 0.026, M.dark);
  const carrier = grp(p);
  box(carrier, 0.045, 0.014, 0.001, 0.058, 0.042, 0.027, M.steel);
  cylZ(p, 0.0035, 0.002, -0.036, -0.004, -0.019, M.steel, 10);
  box(p, 0.015, 0.004, 0.003, -0.04, -0.004, -0.020, M.metal);
  g.userData = {
    cls: 'smg', muzzle: P2L(0.405, 0.03), gripR: P2L(-0.028, -0.055), gripL: P2L(0.27, -0.003, -0.007), sight: P2L(0.33, 0.100),
    eject: P2L(0.06, 0.05, 0.028), carrier, mag, magDir: [0.1, -0.99], magAnchor: V(0.12, -0.2), charge, rack: V(0.3, 0.07, -0.036),
  };
  return g;
}

function buildShotgun(M) {
  const [g, p] = gunRoot();
  ext(p, [[-0.08, 0], [0.14, 0], [0.14, 0.076], [-0.06, 0.076], [-0.08, 0.062]], 0.044, M.metal, 0.003);
  box(p, 0.08, 0.026, 0.002, 0.04, 0.045, 0.0225, M.dark);    // ejection port
  box(p, 0.07, 0.003, 0.02, 0.05, 0.0, 0, M.dark);            // loading port
  cylX(p, 0.012, 0.14, 0.71, 0.058, M.metal, 0, 18);
  box(p, 0.55, 0.004, 0.008, 0.43, 0.080, 0, M.metal2);
  cylX(p, 0.0082, 0.709, 0.711, 0.058, M.dark, 0, 12);
  cylX(p, 0.013, 0.14, 0.6, 0.024, M.metal2);
  cylX(p, 0.0142, 0.6, 0.625, 0.024, M.metal, 0, 14);
  box(p, 0.02, 0.05, 0.03, 0.59, 0.042, 0, M.metal);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), M.brass);
  bead.position.set(0.695, 0.091, 0); p.add(bead);
  const pump = grp(p);
  ext(pump, [[0.2, 0.0], [0.4, 0.0], [0.4, 0.048], [0.2, 0.048]], 0.058, M.poly, 0.012);
  for (let i = 0; i < 8; i++) box(pump, 0.006, 0.05, 0.0625, 0.215 + i * 0.024, 0.024, 0, M.dark);
  ext(p, [[-0.08, 0.062], [-0.08, 0.0], [-0.115, -0.03], [-0.16, -0.06], [-0.48, -0.125], [-0.488, 0.01], [-0.46, 0.036], [-0.14, 0.056]], 0.042, M.wood, 0.005);
  box(p, 0.022, 0.16, 0.046, -0.495, -0.05, 0, M.dark);
  triggerGroup(p, M, 0);
  const shell = grp(p);
  cylX(shell, 0.0095, 0.0, 0.058, 0, M.shell, 0, 10); cylX(shell, 0.0098, -0.012, 0.0, 0, M.brass, 0, 10);
  shell.visible = false;
  g.userData = {
    cls: 'shotgun', muzzle: P2L(0.715, 0.058), gripR: P2L(-0.105, -0.026), gripL: V(0.3, 0.003, -0.007), gripLObj: pump, sight: P2L(0.695, 0.096),
    eject: P2L(0.04, 0.05, 0.024), pump, shell, port: V(0.05, -0.008, 0),
  };
  return g;
}

function buildSniper(M) {
  const [g, p] = gunRoot();
  // AWP: broad thumbhole stock, adjustable cheek rest, slab-sided receiver and heavy free-float barrel.
  ext(p, [[-0.46, 0.052], [-0.18, 0.052], [-0.105, 0.025], [0.075, 0.025], [0.46, 0.015], [0.46, -0.037], [0.09, -0.046], [0.045, -0.09], [-0.005, -0.129], [-0.071, -0.12], [-0.10, -0.061], [-0.22, -0.069], [-0.45, -0.126]],
    0.060, M.green, 0.005, [[[-0.17, 0.015], [-0.103, 0.009], [-0.073, -0.054], [-0.129, -0.051], [-0.17, -0.03]]]);
  ext(p, [[-0.43, 0.065], [-0.22, 0.065], [-0.20, 0.045], [-0.42, 0.041]], 0.055, M.poly, 0.003);
  box(p, 0.019, 0.187, 0.066, -0.467, -0.035, 0, M.rubber);
  for (const x of [-0.392, -0.25, 0.21, 0.415]) cylZ(p, 0.004, 0.063, x, -0.009, 0, M.metal2, 12);
  for (let i = 0; i < 4; i++) box(p, 0.028, 0.008, 0.062, 0.235 + i * 0.044, -0.006, 0, M.dark);
  ext(p, [[-0.108, 0.025], [0.185, 0.025], [0.185, 0.065], [-0.088, 0.065], [-0.108, 0.054]], 0.044, M.metal2, 0.003);
  box(p, 0.27, 0.008, 0.027, 0.031, 0.070, 0, M.metal);
  box(p, 0.075, 0.020, 0.002, 0.033, 0.043, 0.024, M.dark);
  cylX(p, 0.015, 0.185, 0.79, 0.043, M.metal, 0, 24, 0.0135);
  cylX(p, 0.017, 0.79, 0.808, 0.043, M.metal2, 0, 20);
  cylX(p, 0.0072, 0.807, 0.809, 0.043, M.dark, 0, 16);
  const mag = grp(p);
  box(mag, 0.086, 0.056, 0.033, 0.036, -0.049, 0, M.metal2);
  box(mag, 0.089, 0.006, 0.039, 0.036, -0.080, 0, M.metal);
  for (const x of [0.008, 0.031, 0.056]) box(mag, 0.003, 0.033, 0.034, x, -0.051, 0, M.metal);
  triggerGroup(p, M, -0.025);
  const bolt = grp(p, 0, 0.043, 0);
  cylX(bolt, 0.0115, -0.126, 0.082, 0, M.steel, 0, 18);
  cylX(bolt, 0.015, -0.130, -0.092, 0, M.metal2, 0, 18);
  cylZ(bolt, 0.0045, 0.038, -0.054, 0, 0.027, M.steel, 12);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.033, 10), M.steel);
  handle.rotation.x = -0.48; handle.position.set(-0.054, -0.013, 0.049); bolt.add(handle);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.011, 14, 10), M.poly); knob.position.set(-0.054, -0.028, 0.057); bolt.add(knob);
  // Open scope tubes and narrow rings: the actual optical axis is never capped by solid cylinders.
  const sy = 0.122;
  for (const x of [-0.057, 0.105]) {
    box(p, 0.018, 0.027, 0.024, x, 0.087, 0, M.metal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0023, 8, 24), M.metal);
    ring.rotation.y = Math.PI / 2; ring.position.set(x, sy, 0); p.add(ring);
    cylZ(p, 0.003, 0.037, x, sy - 0.014, 0, M.steel, 10);
  }
  cylX(p, 0.015, -0.100, 0.155, sy, M.metal, 0, 24, 0.015, true);
  cylX(p, 0.015, 0.155, 0.270, sy, M.metal, 0, 24, 0.029, true);
  cylX(p, 0.022, -0.177, -0.100, sy, M.metal, 0, 24, 0.015, true);
  cylX(p, 0.0225, -0.194, -0.177, sy, M.rubber, 0, 24, 0.0225, true);
  for (let i = 0; i < 9; i++) cylX(p, 0.016, 0.131 + i * 0.0025, 0.132 + i * 0.0025, sy, M.metal2, 0, 24, 0.016, true);
  cylY(p, 0.012, 0.019, 0.020, sy + 0.023, 0, M.metal2, 20);
  cylZ(p, 0.012, 0.018, 0.020, sy, 0.024, M.metal2, 20);
  disc(p, 0.027, 0.2705, sy, M.glass);
  g.userData = {
    cls: 'bolt', muzzle: P2L(0.813, 0.043), gripR: P2L(-0.044, -0.076), gripL: P2L(0.31, -0.036, -0.008), sight: P2L(-0.194, sy),
    eject: P2L(0.039, 0.047, 0.026), bolt, knob, mag, magDir: [0, -1], magAnchor: V(0.036, -0.083), scope: true,
  };
  return g;
}

// M9 bayonet: clip-point blade with sawback spine, fuller and wire-cutter slot, crossguard with muzzle ring,
// grooved rubber grip and latch pommel. The blade group spins about the guard for the inspect twirl.
function buildKnife(M) {
  const [g, p] = gunRoot();
  const k = grp(p);
  k.rotation.order = 'ZYX'; // x: roll about the blade (show both faces), z: tilt / twirl in the blade plane
  k.rotation.z = 1.0; // blade forward-up, handle down-back like a pistol grip
  const polish = new THREE.MeshPhongMaterial({ color: 0xd4d8dc, specular: 0xffffff, shininess: 190 });
  const blade = [[0.005, 0.013], [0.118, 0.013], [0.15, 0.009], [0.182, 0.0015], [0.172, -0.008], [0.155, -0.014], [0.13, -0.0175], [0.02, -0.0185], [0.005, -0.015]];
  const slot = curve((t) => [0.024 + Math.cos(t * Math.PI * 2) * 0.008, 0.001 + Math.sin(t * Math.PI * 2) * 0.004], 14);
  ext(k, blade, 0.005, M.steel, 0.0011, [slot]);
  // bright grind along the edge and the clip
  ext(k, [[0.02, -0.0185], [0.13, -0.0175], [0.155, -0.014], [0.172, -0.008], [0.182, 0.0015], [0.176, 0.001], [0.165, -0.004], [0.15, -0.008], [0.13, -0.01], [0.02, -0.011]], 0.0056, polish, 0.0006);
  ext(k, [[0.118, 0.013], [0.15, 0.009], [0.182, 0.0015], [0.176, 0.001], [0.148, 0.006], [0.118, 0.009]], 0.0054, polish, 0.0005);
  box(k, 0.07, 0.0035, 0.0058, 0.068, 0.0055, 0, M.metal2); // fuller
  // sawback teeth on the spine
  const teeth = [[0.042, 0.0128]];
  for (let i = 0; i < 12; i++) { const x = 0.042 + i * 0.0055; teeth.push([x + 0.0028, 0.0172], [x + 0.0055, 0.0128]); }
  teeth.push([0.108, 0.011], [0.042, 0.011]);
  ext(k, teeth, 0.0036, M.metal2, 0.0003);
  // crossguard with the muzzle ring above the spine
  ext(k, [[-0.004, 0.024], [0.004, 0.024], [0.005, -0.03], [0.012, -0.041], [0.004, -0.043], [-0.005, -0.031]], 0.019, M.metal, 0.0015);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0095, 0.0027, 8, 20), M.metal); ring.rotation.y = Math.PI / 2; ring.position.set(0, 0.0315, 0); k.add(ring);
  // grip: finger grooves, checkering
  ext(k, [[-0.005, 0.012], [-0.03, 0.0145], [-0.06, 0.0135], [-0.1, 0.0145], [-0.117, 0.012], [-0.117, -0.016], [-0.1, -0.0175], [-0.086, -0.0135], [-0.071, -0.0175], [-0.056, -0.0135], [-0.041, -0.0175], [-0.026, -0.0135], [-0.005, -0.016]], 0.027, M.rubber, 0.0065);
  for (let i = 0; i < 7; i++) box(k, 0.0028, 0.03, 0.0285, -0.014 - i * 0.0145, -0.001, 0, M.poly);
  // pommel with the bayonet latch
  ext(k, [[-0.117, 0.014], [-0.132, 0.012], [-0.137, 0.0], [-0.132, -0.016], [-0.117, -0.018]], 0.025, M.metal, 0.002);
  box(k, 0.012, 0.006, 0.029, -0.124, 0.016, 0, M.metal2);
  box(k, 0.006, 0.005, 0.03, -0.108, 0.015, 0, M.metal);
  const c = Math.cos(1.0), s = Math.sin(1.0), rot = (x, y) => [x * c - y * s, x * s + y * c];
  const [hx, hy] = rot(-0.062, 0), [tx, ty] = rot(0.182, 0.0015);
  g.userData = { cls: 'knife', muzzle: P2L(tx, ty), muzzleObj: k, muzzleAnchor: V(0.182, 0.0015), tip: P2L(tx, ty), gripR: P2L(hx, hy), gripL: null, sight: P2L(0.05, 0.12), knife: k, knifeTilt: 1.0 };
  return g;
}

export function buildGrenade(M) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12).scale(1, 1.08, 1), M.olive); g.add(body);
  cylY(g, 0.011, 0.02, 0, 0.038, 0, M.metal2);
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.004), M.metal2); spoon.position.set(0, 0.022, 0.03); spoon.rotation.x = -0.25; g.add(spoon);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0015, 6, 14), M.steel); ring.position.set(-0.016, 0.046, 0); ring.rotation.y = Math.PI / 2; g.add(ring);
  g.userData = { ring, spoon };
  return modelShadows(g);
}

// ---------- attachments (bit flags: 1 suppressor, 2 extended magazine, 4 laser) ----------
// sup: [length, radius] on the muzzle · las: module position under the barrel (profile space) · ext: magazine stretch
const ATT_FIT = {
  pistol: { sup: [0.12, 0.0128], las: [0.098, -0.029, 0], ext: 1.55 },
  revolver: { las: [0.15, -0.017, 0] },
  smg: { sup: [0.17, 0.0185], las: [0.29, -0.047, 0], ext: 1.3 },
  shotgun: { las: [0.66, -0.003, 0], ext: 'tube' },
  rifle: { sup: [0.19, 0.02], las: [0.43, -0.021, 0], ext: 1.32 },
  m4: { sup: [0.18, 0.019], las: [0.42, -0.025, 0], ext: 1.3 },
  sniper: { sup: [0.2, 0.023], las: [0.42, -0.054, 0], ext: 1.7 },
};
// (re)apply attachments to a built gun; updates userData.muzzle / laser / suppressed
export function decorateGun(g, type, a, M) {
  const d = g.userData, p = g.children[0];
  if (d.attGroup) {
    d.attGroup.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    p.remove(d.attGroup); d.attGroup = null;
  }
  if (!d.baseMuzzle) d.baseMuzzle = d.muzzle.clone(); else d.muzzle.copy(d.baseMuzzle);
  if (d.mag) d.mag.scale.set(1, 1, 1);
  d.att = a | 0; d.laser = null; d.suppressed = false;
  const F = ATT_FIT[type];
  if (!F || !a) return g;
  const G = grp(p); d.attGroup = G;
  const mx = -d.baseMuzzle.z, my = d.baseMuzzle.y;
  if (a & 1 && F.sup) {
    const [L, r] = F.sup;
    cylX(G, r, mx - 0.012, mx + L, my, M.metal, 0, 20);
    cylX(G, r * 1.05, mx - 0.012, mx + 0.006, my, M.metal2, 0, 20);
    cylX(G, r * 1.03, mx + L - 0.014, mx + L, my, M.metal2, 0, 20);
    for (let i = 1; i < 4; i++) cylX(G, r * 1.012, mx + (L * i) / 4 - 0.002, mx + (L * i) / 4 + 0.002, my, M.metal2, 0, 20);
    cylX(G, r * 0.32, mx + L, mx + L + 0.0012, my, M.dark, 0, 12);
    d.muzzle.copy(P2L(mx + L + 0.004, my));
    d.suppressed = true;
  }
  if (a & 2 && F.ext) {
    if (F.ext === 'tube') {
      cylX(G, 0.013, 0.625, 0.69, 0.024, M.metal2, 0, 14);
      cylX(G, 0.0145, 0.674, 0.69, 0.024, M.metal, 0, 14);
      box(G, 0.016, 0.05, 0.03, 0.682, 0.042, 0, M.metal);
    } else if (d.mag) d.mag.scale.set(1, F.ext, 1);
  }
  if (a & 4 && F.las) {
    const [x, y, z] = F.las;
    box(G, 0.056, 0.022, 0.027, x, y, z, M.poly);
    box(G, 0.034, 0.007, 0.022, x, y + 0.014, z, M.metal2);
    box(G, 0.012, 0.006, 0.006, x - 0.018, y - 0.012, z + 0.008, M.metal2);
    cylX(G, 0.0048, x + 0.028, x + 0.0305, y + 0.004, M.red, z, 12);
    cylX(G, 0.0038, x + 0.028, x + 0.0295, y - 0.005, M.glass, z, 10);
    d.laser = P2L(x + 0.034, y + 0.004, z);
  }
  return modelShadows(g);
}

const BUILDERS = { pistol: buildPistol, revolver: buildRevolver, smg: buildSMG, shotgun: buildShotgun, rifle: buildRifle, m4: buildM4, sniper: buildSniper, knife: buildKnife };
export function buildGun(type, M) { return modelShadows(BUILDERS[type](M)); }

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
    if (g !== o.geometry) g.dispose();
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
export function mergedGunGeometry(type, att = 0) {
  const key = type + ':' + (att | 0);
  if (!gunGeoCache[key]) {
    cacheMats ||= gunMaterials();
    const gun = type === 'nade' ? buildGrenade(cacheMats) : buildGun(type, cacheMats);
    if (att && type !== 'nade') decorateGun(gun, type, att, cacheMats);
    const geo = mergeToVertexColors(gun, 1.8), d = gun.userData;
    const data = {
      cls: d.cls, muzzle: d.muzzle, eject: d.eject, gripR: d.gripR,
      gripL: d.gripLObj ? d.gripL.clone().applyMatrix4(d.gripLObj.matrixWorld) : d.gripL,
      sight: d.sight, laser: d.laser, suppressed: !!d.suppressed, scope: !!d.scope, redDot: !!d.redDot, att: att | 0,
    };
    // Merged models keep only root-space anchors, never references to discarded animated source hierarchies.
    gunGeoCache[key] = { geo, data };
    gun.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
  return gunGeoCache[key];
}

// Build every merged model the match can need (all guns with every attachment set, loot items) up front,
// so nothing is extruded and merged in the middle of a fight. Returns the time taken (ms).
export function prewarmModels() {
  const t0 = performance.now();
  for (const type of ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'm4', 'sniper', 'knife', 'nade']) {
    const F = ATT_FIT[type] || {};
    const bits = [F.sup && 1, F.ext && 2, F.las && 4].filter(Boolean);
    for (let m = 0; m < 1 << bits.length; m++) mergedGunGeometry(type, bits.reduce((a, b, i) => (m & (1 << i) ? a | b : a), 0));
  }
  for (const k of ['ammo', 'med', 'water', 'armor', 'nade']) mergedItemGeometry(k);
  for (const v of [10, 50, 150]) mergedItemGeometry('cash', v);
  for (const k of ['sup', 'ext', 'las']) attachmentGeometry(k);
  for (const palette of APPEARANCE_PALETTES) {
    for (let i = 0; i < 3; i++) soldierGeometries({ head: APPEARANCE_OPTIONS.head[i].id, chest: APPEARANCE_OPTIONS.chest[i].id, legs: APPEARANCE_OPTIONS.legs[i].id, palette: palette.id }, 'survivor');
  }
  const creature = soldierGeometries(DEFAULT_APPEARANCE, 'monster');
  if (!soldierGeoCache.has('monster:fpHand')) soldierGeoCache.set('monster:fpHand', creature.hand.clone().rotateX(Math.PI / 2));
  return performance.now() - t0;
}

// ---------- attachments on their own (shop icons) ----------
export function attachmentGeometry(key) {
  const ck = 'att:' + key;
  if (itemGeoCache[ck]) return itemGeoCache[ck];
  cacheMats ||= gunMaterials();
  const M = cacheMats, g = new THREE.Group(), p = grp(g);
  if (key === 'sup') {
    cylX(p, 0.02, 0, 0.19, 0, M.metal, 0, 24);
    cylX(p, 0.021, 0, 0.02, 0, M.metal2, 0, 24);
    cylX(p, 0.0205, 0.175, 0.19, 0, M.metal2, 0, 24);
    for (let i = 1; i < 4; i++) cylX(p, 0.0203, 0.19 * i / 4 - 0.002, 0.19 * i / 4 + 0.002, 0, M.metal2, 0, 24);
    cylX(p, 0.007, 0.19, 0.1905, 0, M.dark, 0, 12);
  } else if (key === 'ext') {
    curvedMag(p, M, M.metal2, 0.1, 0.043, 0.045, 0.27, 0.024, 6);
    box(p, 0.064, 0.012, 0.028, 0.093, -0.272, 0, M.poly);
    box(p, 0.05, 0.01, 0.022, 0.072, 0.004, 0, M.brass);
  } else {
    box(p, 0.056, 0.022, 0.027, 0, 0, 0, M.poly);
    box(p, 0.034, 0.007, 0.022, 0, 0.014, 0, M.metal2);
    box(p, 0.012, 0.006, 0.006, -0.018, -0.012, 0.008, M.metal2);
    cylX(p, 0.0048, 0.028, 0.0305, 0.004, M.red, 0, 12);
    cylX(p, 0.0038, 0.028, 0.0295, -0.005, M.glass, 0, 10);
  }
  itemGeoCache[ck] = mergeToVertexColors(g, 1.8);
  return itemGeoCache[ck];
}

// ---------- loot items (origin at the bottom center, resting on the carpet) ----------
const itemGeoCache = {};
export const cashStacks = (v) => (v >= 100 ? 3 : v >= 45 ? 2 : 1);
export function mergedItemGeometry(k, v = 0) {
  const key = k === 'cash' ? 'cash' + cashStacks(v) : k;
  if (itemGeoCache[key]) return itemGeoCache[key];
  cacheMats ||= gunMaterials();
  const M = cacheMats, g = new THREE.Group();
  const C = (c) => new THREE.MeshBasicMaterial({ color: c });
  const cyl = (r0, r1, len, x, y, z, mat, seg = 16) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg).rotateZ(-Math.PI / 2), mat); m.position.set(x, y, z); g.add(m); return m; };
  switch (k) {
    case 'ammo': { // M2A1 ammo can
      const olive = C(0x3f4a29), dark = C(0x262b1a);
      box(g, 0.27, 0.15, 0.125, 0, 0.075, 0, olive);
      box(g, 0.28, 0.022, 0.135, 0, 0.16, 0, C(0x38421f));
      box(g, 0.285, 0.012, 0.03, 0, 0.152, 0.055, dark);
      box(g, 0.1, 0.01, 0.018, 0, 0.19, 0, C(0x1f1f1f));
      for (const x of [-0.048, 0.048]) box(g, 0.008, 0.02, 0.012, x, 0.18, 0, C(0x1f1f1f));
      box(g, 0.012, 0.06, 0.04, 0.14, 0.12, 0, dark);
      box(g, 0.14, 0.018, 0.127, -0.02, 0.09, 0, C(0xa8913a)); // stencil band
      box(g, 0.06, 0.01, 0.127, 0.07, 0.05, 0, C(0x8d7a33));
      break;
    }
    case 'med': { // first aid kit
      const white = C(0xd8d3c6), red = C(0xa51417);
      box(g, 0.24, 0.085, 0.165, 0, 0.0425, 0, white);
      box(g, 0.244, 0.012, 0.169, 0, 0.06, 0, C(0xb9b3a4));
      box(g, 0.11, 0.004, 0.032, 0, 0.087, 0, red); box(g, 0.032, 0.004, 0.11, 0, 0.087, 0, red);
      box(g, 0.05, 0.016, 0.003, -0.05, 0.042, 0.084, red); box(g, 0.016, 0.05, 0.003, -0.05, 0.042, 0.084, red);
      for (const x of [0.06, 0.1]) box(g, 0.022, 0.018, 0.006, x, 0.06, 0.084, C(0x2a2a2a));
      box(g, 0.08, 0.01, 0.016, 0, 0.094, -0.06, C(0x2a2a2a));
      break;
    }
    case 'water': { // almond water: a milky plastic bottle lying on its side
      cyl(0.034, 0.034, 0.19, 0, 0.034, 0, C(0xcfd3c4));
      cyl(0.034, 0.015, 0.032, 0.111, 0.034, 0, C(0xc6cabb));
      cyl(0.0155, 0.0155, 0.02, 0.137, 0.034, 0, C(0x2c5ca8));
      cyl(0.0348, 0.0348, 0.1, -0.012, 0.034, 0, C(0xc49a5a));
      cyl(0.0352, 0.0352, 0.02, -0.012, 0.034, 0, C(0x6a4424));
      cyl(0.033, 0.03, 0.012, -0.101, 0.034, 0, C(0xb8bcaf));
      break;
    }
    case 'armor': { // ceramic rifle plate with shooter's cut corners, lying flat
      const sh = mkShape([[-0.125, -0.16], [0.125, -0.16], [0.125, 0.1], [0.07, 0.16], [-0.07, 0.16], [-0.125, 0.1]]);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
      geo.rotateX(-Math.PI / 2); geo.translate(0, 0.004, 0);
      g.add(new THREE.Mesh(geo, C(0x383b33)));
      box(g, 0.11, 0.003, 0.07, 0, 0.0265, 0.03, C(0x8a7c55));
      box(g, 0.06, 0.003, 0.012, 0, 0.0275, -0.05, C(0x1c1c1c));
      break;
    }
    case 'nade': {
      const n = buildGrenade(M); n.rotation.z = Math.PI / 2; n.position.y = 0.034; g.add(n);
      break;
    }
    case 'cash': { // banded stacks of worn notes
      const spots = [[0, 0, 0, 0.1], [0.012, 1, 0.006, 0.35], [-0.03, 0, 0.08, -0.25]];
      for (let i = 0; i < cashStacks(v); i++) {
        const [x, lvl, z, r] = spots[i], s = new THREE.Group();
        s.position.set(x, 0.012 + lvl * 0.024, z); s.rotation.y = r; g.add(s);
        box(s, 0.156, 0.022, 0.068, 0, 0, 0, C(0x6c7a58));
        box(s, 0.15, 0.0225, 0.062, 0, 0, 0, C(0x7c8a66));
        box(s, 0.03, 0.0235, 0.0695, 0, 0, 0, C(0xd4ccae));
      }
      break;
    }
  }
  itemGeoCache[key] = mergeToVertexColors(g, 1.8);
  return itemGeoCache[key];
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
const ikDir = new THREE.Vector3(), ikBend = new THREE.Vector3();
function elbowBetween(out, shoulder, wrist, side, upperLength = 0.31, foreLength = 0.28) {
  const distance = ikDir.subVectors(wrist, shoulder).length();
  ikDir.multiplyScalar(1 / Math.max(distance, 1e-5));
  const reach = Math.min(distance, upperLength + foreLength - 0.001);
  const along = Math.max(0, Math.min(reach, (upperLength * upperLength - foreLength * foreLength + reach * reach) / (2 * Math.max(reach, 1e-5))));
  const bend = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  ikBend.set(side * 0.65, -1, 0.12).addScaledVector(ikDir, -ikBend.dot(ikDir)).normalize();
  out.copy(shoulder).addScaledVector(ikDir, along + Math.max(0, distance - reach) * 0.5).addScaledVector(ikBend, bend);
}

// A right-hand palm lies beside the grip; curled fingers wrap around its front, not through the receiver.
function fistGeometry(M, watch) {
  const g = new THREE.Group();
  part(new THREE.BoxGeometry(0.027, 0.069, 0.045), M.glove, g, 0.025, -0.001, 0.005);
  for (let i = 0; i < 4; i++) {
    const y = 0.027 - i * 0.018, r = i ? 0.0075 : 0.007;
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.029, y, -0.011), new THREE.Vector3(0.022, y, -0.030),
      new THREE.Vector3(-0.006, y, -0.032), new THREE.Vector3(-0.018, y, -0.015),
    ]);
    part(new THREE.TubeGeometry(path, 8, r, 6, false), M.glove, g);
    part(new THREE.BoxGeometry(0.009, 0.010, 0.016), M.glove2, g, 0.034, y, -0.008);
  }
  const thumb = part(new THREE.CapsuleGeometry(0.009, 0.031, 3, 8), M.glove, g, 0.007, 0.040, 0.010);
  thumb.rotation.set(0.45, 0, -0.95);
  const cuff = part(new THREE.CylinderGeometry(0.031, 0.032, 0.047, 12), M.glove2, g, 0.021, -0.057, 0.031);
  cuff.rotation.x = -0.55;
  if (watch) {
    part(new THREE.BoxGeometry(0.030, 0.025, 0.010), M.watch, g, 0.038, -0.063, 0.050);
    part(new THREE.BoxGeometry(0.020, 0.016, 0.002), M.steel, g, 0.038, -0.063, 0.056);
  }
  return g;
}

const HAND_ROT = {
  pistol: [-0.16, 0, -0.06], revolver: [-0.12, 0, -0.04], shotgun: [-0.35, 0, 0], knife: [-0.4, 0, 0.1], default: [-0.14, 0, -0.03],
};

// First-person arms attached to a viewmodel gun. Hand targets can be overridden by animations.
export class FPArms {
  constructor(M) {
    this.group = new THREE.Group();
    this.M = M; this.sleeveWidth = 1;
    const up = limbGeo(0.048, 0.042), fore = limbGeo(0.039, 0.029);
    this.rU = new THREE.Mesh(up, M.sleeve); this.rF = new THREE.Mesh(fore, M.sleeve);
    this.lU = new THREE.Mesh(up, M.sleeve); this.lF = new THREE.Mesh(fore, M.sleeve);
    this.rH = fistGeometry(M, false); this.lH = fistGeometry(M, true);
    this.lH.scale.x = -1;
    this.group.add(this.rU, this.rF, this.lU, this.lF, this.rH, this.lH);
    this.shR = new THREE.Vector3(0.20, -0.32, 0.05);
    this.shL = new THREE.Vector3(-0.20, -0.32, 0.05);
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); this.e = new THREE.Vector3(); this.wrist = new THREE.Vector3();
    this.back = new THREE.Vector3(); this.t = new THREE.Vector3(); this.parentInv = new THREE.Matrix4();
    this.lRest = new THREE.Vector3(-0.2, -0.46, -0.3);
    this.humanHands = [this.rH, this.lH]; this.humanGeometries = [up, fore]; this.role = 'survivor';
    this.q = new THREE.Quaternion();
  }
  setAppearance(value) {
    const a = normalizeAppearance(value), palette = APPEARANCE_PALETTES.find((p) => p.id === a.palette);
    this.M.sleeve.color.set(palette.color);
    this.M.cuff.color.set(palette.color).multiplyScalar(0.70);
    this.M.glove2.color.set(palette.color).multiplyScalar(0.65);
    this.sleeveWidth = a.chest === 'jacket' ? 1.14 : a.chest === 'rig' ? 0.94 : 1;
  }
  setRole(role) {
    const next = role === 'monster' ? 'monster' : 'survivor';
    if (next === this.role) return;
    this.role = next;
    this.group.remove(this.rH, this.lH);
    if (next === 'monster') {
      const G = soldierGeometries(DEFAULT_APPEARANCE, 'monster');
      if (!soldierGeoCache.has('monster:fpHand')) soldierGeoCache.set('monster:fpHand', G.hand.clone().rotateX(Math.PI / 2));
      if (!this.clawHands) {
        this.creatureMat = new THREE.MeshPhongMaterial({ vertexColors: true, color: 0xffffff, shininess: 18, specular: 0x343b32 });
        this.clawHands = [new THREE.Mesh(soldierGeoCache.get('monster:fpHand'), this.creatureMat), new THREE.Mesh(soldierGeoCache.get('monster:fpHand'), this.creatureMat)];
        this.clawHands[1].scale.x = -1;
      }
      this.rH = this.clawHands[0]; this.lH = this.clawHands[1];
      this.rU.geometry = this.lU.geometry = G.upper; this.rF.geometry = this.lF.geometry = G.fore;
      this.rU.material = this.lU.material = this.rF.material = this.lF.material = this.creatureMat;
    } else {
      this.rH = this.humanHands[0]; this.lH = this.humanHands[1];
      this.rU.geometry = this.lU.geometry = this.humanGeometries[0]; this.rF.geometry = this.lF.geometry = this.humanGeometries[1];
      this.rU.material = this.lU.material = this.rF.material = this.lF.material = this.M.sleeve;
    }
    this.group.add(this.rH, this.lH);
  }
  updateCreature(gun, o) {
    const d = gun.userData;
    for (let i = 0; i < 2; i++) {
      const hand = i ? this.lH : this.rH, target = i ? this.b : this.a, spec = i ? o.lh : o.rh;
      target.copy(i ? d.gripL : d.gripR).applyMatrix4(gun.matrix);
      if (spec && spec.w > 0) target.lerp(spec.p, spec.w);
      hand.position.copy(target);
      hand.quaternion.copy(gun.quaternion).multiply(tmpQ.setFromEuler(tmpE.set(i ? -0.08 : 0.06, i ? -0.22 : 0.14, i ? -0.06 : 0.06)));
      this.wrist.set(0, 0, 0.026).applyQuaternion(hand.quaternion).add(target);
      elbowBetween(this.e, i ? this.shL : this.shR, this.wrist, i ? -1 : 1, 0.33, 0.36);
      spanBetween(i ? this.lU : this.rU, i ? this.shL : this.shR, this.e);
      spanBetween(i ? this.lF : this.rF, this.e, this.wrist);
    }
  }
  // gun: viewmodel gun group (same parent space as this.group); o: { lh: {w, p, r}, rh: {w, p, r}, lFree }
  update(gun, cls, o = {}) {
    const d = gun.userData;
    gun.updateMatrixWorld(true);
    if (this.role === 'monster') { this.updateCreature(gun, o); return; }
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
    this.wrist.set(0.021, -0.057, 0.034).applyQuaternion(this.rH.quaternion).add(hR);
    this.limb(this.shR, this.wrist, this.rU, this.rF, 1);
    // left (support) hand
    let hL;
    if (d.gripL) {
      if (d.gripLObj) {
        this.parentInv.copy(gun.parent.matrixWorld).invert();
        hL = this.b.copy(d.gripL).applyMatrix4(d.gripLObj.matrixWorld).applyMatrix4(this.parentInv);
      } else hL = this.b.copy(d.gripL).applyMatrix4(gun.matrix);
      if (cls === 'pistol' || cls === 'revolver') {
        this.lH.quaternion.copy(gq).multiply(tmpQ.setFromEuler(tmpE.set(-0.16, 0.08, 0.24)));
        this.back.set(-0.021, -0.057, 0.034);
      } else {
        this.lH.quaternion.copy(gq).multiply(tmpQ.setFromEuler(tmpE.set(1.24, 0.12, -1.42)));
        this.back.set(-0.021, -0.057, 0.034);
      }
    } else {
      hL = this.b.copy(this.lRest);
      this.lH.quaternion.setFromEuler(tmpE.set(0.3, 0.2, 0.9));
      this.back.set(-0.021, -0.057, 0.034);
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
    const e = this.e;
    elbowBetween(e, sh, hand, side, 0.32, 0.29);
    spanBetween(upper, sh, e);
    spanBetween(fore, e, hand);
    upper.scale.x = upper.scale.z = this.sleeveWidth;
    fore.scale.x = fore.scale.z = this.sleeveWidth;
  }
}

// ---------- third-person operator ----------
function part(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = !mat.transparent; m.receiveShadow = true;
  parent.add(m); return m;
}
const soldierGeoCache = new Map(), constructionMats = new Map(), paletteMats = new Map();
function colorMat(color) {
  if (!constructionMats.has(color)) constructionMats.set(color, new THREE.MeshBasicMaterial({ color }));
  return constructionMats.get(color);
}
function paletteFor(id) {
  if (!paletteMats.has(id)) {
    const color = new THREE.Color(APPEARANCE_PALETTES.find((p) => p.id === id).color);
    paletteMats.set(id, {
      cloth: colorMat(color.getHex()), equipment: colorMat(color.clone().multiplyScalar(0.62).getHex()),
      seam: colorMat(color.clone().multiplyScalar(1.2).getHex()),
      dark: colorMat(0x20262a), skin: colorMat(0xa88773), glove: colorMat(0x24282a),
      glove2: colorMat(0x383e3f), steel: colorMat(0x778187), watch: colorMat(0x151a1d),
    });
  }
  return paletteMats.get(id);
}
function cachedPart(key, build) {
  if (!soldierGeoCache.has(key)) {
    const g = new THREE.Group(); build(g);
    soldierGeoCache.set(key, mergeToVertexColors(g, 1.65));
    g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
  return soldierGeoCache.get(key);
}
function operatorHead(g, kind, M) {
  part(new THREE.CylinderGeometry(0.048, 0.054, 0.076, 12), kind === 'beanie' ? M.skin : M.dark, g, 0, -0.012, 0);
  part(new THREE.SphereGeometry(0.115, 16, 12).scale(0.86, 1.08, 0.91), kind === 'beanie' ? M.skin : M.dark, g, 0, 0.10, 0);
  if (kind === 'helmet') {
    part(new THREE.SphereGeometry(0.132, 18, 12, 0, Math.PI * 2, 0, 1.68).scale(1, 0.90, 1.04), M.equipment, g, 0, 0.146, 0.010);
    part(new THREE.BoxGeometry(0.176, 0.043, 0.029), M.dark, g, 0, 0.125, -0.103);
    part(new THREE.BoxGeometry(0.143, 0.026, 0.004), colorMat(0x52616a), g, 0, 0.126, -0.120);
    for (const s of [-1, 1]) {
      part(new THREE.BoxGeometry(0.023, 0.065, 0.10), M.equipment, g, s * 0.132, 0.111, 0.010);
      part(new THREE.BoxGeometry(0.020, 0.014, 0.084), M.dark, g, s * 0.139, 0.166, 0.010);
    }
    part(new THREE.BoxGeometry(0.033, 0.025, 0.018), M.dark, g, 0, 0.19, -0.112);
  } else if (kind === 'beanie') {
    part(new THREE.SphereGeometry(0.124, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.98, 0.83, 1), M.cloth, g, 0, 0.150, 0.008);
    part(new THREE.CylinderGeometry(0.122, 0.123, 0.028, 16), M.seam, g, 0, 0.153, 0.008);
    part(new THREE.BoxGeometry(0.025, 0.037, 0.019), M.skin, g, 0, 0.098, -0.104);
    part(new THREE.BoxGeometry(0.042, 0.007, 0.005), M.dark, g, 0, 0.050, -0.095);
    for (const s of [-1, 1]) {
      part(new THREE.BoxGeometry(0.024, 0.007, 0.008), M.dark, g, s * 0.037, 0.129, -0.102);
      part(new THREE.BoxGeometry(0.025, 0.006, 0.010), M.dark, g, s * 0.039, 0.143, -0.099);
    }
    part(new THREE.BoxGeometry(0.024, 0.062, 0.040), M.dark, g, 0.107, 0.106, 0.006);
    const mic = part(new THREE.CylinderGeometry(0.003, 0.003, 0.085, 6), M.dark, g, 0.076, 0.067, -0.059);
    mic.rotation.set(0.65, 0, 1.0);
  } else {
    part(new THREE.SphereGeometry(0.129, 16, 12).scale(0.99, 1.08, 1.03), M.cloth, g, 0, 0.115, 0.020);
    for (const s of [-1, 1]) {
      part(new THREE.SphereGeometry(0.045, 12, 8).scale(1, 0.66, 0.30), M.dark, g, s * 0.049, 0.139, -0.108);
      cylZ(g, 0.031, 0.042, s * 0.066, 0.056, -0.132, M.equipment, 16);
      cylZ(g, 0.025, 0.003, s * 0.066, 0.056, -0.156, M.dark, 16);
    }
    part(new THREE.BoxGeometry(0.091, 0.065, 0.052), M.dark, g, 0, 0.065, -0.114);
    part(new THREE.BoxGeometry(0.064, 0.007, 0.007), M.seam, g, 0, 0.086, -0.143);
  }
}
function operatorTorso(g, kind, M) {
  part(new THREE.CapsuleGeometry(0.17, 0.23, 4, 14).scale(1.10, 1, 0.77), M.cloth, g, 0, 0.29, 0);
  part(new THREE.BoxGeometry(0.31, 0.045, 0.25), M.dark, g, 0, 0.009, 0);
  part(new THREE.BoxGeometry(0.050, 0.036, 0.016), M.steel, g, 0, 0.013, -0.132);
  if (kind === 'carrier') {
    for (const z of [-0.144, 0.144]) part(new THREE.BoxGeometry(0.326, 0.31, 0.034), M.equipment, g, 0, 0.327, z);
    for (const s of [-1, 1]) part(new THREE.BoxGeometry(0.052, 0.32, 0.25), M.equipment, g, s * 0.130, 0.398, 0);
    for (let i = -1; i <= 1; i++) part(new THREE.BoxGeometry(0.085, 0.112, 0.057), M.equipment, g, i * 0.101, 0.228, -0.182);
    for (let i = 0; i < 4; i++) part(new THREE.BoxGeometry(0.282, 0.008, 0.005), M.seam, g, 0, 0.278 + i * 0.04, -0.165);
    part(new THREE.BoxGeometry(0.26, 0.30, 0.14), M.equipment, g, 0, 0.310, 0.194);
    part(new THREE.BoxGeometry(0.058, 0.099, 0.036), M.dark, g, 0.151, 0.469, 0.172);
    part(new THREE.CylinderGeometry(0.003, 0.003, 0.13, 6), M.dark, g, 0.151, 0.57, 0.172);
  } else if (kind === 'rig') {
    for (const s of [-1, 1]) {
      const strap = part(new THREE.BoxGeometry(0.033, 0.40, 0.017), M.dark, g, s * 0.102, 0.347, -0.139);
      strap.rotation.z = s * 0.25;
      const back = part(new THREE.BoxGeometry(0.033, 0.39, 0.018), M.dark, g, s * 0.082, 0.34, 0.138);
      back.rotation.z = s * -0.40;
    }
    part(new THREE.BoxGeometry(0.31, 0.105, 0.025), M.equipment, g, 0, 0.244, -0.142);
    for (let i = 0; i < 4; i++) part(new THREE.BoxGeometry(0.064, 0.092, 0.052), M.equipment, g, -0.114 + i * 0.076, 0.234, -0.181);
    part(new THREE.BoxGeometry(0.10, 0.072, 0.023), M.equipment, g, -0.072, 0.402, -0.135);
    part(new THREE.BoxGeometry(0.055, 0.095, 0.036), M.dark, g, 0.168, 0.09, 0.006);
  } else {
    part(new THREE.BoxGeometry(0.355, 0.16, 0.265), M.cloth, g, 0, 0.050, 0);
    part(new THREE.CylinderGeometry(0.073, 0.081, 0.063, 12), M.equipment, g, 0, 0.526, 0);
    part(new THREE.BoxGeometry(0.008, 0.43, 0.012), M.steel, g, 0, 0.294, -0.139);
    for (const s of [-1, 1]) {
      const pocket = part(new THREE.BoxGeometry(0.11, 0.080, 0.024), M.equipment, g, s * 0.102, 0.224, -0.135);
      pocket.rotation.z = s * -0.12;
      part(new THREE.SphereGeometry(0.072, 10, 8).scale(0.70, 0.61, 1.22), M.equipment, g, s * 0.19, 0.47, 0);
    }
  }
  part(new THREE.BoxGeometry(0.047, 0.066, 0.031), M.dark, g, 0.072, 0.430, -0.167);
  part(new THREE.BoxGeometry(0.017, 0.013, 0.005), colorMat(0x641910), g, 0.072, 0.442, -0.186);
}
function operatorLeg(g, kind, segment, M) {
  if (segment === 'pelvis') {
    part(new THREE.CapsuleGeometry(0.14, 0.064, 3, 12).scale(1.18, 0.66, 0.86), M.equipment, g, 0, -0.015, 0);
  } else if (segment === 'thigh') {
    const r = kind === 'cargo' ? 0.103 : 0.087;
    part(new THREE.CylinderGeometry(r, r * 0.80, 0.43, 12), M.cloth, g, 0, -0.215, 0);
    if (kind === 'cargo') {
      for (const s of [-1, 1]) part(new THREE.BoxGeometry(0.049, 0.15, 0.096), M.equipment, g, s * 0.086, -0.21, 0.009);
    } else if (kind === 'armored') {
      part(new THREE.BoxGeometry(0.135, 0.21, 0.033), M.equipment, g, 0, -0.20, -0.074);
      for (const y of [-0.13, -0.30]) part(new THREE.BoxGeometry(0.153, 0.018, 0.161), M.dark, g, 0, y, 0);
    } else part(new THREE.BoxGeometry(0.014, 0.24, 0.012), M.seam, g, 0.079, -0.23, 0);
  } else if (segment === 'shin') {
    part(new THREE.CylinderGeometry(kind === 'cargo' ? 0.080 : 0.067, 0.051, 0.40, 12), M.cloth, g, 0, -0.20, 0);
    if (kind !== 'cargo') part(new THREE.SphereGeometry(0.073, 10, 8).scale(0.96, 0.70, 0.55), M.dark, g, 0, -0.021, -0.060);
    if (kind === 'armored') part(new THREE.BoxGeometry(0.108, 0.258, 0.029), M.equipment, g, 0, -0.175, -0.064);
    part(new THREE.CylinderGeometry(0.054, 0.056, 0.055, 12), M.dark, g, 0, -0.366, 0);
  } else {
    const width = kind === 'tactical' ? 0.115 : 0.132, depth = kind === 'tactical' ? 0.246 : 0.277;
    part(new THREE.BoxGeometry(width, 0.11, depth), M.glove, g, 0, 0, -0.045);
    part(new THREE.BoxGeometry(width + 0.007, 0.019, depth + 0.009), M.dark, g, 0, -0.059, -0.046);
    part(new THREE.CylinderGeometry(0.059, 0.060, 0.085, 12), M.glove2, g, 0, 0.065, 0.002);
    if (kind === 'armored') part(new THREE.BoxGeometry(0.129, 0.035, 0.09), M.equipment, g, 0, -0.024, -0.134);
    for (let i = 0; i < 4; i++) part(new THREE.BoxGeometry(0.055, 0.005, 0.007), M.seam, g, 0, 0.057, -0.009 - i * 0.018);
  }
}
function creaturePart(g, kind) {
  const hide = colorMat(0x303b35), bone = colorMat(0x92917c), dark = colorMat(0x101714);
  if (kind === 'torso') {
    part(new THREE.CapsuleGeometry(0.145, 0.28, 4, 14).scale(1.18, 1, 0.67), hide, g, 0, 0.29, 0);
    for (let i = 0; i < 6; i++) {
      const rib = part(new THREE.TorusGeometry(0.13 - i * 0.005, 0.006, 5, 16, Math.PI), bone, g, 0, 0.40 - i * 0.041, 0);
      rib.rotation.x = -Math.PI / 2; rib.scale.y = 0.74;
      const spine = part(new THREE.ConeGeometry(0.025, 0.095, 5), bone, g, 0, 0.42 - i * 0.047, 0.125);
      spine.rotation.x = Math.PI / 2;
    }
    part(new THREE.BoxGeometry(0.021, 0.29, 0.025), dark, g, 0, 0.32, -0.10);
    for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.065, 10, 8).scale(1, 0.78, 0.90), hide, g, s * 0.194, 0.47, 0);
  } else if (kind === 'head') {
    part(new THREE.CylinderGeometry(0.036, 0.043, 0.105, 10), hide, g, 0, 0.008, 0);
    part(new THREE.SphereGeometry(0.102, 16, 12).scale(0.81, 1.69, 0.90), hide, g, 0, 0.107, -0.009);
    for (const s of [-1, 1]) {
      part(new THREE.BoxGeometry(0.039, 0.018, 0.012), dark, g, s * 0.036, 0.121, -0.094);
      part(new THREE.BoxGeometry(0.010, 0.005, 0.004), bone, g, s * 0.036, 0.120, -0.102);
    }
    part(new THREE.BoxGeometry(0.065, 0.027, 0.012), dark, g, 0, 0.041, -0.092);
    for (let i = 0; i < 6; i++) part(new THREE.ConeGeometry(0.004, 0.022, 5), bone, g, -0.026 + i * 0.0105, 0.043, -0.101);
  } else if (kind === 'pelvis') {
    part(new THREE.CapsuleGeometry(0.13, 0.08, 3, 12).scale(1.17, 0.65, 0.79), hide, g, 0, -0.011, 0);
  } else if (kind === 'thigh' || kind === 'shin') {
    const thigh = kind === 'thigh', len = thigh ? 0.43 : 0.40;
    part(new THREE.CylinderGeometry(thigh ? 0.072 : 0.048, thigh ? 0.046 : 0.033, len, 10), hide, g, 0, -len / 2, 0);
    part(new THREE.CylinderGeometry(thigh ? 0.025 : 0.019, 0.012, len * 0.78, 8), bone, g, 0.014, -len / 2, -0.034);
    if (!thigh) part(new THREE.SphereGeometry(0.049, 8, 6), bone, g, 0, 0, -0.029);
  } else if (kind === 'foot') {
    part(new THREE.BoxGeometry(0.087, 0.107, 0.177), hide, g, 0, 0, -0.025);
    for (let i = 0; i < 4; i++) {
      const claw = part(new THREE.ConeGeometry(0.010, 0.10, 6), bone, g, -0.030 + i * 0.020, -0.033, -0.141);
      claw.rotation.x = -Math.PI / 2;
    }
  } else if (kind === 'hand') {
    part(new THREE.CapsuleGeometry(0.030, 0.067, 3, 10).scale(1, 1, 0.72), hide, g, 0, -0.029, 0);
    for (let i = 0; i < 4; i++) {
      const finger = part(new THREE.CapsuleGeometry(0.008, 0.097 - Math.abs(i - 1.5) * 0.012, 3, 7), hide, g, -0.027 + i * 0.018, -0.104, -0.024);
      finger.rotation.x = 0.26;
      const claw = part(new THREE.ConeGeometry(0.007, 0.046, 6), bone, g, -0.027 + i * 0.018, -0.167, -0.042);
      claw.rotation.x = 0.26; claw.rotation.z = Math.PI;
    }
  } else {
    part(limbGeo(kind === 'upper' ? 0.061 : 0.042, kind === 'upper' ? 0.046 : 0.027, 10), hide, g);
  }
}
function soldierGeometries(a, role) {
  if (role === 'monster') {
    const key = 'monster';
    if (!soldierGeoCache.has(key)) {
      const G = {};
      for (const name of ['head', 'torso', 'pelvis', 'thigh', 'shin', 'foot', 'upper', 'fore', 'hand']) G[name] = cachedPart(key + ':' + name, (g) => creaturePart(g, name));
      soldierGeoCache.set(key, G);
    }
    return soldierGeoCache.get(key);
  }
  const key = [a.head, a.chest, a.legs, a.palette].join(':');
  if (!soldierGeoCache.has(key)) {
    const M = paletteFor(a.palette), G = {};
    G.head = cachedPart('head:' + a.head + ':' + a.palette, (g) => operatorHead(g, a.head, M));
    G.torso = cachedPart('chest:' + a.chest + ':' + a.palette, (g) => operatorTorso(g, a.chest, M));
    for (const segment of ['pelvis', 'thigh', 'shin', 'foot']) G[segment] = cachedPart('legs:' + a.legs + ':' + a.palette + ':' + segment, (g) => operatorLeg(g, a.legs, segment, M));
    G.upper = cachedPart('upper:' + a.palette, (g) => part(limbGeo(0.063, 0.048), M.cloth, g));
    G.fore = cachedPart('fore:' + a.palette, (g) => part(limbGeo(0.047, 0.032), M.cloth, g));
    G.hand = cachedPart('hand', (g) => g.add(fistGeometry(M, false)));
    soldierGeoCache.set(key, G);
  }
  return soldierGeoCache.get(key);
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
  pistol: [0.0, 0.0, -0.36], revolver: [0.0, 0.0, -0.36], knife: [0.12, -0.12, -0.30], default: [0.075, -0.035, -0.18],
};
const easeOut = (x) => 1 - (1 - x) * (1 - x);
const smoothStride = (x) => x * x * (3 - 2 * x);

export class Soldier {
  constructor(color, weapon = 'pistol', appearance = DEFAULT_APPEARANCE) {
    this.appearance = normalizeAppearance(appearance); this.role = 'survivor';
    const G = soldierGeometries(this.appearance, this.role);
    this.mat = bakeMaterial({ vertexColors: true, color: 0xffffff, shininess: 18, specular: 0x1c2224 }, { uniform: true, phong: true });
    this.teamMat = bakeMaterial({ color, shininess: 8, specular: 0x111111 }, { uniform: true, phong: true });
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    this.pelvis = part(G.pelvis, this.mat, this.body, 0, 0.89, 0);
    this.spine = new THREE.Group(); this.spine.position.set(0, 0.96, 0); this.body.add(this.spine);
    this.torso = part(G.torso, this.mat, this.spine);
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.58, 0); this.spine.add(this.neck);
    this.head = part(G.head, this.mat, this.neck);
    this.legs = [-1, 1].map((s) => {
      const hip = new THREE.Group(); hip.position.set(0.105 * s, 0.89, 0); this.body.add(hip);
      const thigh = part(G.thigh, this.mat, hip);
      const knee = new THREE.Group(); knee.position.set(0, -0.43, 0); hip.add(knee);
      const shin = part(G.shin, this.mat, knee);
      const ankle = new THREE.Group(); ankle.position.set(0, -0.40, 0); knee.add(ankle);
      const foot = part(G.foot, this.mat, ankle);
      return { hip, knee, ankle, thigh, shin, foot };
    });
    this.aim = new THREE.Group(); this.aim.position.set(0, 0.42, -0.02); this.spine.add(this.aim);
    const bandGeo = cachedPart('team:band', (g) => part(new THREE.CylinderGeometry(0.062, 0.059, 0.11, 12).translate(0, -0.23, 0), colorMat(0xffffff), g));
    this.arms = [0, 1].map((i) => {
      const u = part(G.upper, this.mat, this.spine), f = part(G.fore, this.mat, this.spine), h = part(G.hand, this.mat, this.spine);
      h.scale.x = i ? -1 : 1;
      const band = part(bandGeo, this.teamMat, u);
      return { u, f, h, band };
    });
    this.badges = new THREE.Group(); this.spine.add(this.badges);
    const badgeGeo = cachedPart('team:badge', (g) => part(new THREE.BoxGeometry(0.102, 0.031, 0.008), colorMat(0xffffff), g));
    this.badgeFront = part(badgeGeo, this.teamMat, this.badges, -0.06, 0.363, -0.169);
    this.badgeBack = part(badgeGeo, this.teamMat, this.badges, 0, 0.359, 0.270);
    this.gun = null; this.gunType = null; this.gunAtt = 0;
    this.phase = 0; this.deadT = 0; this.act = null; this.actT = 0;
    this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3();
    this.sInv = new THREE.Matrix4(); this.axis = new THREE.Vector3(); this.q = new THREE.Quaternion();
    this.lRest = new THREE.Vector3(-0.18, 0.16, -0.19);
    this.setAppearance(this.appearance);
    this.setWeapon(weapon);
  }
  setAppearance(value) {
    this.appearance = normalizeAppearance(value);
    const G = soldierGeometries(this.appearance, this.role);
    this.torso.geometry = G.torso; this.head.geometry = G.head; this.pelvis.geometry = G.pelvis;
    for (const l of this.legs) { l.thigh.geometry = G.thigh; l.shin.geometry = G.shin; l.foot.geometry = G.foot; }
    for (const a of this.arms) { a.u.geometry = G.upper; a.f.geometry = G.fore; a.h.geometry = G.hand; a.band.visible = this.role !== 'monster'; }
    this.badges.visible = this.role !== 'monster';
    this.badgeFront.position.z = this.appearance.chest === 'carrier' ? -0.169 : -0.146;
    this.badgeBack.position.z = this.appearance.chest === 'carrier' ? 0.270 : 0.146;
  }
  setRole(role) {
    const next = role === 'monster' ? 'monster' : 'survivor';
    if (next === this.role) return;
    this.role = next; this.setAppearance(this.appearance);
    this.setWeapon(this.requestedWeapon || 'pistol', this.requestedAtt || 0);
    if (this.marker) this.marker.visible = next !== 'monster' && !!this.friendly;
  }
  setWeapon(type, att = 0) {
    this.requestedWeapon = type; this.requestedAtt = att;
    if (this.role === 'monster') { type = 'knife'; att = 0; }
    if (this.gunType === type && this.gunAtt === att) { this.gun.visible = this.role !== 'monster'; return; }
    if (this.gun) this.aim.remove(this.gun);
    const { geo, data } = mergedGunGeometry(type, att);
    this.gun = part(geo, this.mat, this.aim); this.gun.userData = data;
    this.gunType = type; this.gunAtt = att;
    const h = HOLD[type] || HOLD.default;
    this.gun.position.set(h[0], h[1], h[2]); this.gun.visible = this.role !== 'monster';
  }
  muzzleWorld(out) {
    return this.role === 'monster' ? out.set(0, -0.14, -0.04).applyMatrix4(this.arms[0].h.matrixWorld) : out.copy(this.gun.userData.muzzle).applyMatrix4(this.gun.matrixWorld);
  }
  dispose() {
    this.root.removeFromParent(); this.mat.dispose(); this.teamMat.dispose();
  }

  // ---- ragdoll-style corpse: the whole body is thrown, tumbles about the hips and goes limp ----
  // c: { x, y, z (hip center), yaw, dir (fall direction, model space), th (tumble angle), air (0..1), t, head, seed }
  ragdoll(dt, c, light) {
    this.mat.userData.uLight.value.setRGB(light, light * 0.96, light * 0.85);
    this.teamMat.userData.uLight.value.copy(this.mat.userData.uLight.value);
    if (this.marker) this.marker.visible = false;
    this.gun.visible = false;
    this.root.position.set(c.x, c.y - 0.95, c.z);
    this.root.rotation.y = c.yaw;
    this.axis.set(Math.cos(c.dir), 0, -Math.sin(c.dir));
    this.body.quaternion.setFromAxisAngle(this.axis, c.th);
    this.q.setFromAxisAngle(UP, c.twist || 0);
    this.body.quaternion.premultiply(this.q);
    // rotate about the hips instead of the feet
    this.v1.set(0, 0.95, 0);
    this.v2.copy(this.v1).applyQuaternion(this.body.quaternion);
    this.body.position.copy(this.v1).sub(this.v2);
    const t = c.t, a = c.air, sd = c.seed || 0, limp = 1 - a;
    this.pelvis.position.y = 0.89; this.spine.position.y = 0.96;
    this.spine.rotation.set(-0.25 * limp + Math.sin(t * 11 + sd) * 0.25 * a, Math.sin(sd * 3) * 0.2, Math.sin(sd) * 0.25);
    this.neck.rotation.set(c.head ? -0.75 : 0.35 * limp - 0.2 + Math.sin(t * 13 + sd) * 0.4 * a, 0, Math.sin(sd * 5) * 0.5 * limp);
    for (let i = 0; i < 2; i++) {
      const l = this.legs[i], s2 = i ? 1 : -1;
      l.hip.position.y = 0.89;
      l.hip.rotation.set(Math.sin(t * 9 + i * 2.1 + sd) * 0.7 * a + (0.15 + 0.2 * Math.sin(sd + i)) * limp, 0, s2 * (0.12 + 0.1 * limp));
      l.knee.rotation.x = -(0.25 + Math.abs(Math.sin(t * 7 + i + sd)) * 0.8 * a + (i ? 0.35 : 0.1) * limp);
      l.ankle.rotation.x = 0.2 * limp;
    }
    // arms flail in the air and fall open on the carpet
    for (let i = 0; i < 2; i++) {
      const ar = this.arms[i], sx = i === 0 ? 0.23 : -0.23, sg = Math.sign(sx);
      const sh = this.v2.set(sx, 0.5, 0.02);
      const hand = this.v1.set(sx + sg * (0.42 + 0.1 * Math.sin(sd + i)), 0.62 + 0.25 * Math.sin(sd * 2 + i), 0.12 * Math.sin(sd * 4 + i));
      hand.x += Math.sin(t * 10 + i * 1.7 + sd) * 0.2 * a; hand.y += Math.cos(t * 8 + i + sd) * 0.3 * a;
      const e = this.v3.addVectors(sh, hand).multiplyScalar(0.5); e.y -= 0.06;
      spanBetween(ar.u, sh, e); spanBetween(ar.f, e, hand);
      ar.h.position.copy(hand);
    }
  }
  // small blue chevron over teammates' heads (team deathmatch)
  setFriendly(on) {
    this.friendly = !!on;
    if (on && this.role !== 'monster' && !this.marker) {
      this.marker = new THREE.Sprite(friendMarkerMaterial());
      this.marker.scale.set(0.11, 0.11, 1);
      this.marker.position.set(0, 2.02, 0);
      this.root.add(this.marker);
    }
    if (this.marker) this.marker.visible = !!on && this.role !== 'monster';
  }
  flinch(k, side) { this.flinchK = Math.min(1.2, (this.flinchK || 0) + 0.5 + k); this.flinchDir = side || (Math.random() < 0.5 ? -1 : 1); }
  // one-shot upper-body actions: 'swing', 'heavy', 'throw'
  action(name) { this.act = name; this.actT = 0; }
  // dir: fall direction in the model's local space (radians, 0 = backwards)
  die(dir, head) { this.dieDir = dir; this.dieFast = head ? 1.6 : 1; this.deadT = 0; this.dieTwist = (Math.random() - 0.5) * 0.6; }
  // s: {x,y,z,yaw, pitch, crouch, speed, alive, flash, lean, reload, sprint, ads}
  update(dt, s, light) {
    this.mat.userData.uLight.value.setRGB(light, light * 0.96, light * 0.85);
    this.teamMat.userData.uLight.value.copy(this.mat.userData.uLight.value);
    this.root.position.set(s.x, s.y, s.z); this.root.rotation.y = s.yaw;
    const monster = this.role === 'monster', cr = s.crouch ? 1 : 0;
    this.cr = (this.cr ?? cr) + (cr - (this.cr ?? cr)) * (1 - Math.exp(-10 * dt));
    this.rl = (this.rl || 0) + ((s.reload && !monster ? 1 : 0) - (this.rl || 0)) * (1 - Math.exp(-8 * dt));
    this.sp = (this.sp || 0) + ((s.sprint ? 1 : 0) - (this.sp || 0)) * (1 - Math.exp(-8 * dt));
    const c = this.cr, speed = Math.max(0, s.speed || 0), sw = Math.min(1, speed / 3);
    this.phase = (this.phase + dt * speed * (monster ? 2.2 : 2.7)) % (Math.PI * 2);
    const drop = c * 0.48 + sw * 0.065 * (1 - c), bob = -(Math.sin(this.phase) ** 2) * 0.009 * sw;
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
    this.pelvis.position.y = 0.89 - drop + bob;
    this.spine.position.y = 0.96 - drop + bob;
    this.pelvis.rotation.y = Math.sin(this.phase) * 0.045 * sw;
    this.spine.rotation.x = (s.pitch || 0) * 0.26 - c * 0.08 + fk * 0.22 - this.sp * 0.10 + (monster ? -0.10 : 0);
    this.spine.rotation.z = -lean * 0.36 + fk * 0.12 * (this.flinchDir || 1) + Math.sin(this.phase) * 0.024 * sw;
    this.spine.rotation.y = ay * 0.4 - Math.sin(this.phase) * 0.035 * sw;
    this.neck.rotation.x = (s.pitch || 0) * 0.42 + fk * 0.3 - this.spine.rotation.x * 0.4;
    this.neck.rotation.z = lean * 0.15 - this.spine.rotation.z * 0.45;
    const low = Math.max(this.rl, this.sp * 0.8);
    this.aim.rotation.x = (s.pitch || 0) * 0.74 + c * 0.08 - fk * 0.2 - low * 0.55 + ax;
    this.aim.rotation.y = ay; this.aim.rotation.z = this.rl * 0.5 + az;
    // Foot targets stay on the carpet through the planted half-step; the knees bend rather than sinking below it.
    for (let i = 0; i < 2; i++) {
      const l = this.legs[i], phase = (this.phase + i * Math.PI) % (Math.PI * 2);
      const stride = Math.min(0.32, speed * 0.085) * (1 - c * 0.6);
      const swing = phase >= Math.PI, u = swing ? (phase - Math.PI) / Math.PI : phase / Math.PI;
      const z = (swing ? 1 - 2 * smoothStride(u) : 2 * u - 1) * stride - c * 0.055;
      const lift = swing ? Math.sin(u * Math.PI) * (0.09 + this.sp * 0.065) * sw : 0;
      l.hip.position.y = 0.89 - drop + bob;
      const down = l.hip.position.y - (0.067 + lift), distance = Math.min(0.829, Math.max(0.035, Math.hypot(down, z)));
      const thighAngle = Math.acos(Math.max(-1, Math.min(1, (0.43 * 0.43 + distance * distance - 0.40 * 0.40) / (2 * 0.43 * distance))));
      l.hip.rotation.set(Math.atan2(-z, down) + thighAngle, i ? -c * 0.08 : c * 0.08, 0);
      l.knee.rotation.x = -Math.acos(Math.max(-1, Math.min(1, (distance * distance - 0.43 * 0.43 - 0.40 * 0.40) / (2 * 0.43 * 0.40))));
      l.ankle.rotation.x = -l.hip.rotation.x - l.knee.rotation.x;
    }
    // arms to the weapon grips (spine space)
    this.spine.updateMatrixWorld(true);
    const gm = this.gun.matrixWorld;
    this.sInv.copy(this.spine.matrixWorld).invert();
    const d = this.gun.userData;
    for (let i = 0; i < 2; i++) {
      const a = this.arms[i], grip = i === 0 ? d.gripR : d.gripL, sx = i === 0 ? 0.205 : -0.205;
      const hand = this.v1;
      if (monster) {
        const weight = Math.sin(this.phase + i * Math.PI) * sw, attack = Math.min(1, Math.abs(ax) * 2.5 + Math.abs(ay));
        hand.set(sx * 1.40 + Math.sin(ay) * attack * 0.20, -0.035 + attack * 0.43 + weight * 0.035, -0.095 - attack * 0.50 + weight * 0.095);
      } else if (grip) hand.copy(grip).applyMatrix4(gm).applyMatrix4(this.sInv);
      else hand.copy(this.lRest);
      const sh = this.v2.set(sx, 0.49, 0.012), e = this.v3;
      elbowBetween(e, sh, hand, i ? -1 : 1, monster ? 0.33 : 0.31, monster ? 0.38 : 0.28);
      spanBetween(a.u, sh, e); spanBetween(a.f, e, hand);
      a.h.position.copy(hand);
      if (monster) a.h.rotation.set(-0.14 + ax * 0.5, ay * 0.3, i ? -0.12 : 0.12);
      else {
        a.h.quaternion.copy(this.gun.quaternion).premultiply(this.aim.quaternion);
        if (!i) {
          const hr = HAND_ROT[this.gunType] || HAND_ROT.default;
          a.h.quaternion.multiply(tmpQ.setFromEuler(tmpE.set(hr[0], hr[1], hr[2])));
        } else if (grip) {
          const short = this.gunType === 'pistol' || this.gunType === 'revolver';
          a.h.quaternion.multiply(tmpQ.setFromEuler(tmpE.set(short ? -0.16 : 1.24, short ? 0.08 : 0.12, short ? 0.24 : -1.42)));
        }
      }
    }
    // death: topple around the feet in the direction of the killing blow; weapon is dropped (world drop)
    if (this.marker) this.marker.visible = !!this.friendly && s.alive && !monster;
    if (!s.alive) {
      this.deadT = Math.min(1, this.deadT + dt * 2.3 * (this.dieFast || 1));
      const k = this.deadT, e = k * k * (3 - 2 * k);
      const dir = this.dieDir ?? 0;
      this.axis.set(Math.cos(dir), 0, -Math.sin(dir));
      this.body.quaternion.setFromAxisAngle(this.axis, e * 1.5);
      this.q.setFromAxisAngle(UP, (this.dieTwist || 0) * e);
      this.body.quaternion.premultiply(this.q);
      this.body.position.y = e * 0.1;
      for (let i = 0; i < 2; i++) this.legs[i].knee.rotation.x -= e * (0.6 + i * 0.3);
      this.gun.visible = false;
    } else {
      this.deadT = 0; this.body.quaternion.identity(); this.body.position.y = 0; this.gun.visible = !monster;
    }
  }
}

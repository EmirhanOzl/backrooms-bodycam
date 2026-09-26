// M.E.G. supply chest: a rugged olive hard case (the explorers' supply drops of Level 0) with a foam insert,
// latches, carry handle, molded ribs and a status light. Built once as vertex-colored geometry for instancing.
import * as THREE from 'three';
import { CRATE_W as W, CRATE_D as D } from './shared/map.js';

export const CHEST_HINGE_Y = 0.3;          // lid pivots on the back edge at this height
export const CHEST_HINGE_Z = -((D - 0.012) / 2 + 0.002);
const C = {
  olive: 0x4b5236, oliveDk: 0x383d2a, rim: 0x2a2d25, foam: 0x2e2e30, pocket: 0x111112,
  rubber: 0x1b1b1b, steel: 0x8e9194, yellow: 0xc9a43a, plate: 0x232323,
};

// rounded rectangle (x, z footprint) extruded upward from y0 to y1; caps and sides get their own colors
function slab(parts, w, d, r, y0, y1, side, cap, hole = null, bevel = 0) {
  const s = new THREE.Shape(), hw = w / 2, hd = d / 2;
  s.moveTo(-hw + r, -hd); s.lineTo(hw - r, -hd); s.quadraticCurveTo(hw, -hd, hw, -hd + r);
  s.lineTo(hw, hd - r); s.quadraticCurveTo(hw, hd, hw - r, hd); s.lineTo(-hw + r, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - r); s.lineTo(-hw, -hd + r); s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  if (hole) {
    const [iw, id, ir] = hole, h = new THREE.Path(), a = iw / 2, b = id / 2;
    h.moveTo(-a + ir, -b); h.lineTo(a - ir, -b); h.quadraticCurveTo(a, -b, a, -b + ir); h.lineTo(a, b - ir); h.quadraticCurveTo(a, b, a - ir, b);
    h.lineTo(-a + ir, b); h.quadraticCurveTo(-a, b, -a, b - ir); h.lineTo(-a, -b + ir); h.quadraticCurveTo(-a, -b, -a + ir, -b);
    s.holes.push(h);
  }
  const depth = Math.max(0.001, y1 - y0 - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 5 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0 + bevel, 0);
  parts.push([g, [cap, side]]);
}
function boxP(parts, w, h, d, x, y, z, color, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  parts.push([g, color]);
}
function cylP(parts, r, len, x, y, z, color, axis = 'x', seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  parts.push([g, color]);
}

// parts: [geometry, color | [color per group]] -> one non-indexed BufferGeometry with a color attribute
function merge(parts) {
  const pos = [], nor = [], col = [], c = new THREE.Color();
  for (const [g0, color] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const P = g.attributes.position, N = g.attributes.normal;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: P.count, materialIndex: 0 }];
    for (const gr of groups) {
      c.set(Array.isArray(color) ? color[gr.materialIndex] ?? color[0] : color);
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// body: origin at the bottom center; lid: origin on the hinge line, extending toward +z (front)
export function chestGeometries() {
  const body = [], lid = [];
  const w = W - 0.012, d = D - 0.012, r = 0.035, top = CHEST_HINGE_Y;
  // feet
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) boxP(body, 0.06, 0.014, 0.05, sx * (w / 2 - 0.05), 0.007, sz * (d / 2 - 0.045), C.rubber);
  // shell (its top cap is the foam insert) + molded ribs + rim
  slab(body, w, d, r, 0.012, top - 0.012, C.olive, C.foam, null, 0.004);
  for (const y of [0.06, 0.2]) slab(body, w + 0.01, d + 0.01, r + 0.004, y, y + 0.016, C.oliveDk, C.oliveDk, [w - 0.004, d - 0.004, r]);
  slab(body, w + 0.004, d + 0.004, r + 0.002, top - 0.016, top, C.rim, C.rim, [w - 0.05, d - 0.05, r * 0.6]);
  // cut-out pockets in the foam
  boxP(body, 0.24, 0.002, 0.1, -0.09, top - 0.0155, -0.03, C.pocket);
  boxP(body, 0.14, 0.002, 0.2, 0.15, top - 0.0155, 0.0, C.pocket);
  // front: latches, carry handle, status plate
  const fz = d / 2 + 0.004;
  for (const sx of [-1, 1]) {
    boxP(body, 0.055, 0.05, 0.016, sx * 0.17, top - 0.03, fz + 0.004, C.rubber);
    boxP(body, 0.03, 0.012, 0.01, sx * 0.17, top - 0.012, fz + 0.012, C.steel);
    boxP(body, 0.012, 0.03, 0.004, sx * 0.17, top - 0.04, fz + 0.013, C.oliveDk);
  }
  for (const sx of [-1, 1]) boxP(body, 0.014, 0.03, 0.02, sx * 0.065, top - 0.09, fz + 0.008, C.rubber);
  boxP(body, 0.15, 0.02, 0.022, 0, top - 0.11, fz + 0.02, C.rubber);
  boxP(body, 0.05, 0.03, 0.006, 0, top - 0.03, fz + 0.002, C.plate);
  // side carry grips
  for (const sx of [-1, 1]) {
    boxP(body, 0.018, 0.02, 0.12, sx * (w / 2 + 0.014), top - 0.07, 0, C.rubber);
    for (const sz of [-1, 1]) boxP(body, 0.016, 0.03, 0.014, sx * (w / 2 + 0.006), top - 0.07, sz * 0.055, C.rubber);
  }
  // back hinges
  for (const sx of [-0.18, 0, 0.18]) cylP(body, 0.008, 0.07, sx, top - 0.006, -d / 2 - 0.003, C.steel);

  // lid (hinge space): shell with a raised panel, foam slab underneath, latch keepers at the front
  const lz = d / 2 + 0.002; // lid center along z from the hinge
  const L = (parts, fn) => { const n = parts.length; fn(); for (let i = n; i < parts.length; i++) parts[i][0].translate(0, 0, lz); };
  L(lid, () => {
    slab(lid, w + 0.004, d + 0.004, r + 0.002, 0, 0.082, C.olive, C.olive, null, 0.005);
    slab(lid, w - 0.08, d - 0.08, r * 0.7, 0.078, 0.092, C.oliveDk, C.olive, null, 0.003);
    slab(lid, w - 0.13, d - 0.13, r * 0.5, 0.088, 0.096, C.olive, C.oliveDk, null, 0.002);
    boxP(lid, w - 0.06, 0.009, d - 0.06, 0, -0.004, 0, C.foam);
    for (const sx of [-1, 1]) boxP(lid, 0.05, 0.024, 0.014, sx * 0.17, 0.028, d / 2 + 0.006, C.rubber);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) boxP(lid, 0.04, 0.006, 0.04, sx * (w / 2 - 0.05), 0.098, sz * (d / 2 - 0.05), C.rubber); // stacking lugs
  });
  return { body: merge(body), lid: merge(lid), ledPos: new THREE.Vector3(0.012, CHEST_HINGE_Y - 0.03, d / 2 + 0.01) };
}

// stenciled marking for the lid (and the front): "M.E.G. İKMAL" with a hazard strip, on transparent canvas
export function chestLabelTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 160);
  x.fillStyle = 'rgba(214, 178, 70, 0.92)';
  x.font = 'bold 54px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('M.E.G.', 128, 52);
  x.font = 'bold 22px monospace';
  x.fillText('İKMAL · SEVİYE 0', 128, 98);
  // chevron strip
  x.save(); x.beginPath(); x.rect(28, 122, 200, 18); x.clip();
  for (let i = -2; i < 14; i++) { x.fillStyle = i % 2 ? 'rgba(20,20,20,0.9)' : 'rgba(214,178,70,0.92)'; x.beginPath(); x.moveTo(28 + i * 16, 140); x.lineTo(28 + i * 16 + 16, 122); x.lineTo(28 + i * 16 + 32, 122); x.lineTo(28 + i * 16 + 16, 140); x.fill(); }
  x.restore();
  // weathering: scratch out bits of paint
  x.globalCompositeOperation = 'destination-out';
  let s = 7;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 160; i++) { x.fillRect(R() * 256, R() * 160, 1 + R() * 5, 1 + R() * 2); }
  x.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Pooled visual effects: particles, decals (bullet holes / blood / scorch), tracers, muzzle sprites,
// ejected casings and floating dust motes.
import * as THREE from 'three';
import * as TX from './textures.js';
import { bakeMaterial } from './world.js';

const DUST_COLORS = { floor: [0.44, 0.35, 0.20], ceil: [0.74, 0.70, 0.59], crate: [0.52, 0.35, 0.19], wall: [0.66, 0.56, 0.36], metal: [0.47, 0.48, 0.47] };
const FOOTPRINT = [0, 0, -1, -1, 1, -1, -1, 1, 1, 1, -1, 0, 1, 0, 0, -1, 0, 1];

export class Particles {
  constructor(scene, max = 500, additive = false) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.grow = new Float32Array(max); this.a0 = new Float32Array(max); this.drag = new Float32Array(max);
    this.n = 0; this.next = 0;
    this.normal = new THREE.Vector3(); this.tangent = new THREE.Vector3(); this.bitangent = new THREE.Vector3();
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sa = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('pcolor', this.ca); g.setAttribute('size', this.sa);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = { uScale: { value: 500 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float size; attribute vec4 pcolor; uniform float uScale; varying vec4 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * uScale / max(0.05, -mv.z), 1.0, 180.0); vC = pcolor; }`,
      fragmentShader: `varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = 1.0 - smoothstep(0.06, 1.0, d); a *= a; if (a * vC.a < 0.005) discard; gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, size, r, g, b, a, life, grav = 0, grow = 0, drag = 1.5) {
    const i = this.n < this.max ? this.n++ : this.next++ % this.max;
    const k = i * 3, c = i * 4;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b; this.col[c + 3] = a; this.a0[i] = a;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.grow[i] = grow; this.drag[i] = drag;
  }
  update(dt) {
    if (!this.n) return;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          this.pos.copyWithin(i * 3, j * 3, j * 3 + 3); this.vel.copyWithin(i * 3, j * 3, j * 3 + 3); this.col.copyWithin(i * 4, j * 4, j * 4 + 4);
          this.size[i] = this.size[j]; this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.grav[i] = this.grav[j]; this.grow[i] = this.grow[j]; this.a0[i] = this.a0[j]; this.drag[i] = this.drag[j];
        }
        i--; continue;
      }
      const k = i * 3, dr = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt; this.vel[k + 2] *= dr;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.01) { this.pos[k + 1] = 0.01; this.vel[k + 1] *= -0.2; this.vel[k] *= 0.5; this.vel[k + 2] *= 0.5; }
      if (this.pos[k + 1] > 2.88) { this.pos[k + 1] = 2.88; this.vel[k + 1] *= -0.1; }
      this.size[i] += this.grow[i] * dt;
      const fade = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = this.a0[i] * fade * Math.min(1, fade * 2);
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.pa.needsUpdate = this.ca.needsUpdate = this.sa.needsUpdate = true;
  }
  clear() { this.n = 0; this.next = 0; this.points.geometry.setDrawRange(0, 0); }
  surfaceBasis(n) {
    this.normal.copy(n).normalize();
    if (Math.abs(this.normal.y) > 0.95) this.tangent.set(1, 0, 0);
    else this.tangent.set(this.normal.z, 0, -this.normal.x).normalize();
    this.bitangent.crossVectors(this.normal, this.tangent).normalize();
  }
  // presets --------------------------------------------------------
  dust(p, n, light, kind = 'wall') {
    const col = DUST_COLORS[kind] || DUST_COLORS.wall, L = Math.max(0.07, light);
    this.surfaceBasis(n);
    const a = this.normal, t = this.tangent, b = this.bitangent;
    for (let i = 0; i < 7; i++) {
      const speed = 0.30 + Math.random() * 0.85, u = (Math.random() - 0.5) * 0.72, v = (Math.random() - 0.5) * 0.72;
      this.spawn(p.x + a.x * 0.017, p.y + a.y * 0.017, p.z + a.z * 0.017,
        a.x * speed + t.x * u + b.x * v, a.y * speed + t.y * u + b.y * v, a.z * speed + t.z * u + b.z * v,
        0.035 + Math.random() * 0.050, col[0] * L, col[1] * L, col[2] * L, 0.48, 0.45 + Math.random() * 0.60, 0.45, 0.16, 3.2);
    }
    for (let i = 0; i < (kind === 'metal' ? 3 : 6); i++) {
      const speed = 1.3 + Math.random() * 2.0, u = (Math.random() - 0.5) * 2.8, v = (Math.random() - 0.5) * 2.8;
      this.spawn(p.x + a.x * 0.008, p.y + a.y * 0.008, p.z + a.z * 0.008,
        a.x * speed + t.x * u + b.x * v, a.y * speed + t.y * u + b.y * v, a.z * speed + t.z * u + b.z * v,
        0.008 + Math.random() * 0.010, col[0] * L * 0.8, col[1] * L * 0.8, col[2] * L * 0.8, 0.95, 0.24 + Math.random() * 0.28, 9.8, 0, 0.35);
    }
  }
  sparks(p, n, count = 5) {
    this.surfaceBasis(n);
    const a = this.normal, t = this.tangent, b = this.bitangent;
    for (let i = 0; i < count; i++) {
      const speed = 2 + Math.random() * 5, u = (Math.random() - 0.5) * 5, v = (Math.random() - 0.5) * 5;
      this.spawn(p.x + a.x * 0.009, p.y + a.y * 0.009, p.z + a.z * 0.009,
        a.x * speed + t.x * u + b.x * v, a.y * speed + t.y * u + b.y * v, a.z * speed + t.z * u + b.z * v,
        0.008 + Math.random() * 0.006, 7, 3.0 + Math.random(), 0.65, 1, 0.10 + Math.random() * 0.16, 9.8, -0.018, 0.7);
    }
  }
  blood(p, d, light, head = false) {
    const L = Math.max(0.3, light), n = head ? 22 : 12;
    for (let i = 0; i < n; i++) {
      const s = 1 + Math.random() * (head ? 2.5 : 1.6);
      this.spawn(p.x, p.y, p.z, d.x * s + (Math.random() - 0.5) * 1.8, d.y * s + (Math.random() - 0.2) * 1.6, d.z * s + (Math.random() - 0.5) * 1.8,
        0.02 + Math.random() * 0.05, 0.4 * L, 0.02 * L, 0.02 * L, 0.95, 0.35 + Math.random() * 0.5, 7, 0.05, 1.5);
    }
    for (let i = 0; i < (head ? 5 : 3); i++) { // mist
      this.spawn(p.x, p.y, p.z, d.x * 0.6 + (Math.random() - 0.5) * 0.5, (Math.random() - 0.3) * 0.4, d.z * 0.6 + (Math.random() - 0.5) * 0.5,
        0.1 + Math.random() * 0.08, 0.3 * L, 0.02 * L, 0.02 * L, 0.35, 0.5 + Math.random() * 0.4, 0.3, 0.5, 3);
    }
  }
  smoke(p, d, light, n = 3, big = 1) {
    for (let i = 0; i < n; i++) this.spawn(p.x, p.y, p.z, d.x * 0.6 + (Math.random() - 0.5) * 0.2, d.y * 0.6 + 0.15, d.z * 0.6 + (Math.random() - 0.5) * 0.2,
      0.05 * big, 0.6 * light, 0.58 * light, 0.52 * light, 0.18, 0.8 + Math.random() * 0.6, -0.12, 0.5 * big, 2);
  }
  explosionSmoke(p, light) {
    const L = Math.max(0.25, light);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, s = 1 + Math.random() * 3;
      this.spawn(p.x, p.y + 0.2, p.z, Math.cos(a) * s, 0.5 + Math.random() * 1.8, Math.sin(a) * s, 0.4 + Math.random() * 0.4, 0.2 * L, 0.19 * L, 0.17 * L, 0.55, 2.5 + Math.random() * 2.5, -0.15, 0.6, 1.2);
    }
    for (let i = 0; i < 24; i++) { // debris
      const a = Math.random() * 6.28, s = 3 + Math.random() * 7;
      this.spawn(p.x, p.y + 0.1, p.z, Math.cos(a) * s, 1 + Math.random() * 5, Math.sin(a) * s, 0.02 + Math.random() * 0.02, 0.25 * L, 0.2 * L, 0.12 * L, 1, 0.8 + Math.random() * 0.6, 9.8, 0, 0.4);
    }
  }
  fireball(p) {
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * 6.28, e = Math.random() * 1.2, s = 2 + Math.random() * 5;
      this.spawn(p.x, p.y + 0.15, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s * 0.7 + 0.5, Math.sin(a) * Math.cos(e) * s,
        0.25 + Math.random() * 0.35, 5, 2.2 + Math.random(), 0.6, 1, 0.18 + Math.random() * 0.22, -0.5, 1.4, 6);
    }
    for (let i = 0; i < 30; i++) this.spawn(p.x, p.y + 0.1, p.z, (Math.random() - 0.5) * 16, Math.random() * 8, (Math.random() - 0.5) * 16, 0.015, 8, 4, 1.2, 1, 0.3 + Math.random() * 0.5, 9.8, 0, 0.6);
  }
}

export class Decals {
  constructor(scene, max = 220, map = TX.bulletHoleTexture(), color = 0x9a9a9a) {
    this.max = max; this.i = 0;
    const m = bakeMaterial({ map, transparent: true, alphaTest: 0.025, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, color }, { attr: true });
    const geo = new THREE.PlaneGeometry(1, 1);
    this.ba = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('bake', this.ba);
    this.mesh = new THREE.InstancedMesh(geo, m, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.q2 = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.Z = new THREE.Vector3(0, 0, 1); this.n = new THREE.Vector3();
    this.tx = new THREE.Vector3(); this.ty = new THREE.Vector3(); this.extent = new THREE.Vector3(); this.probe = new THREE.Vector3();
  }
  // surface: {bounds:{min,max}, support(point,normal), rotation, light}. Bounds describe the real
  // planar wall/floor rectangle; support can check a nonrectangular footprint (doors, corridor corners).
  // A rejected decal never suppresses the separate particle, sound or hitmarker feedback.
  add(p, n, size = 0.09, stretch = 1, surface = null) {
    if (!(size > 0 && stretch > 0) || n.lengthSq() < 1e-8) return false;
    this.n.copy(n).normalize(); this.p.copy(p);
    this.q.setFromUnitVectors(this.Z, this.n);
    this.q2.setFromAxisAngle(this.Z, Number.isFinite(surface?.rotation) ? surface.rotation : Math.random() * Math.PI * 2);
    this.q.multiply(this.q2);
    this.tx.set(1, 0, 0).applyQuaternion(this.q); this.ty.set(0, 1, 0).applyQuaternion(this.q);
    this.s.set(size * stretch, size, 1);
    if (surface?.bounds && !this.fitBounds(surface.bounds)) return false;
    if (surface?.support) {
      if (!surface.support(this.p, this.n)) return false;
      let supported = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        if (this.supported(surface.support)) { supported = true; break; }
        this.s.x *= 0.72; this.s.y *= 0.72;
        if (Math.min(this.s.x, this.s.y) < 0.012) break;
      }
      if (!supported) return false;
    }
    this.p.addScaledVector(this.n, 0.0012 + this.i * 0.0000005);
    this.m4.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.i, this.m4);
    this.ba.setX(this.i, Number.isFinite(surface?.light) ? Math.max(0, surface.light) : 0.65);
    this.i = (this.i + 1) % this.max; this.mesh.count = Math.min(this.max, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = this.ba.needsUpdate = true;
    return true;
  }
  footprintExtent() {
    const x = this.s.x * 0.5, y = this.s.y * 0.5, a = this.tx, b = this.ty;
    this.extent.set(Math.abs(a.x) * x + Math.abs(b.x) * y, Math.abs(a.y) * x + Math.abs(b.y) * y, Math.abs(a.z) * x + Math.abs(b.z) * y);
  }
  fitBounds(bounds) {
    this.footprintExtent();
    let fit = 1;
    for (let axis = 0; axis < 3; axis++) {
      const key = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z', extent = this.extent.getComponent(axis);
      const span = bounds.max[key] - bounds.min[key];
      if (span < 0) return false;
      if (extent > 1e-6) fit = Math.min(fit, span / (extent * 2));
    }
    this.s.x *= fit; this.s.y *= fit;
    if (Math.min(this.s.x, this.s.y) < 0.012) return false;
    this.footprintExtent();
    for (let axis = 0; axis < 3; axis++) {
      const key = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z', extent = this.extent.getComponent(axis);
      const lo = bounds.min[key] + extent, hi = bounds.max[key] - extent;
      this.p.setComponent(axis, Math.max(lo, Math.min(hi, this.p.getComponent(axis))));
    }
    return true;
  }
  supported(support) {
    for (let i = 2; i < FOOTPRINT.length; i += 2) {
      this.probe.copy(this.p).addScaledVector(this.tx, FOOTPRINT[i] * this.s.x * 0.5).addScaledVector(this.ty, FOOTPRINT[i + 1] * this.s.y * 0.5);
      if (!support(this.probe, this.n)) return false;
    }
    return true;
  }
  clear() { this.mesh.count = 0; this.i = 0; }
}

export class Tracers {
  constructor(scene, max = 48) {
    this.max = max; this.n = 0; this.next = 0;
    this.pool = Array.from({ length: max }, () => ({ o: new THREE.Vector3(), d: new THREE.Vector3(), len: 0, t: 0 }));
    this.pos = new Float32Array(max * 6); this.col = new Float32Array(max * 6);
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('color', this.ca); g.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false; scene.add(this.lines);
  }
  add(o, d, len) {
    if (len <= 0) return;
    const tr = this.pool[this.n < this.max ? this.n++ : this.next++ % this.max];
    tr.o.copy(o); tr.d.copy(d); tr.len = len; tr.t = 0.5 + Math.random() * 1.5;
  }
  update(dt) {
    if (!this.n) return;
    let count = 0;
    for (let i = 0; i < this.n; i++) {
      const tr = this.pool[i];
      tr.t += dt * 320;
      const a = Math.max(0, tr.t - 4.5), b = Math.min(tr.len, tr.t);
      if (a >= tr.len) { this.pool[i] = this.pool[--this.n]; this.pool[this.n] = tr; i--; continue; }
      if (b <= a) continue;
      const k = count++ * 6;
      this.pos[k] = tr.o.x + tr.d.x * a; this.pos[k + 1] = tr.o.y + tr.d.y * a; this.pos[k + 2] = tr.o.z + tr.d.z * a;
      this.pos[k + 3] = tr.o.x + tr.d.x * b; this.pos[k + 4] = tr.o.y + tr.d.y * b; this.pos[k + 5] = tr.o.z + tr.d.z * b;
      this.col[k] = 0.035; this.col[k + 1] = 0.018; this.col[k + 2] = 0.006;
      this.col[k + 3] = 2.8; this.col[k + 4] = 1.8; this.col[k + 5] = 0.72;
    }
    this.lines.geometry.setDrawRange(0, count * 2);
    this.pa.needsUpdate = this.ca.needsUpdate = true;
  }
  clear() { this.n = 0; this.next = 0; this.lines.geometry.setDrawRange(0, 0); }
}

export class MuzzleSprites {
  constructor(scene, n = 10) {
    const mat = new THREE.SpriteMaterial({ map: TX.muzzleTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(3, 2.6, 2) });
    this.pool = [];
    for (let i = 0; i < n; i++) { const s = new THREE.Sprite(mat.clone()); s.visible = false; scene.add(s); this.pool.push({ s, t: 0 }); }
    this.i = 0;
  }
  fire(p, size = 0.35, dur = 0.05) {
    const e = this.pool[this.i++ % this.pool.length];
    e.s.position.copy(p); e.s.scale.setScalar(size * (0.75 + Math.random() * 0.5)); e.s.material.rotation = Math.random() * 6; e.s.material.opacity = 1; e.s.visible = true; e.t = dur; e.d = dur;
  }
  update(dt) { for (const e of this.pool) if (e.s.visible) { if ((e.t -= dt) <= 0) e.s.visible = false; else e.s.material.opacity = Math.min(1, e.t / e.d * 1.6); } }
}

export class Shells {
  constructor(scene, max = 16) {
    const g = new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 8); g.rotateZ(Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0xffe0a0, shininess: 100 }), max);
    this.mesh.frustumCulled = false; this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.max = max; this.n = 0; this.next = 0;
    this.pool = Array.from({ length: max }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), t: 0, big: 1, hull: false }));
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(1, 1, 1);
    this.brass = new THREE.Color(0xb8903a); this.hull = new THREE.Color(0x8a1a14);
    this.mesh.setColorAt(0, this.brass); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh); this.mesh.count = 0;
  }
  // p in viewmodel space; kind: 'pistol' | 'rifle' | 'hull'
  eject(p, kind = 'pistol', dir = 1) {
    const s = this.pool[this.n < this.max ? this.n++ : this.next++ % this.max];
    s.p.copy(p); s.v.set((0.9 + Math.random() * 0.6) * dir, 1.1 + Math.random() * 0.6, 0.2 + Math.random() * 0.3);
    s.r.set(0, 0, 0); s.w.set(Math.random() * 20, Math.random() * 20, 10);
    s.t = 0.75; s.big = kind === 'rifle' ? 1.5 : kind === 'hull' ? 2.4 : 1; s.hull = kind === 'hull';
  }
  update(dt) {
    if (!this.n) return;
    for (let i = 0; i < this.n; i++) {
      const shell = this.pool[i];
      if ((shell.t -= dt) <= 0) { this.pool[i] = this.pool[--this.n]; this.pool[this.n] = shell; i--; continue; }
      shell.v.y -= 7 * dt; shell.p.addScaledVector(shell.v, dt); shell.r.addScaledVector(shell.w, dt);
      this.e.set(shell.r.x, shell.r.y, shell.r.z); this.q.setFromEuler(this.e);
      this.s.set(shell.big, shell.hull ? 1.9 : 1, shell.hull ? 1.9 : 1);
      this.m4.compose(shell.p, this.q, this.s); this.mesh.setMatrixAt(i, this.m4);
      this.mesh.setColorAt(i, shell.hull ? this.hull : this.brass);
    }
    this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.n = 0; this.next = 0; this.mesh.count = 0; }
}

// Dust motes drifting in the damp air around the camera; brightness follows the local light.
export class Motes {
  constructor(scene, n = 420, R = 7) {
    this.n = n; this.R = R;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() * 2 - 1) * R;
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = Math.random() * 2.9;
    this.base = pos.slice();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = { uCam: { value: new THREE.Vector3() }, uT: { value: 0 }, uL: { value: 1 }, uFlash: { value: 0 }, uFwd: { value: new THREE.Vector3() }, uScale: { value: 500 }, uR: { value: R } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform vec3 uCam, uFwd; uniform float uT, uL, uFlash, uScale, uR; varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uT * 0.13 + position.y * 3.1) * 0.25 + uT * 0.021;
          p.z += cos(uT * 0.11 + position.x * 2.7) * 0.25 + uT * 0.013;
          p.y += sin(uT * 0.07 + position.z * 1.9) * 0.15;
          vec3 rel = mod(p - uCam + uR, 2.0 * uR) - uR;
          vec3 w = uCam + rel; w.y = clamp(p.y, 0.05, 2.85);
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(rel);
          vec3 dir = rel / max(d, 1e-3);
          float beam = uFlash * smoothstep(0.86, 0.97, dot(dir, uFwd)) * smoothstep(9.0, 1.0, d);
          vA = (0.05 * uL + beam * 0.7) * smoothstep(uR, uR * 0.6, d) * smoothstep(0.15, 0.6, d);
          gl_PointSize = 0.012 * uScale / max(0.1, -mv.z);
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - d) * vA; if (a < 0.004) discard; gl_FragColor = vec4(vec3(1.0, 0.95, 0.8) * a, 1.0); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }
  update(time, cam, fwd, light, flash) {
    const u = this.uniforms;
    u.uT.value = time; u.uCam.value.copy(cam); u.uFwd.value.copy(fwd); u.uL.value = light; u.uFlash.value = flash ? 1 : 0;
  }
}

// Laser sights: a faint beam (brighter near the emitter, visible in the dusty air) and a dot where it lands.
// Filled every frame with begin() / add() / end().
export class Lasers {
  constructor(scene, max = 8) {
    this.max = max;
    this.pos = new Float32Array(max * 6); this.col = new Float32Array(max * 6);
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('color', this.ca);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.lines.frustumCulled = false;
    const dotMat = new THREE.SpriteMaterial({ map: TX.softDotTexture(), color: new THREE.Color(6, 0.35, 0.25), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.dots = [];
    for (let i = 0; i < max; i++) { const s = new THREE.Sprite(dotMat); s.visible = false; scene.add(s); this.dots.push(s); }
    scene.add(this.lines);
    this.n = 0;
  }
  begin() { this.n = 0; }
  // from: emitter, to: where it lands (null = into the distance), eye: camera position (dot size)
  add(from, to, eye, beam = 0.35) {
    if (this.n >= this.max) return;
    const k = this.n * 6, i = this.n++;
    this.pos[k] = from.x; this.pos[k + 1] = from.y; this.pos[k + 2] = from.z;
    this.pos[k + 3] = to.x; this.pos[k + 4] = to.y; this.pos[k + 5] = to.z;
    this.col[k] = 1.6 * beam; this.col[k + 1] = 0.08 * beam; this.col[k + 2] = 0.05 * beam;
    this.col[k + 3] = 0.12 * beam; this.col[k + 4] = 0.01 * beam; this.col[k + 5] = 0;
    const s = this.dots[i];
    s.visible = true;
    s.position.copy(to);
    const d = Math.max(0.3, to.distanceTo(eye));
    s.scale.setScalar(0.045 + d * 0.007);
  }
  end() {
    for (let i = this.n; i < this.max; i++) this.dots[i].visible = false;
    this.lines.geometry.setDrawRange(0, this.n * 2);
    this.pa.needsUpdate = this.ca.needsUpdate = true;
  }
}

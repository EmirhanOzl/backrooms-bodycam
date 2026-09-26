// Pooled visual effects: particles, decals (bullet holes / blood / scorch), tracers, muzzle sprites,
// ejected casings and floating dust motes.
import * as THREE from 'three';
import * as TX from './textures.js';

export class Particles {
  constructor(scene, max = 500, additive = false) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.grow = new Float32Array(max); this.a0 = new Float32Array(max); this.drag = new Float32Array(max);
    this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sa = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('pcolor', this.ca); g.setAttribute('size', this.sa);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = { uScale: { value: 500 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float size; attribute vec4 pcolor; uniform float uScale; varying vec4 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uScale / max(0.05, -mv.z); vC = pcolor; }`,
      fragmentShader: `varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, size, r, g, b, a, life, grav = 0, grow = 0, drag = 1.5) {
    const i = this.n < this.max ? this.n++ : (Math.random() * this.max) | 0;
    const k = i * 3, c = i * 4;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b; this.col[c + 3] = a; this.a0[i] = a;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.grow[i] = grow; this.drag[i] = drag;
  }
  update(dt) {
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
      this.col[i * 4 + 3] = this.a0[i] * (this.life[i] / this.maxLife[i]);
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.pa.needsUpdate = this.ca.needsUpdate = this.sa.needsUpdate = true;
  }
  clear() { this.n = 0; }
  // presets --------------------------------------------------------
  dust(p, n, light, kind = 'wall') {
    const col = kind === 'floor' ? [0.42, 0.34, 0.18] : kind === 'ceil' ? [0.72, 0.68, 0.56] : kind === 'crate' ? [0.5, 0.34, 0.18] : [0.6, 0.52, 0.3];
    const L = light;
    for (let i = 0; i < 8; i++) {
      const s = 0.6 + Math.random() * 1.4;
      this.spawn(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02,
        n.x * s + (Math.random() - 0.5) * 0.8, n.y * s + (Math.random() - 0.3) * 0.8, n.z * s + (Math.random() - 0.5) * 0.8,
        0.05 + Math.random() * 0.07, col[0] * L, col[1] * L, col[2] * L, 0.55, 0.5 + Math.random() * 0.7, 0.6, 0.28, 3);
    }
    for (let i = 0; i < 6; i++) { // chips
      this.spawn(p.x, p.y, p.z, n.x * 3 + (Math.random() - 0.5) * 3, n.y * 3 + Math.random() * 2, n.z * 3 + (Math.random() - 0.5) * 3,
        0.012 + Math.random() * 0.01, col[0] * L * 0.7, col[1] * L * 0.7, col[2] * L * 0.7, 1, 0.5, 9.8, 0, 0.2);
    }
  }
  sparks(p, n, count = 5) {
    for (let i = 0; i < count; i++) this.spawn(p.x, p.y, p.z, n.x * 4 + (Math.random() - 0.5) * 5, n.y * 4 + Math.random() * 3, n.z * 4 + (Math.random() - 0.5) * 5, 0.012, 6, 3.5, 1.2, 1, 0.12 + Math.random() * 0.12, 9.8, 0, 0.5);
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
    const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.q2 = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.Z = new THREE.Vector3(0, 0, 1);
  }
  add(p, n, size = 0.09, stretch = 1) {
    this.q.setFromUnitVectors(this.Z, n);
    this.q2.setFromAxisAngle(this.Z, Math.random() * 6.28);
    this.q.multiply(this.q2);
    this.p.copy(p).addScaledVector(n, 0.004 + this.i * 0.000002);
    this.s.set(size * stretch, size, 1);
    this.m4.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.i, this.m4);
    this.i = (this.i + 1) % this.max;
    this.mesh.count = Math.min(this.max, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.mesh.count = 0; this.i = 0; }
}

export class Tracers {
  constructor(scene, max = 48) {
    this.max = max;
    this.list = [];
    this.pos = new Float32Array(max * 6); this.col = new Float32Array(max * 6);
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('color', this.ca);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }
  add(o, d, len) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ o: o.clone(), d: d.clone(), len, t: 0.5 + Math.random() * 1.5 });
  }
  update(dt) {
    let n = 0;
    this.list = this.list.filter((tr) => tr.t < tr.len);
    for (const tr of this.list) {
      tr.t += dt * 320;
      const a = Math.max(0, tr.t - 5), b = Math.min(tr.len, tr.t);
      if (b <= a) continue;
      const k = n * 6;
      this.pos[k] = tr.o.x + tr.d.x * a; this.pos[k + 1] = tr.o.y + tr.d.y * a; this.pos[k + 2] = tr.o.z + tr.d.z * a;
      this.pos[k + 3] = tr.o.x + tr.d.x * b; this.pos[k + 4] = tr.o.y + tr.d.y * b; this.pos[k + 5] = tr.o.z + tr.d.z * b;
      this.col[k] = this.col[k + 1] = this.col[k + 2] = 0;
      this.col[k + 3] = 2.4; this.col[k + 4] = 1.9; this.col[k + 5] = 1.1;
      n++;
    }
    this.lines.geometry.setDrawRange(0, n * 2);
    this.pa.needsUpdate = this.ca.needsUpdate = true;
  }
  clear() { this.list.length = 0; }
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
    e.s.position.copy(p); e.s.scale.setScalar(size * (0.75 + Math.random() * 0.5)); e.s.material.rotation = Math.random() * 6; e.s.visible = true; e.t = dur; e.d = dur;
  }
  update(dt) { for (const e of this.pool) if (e.s.visible) { if ((e.t -= dt) <= 0) e.s.visible = false; else e.s.material.opacity = Math.min(1, e.t / e.d * 1.6); } }
}

export class Shells {
  constructor(scene, max = 16) {
    const g = new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 8); g.rotateZ(Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0xffe0a0, shininess: 90 }), max);
    this.mesh.frustumCulled = false;
    this.items = []; this.max = max;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(1, 1, 1);
    this.brass = new THREE.Color(0xb8903a); this.hull = new THREE.Color(0x8a1a14);
    scene.add(this.mesh);
    this.mesh.count = 0;
  }
  // p in viewmodel space; kind: 'pistol' | 'rifle' | 'hull'
  eject(p, kind = 'pistol', dir = 1) {
    if (this.items.length >= this.max) this.items.shift();
    const big = kind === 'rifle' ? 1.5 : kind === 'hull' ? 2.4 : 1;
    this.items.push({
      p: p.clone(), v: new THREE.Vector3((0.9 + Math.random() * 0.6) * dir, 1.1 + Math.random() * 0.6, 0.2 + Math.random() * 0.3),
      r: new THREE.Vector3(), w: new THREE.Vector3(Math.random() * 20, Math.random() * 20, 10), t: 0.7, big, hull: kind === 'hull',
    });
  }
  update(dt) {
    this.items = this.items.filter((s) => (s.t -= dt) > 0);
    this.items.forEach((s, i) => {
      s.v.y -= 7 * dt;
      s.p.addScaledVector(s.v, dt);
      s.r.addScaledVector(s.w, dt);
      this.e.set(s.r.x, s.r.y, s.r.z);
      this.q.setFromEuler(this.e);
      this.s.set(s.big, s.hull ? 1.9 : 1, s.hull ? 1.9 : 1);
      this.m4.compose(s.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
      this.mesh.setColorAt(i, s.hull ? this.hull : this.brass);
    });
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
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

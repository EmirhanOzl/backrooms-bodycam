// Pooled visual effects: particles, bullet-hole decals, tracers, muzzle sprites, ejected shells.
import * as THREE from 'three';
import * as TX from './textures.js';

export class Particles {
  constructor(scene, max = 500) {
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
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `attribute float size; attribute vec4 pcolor; uniform float uScale; varying vec4 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uScale / max(0.05, -mv.z); vC = pcolor; }`,
      fragmentShader: `varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, size, r, g, b, a, life, grav = 0, grow = 0, drag = 1.5) {
    let i = this.n < this.max ? this.n++ : (Math.random() * this.max) | 0;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this.col.set([r, g, b, a], i * 4); this.a0[i] = a;
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
      if (this.pos[k + 1] < 0.01) { this.pos[k + 1] = 0.01; this.vel[k + 1] *= -0.2; }
      this.size[i] += this.grow[i] * dt;
      this.col[i * 4 + 3] = this.a0[i] * (this.life[i] / this.maxLife[i]);
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.pa.needsUpdate = this.ca.needsUpdate = this.sa.needsUpdate = true;
  }
  // presets
  dust(p, n, light) {
    for (let i = 0; i < 7; i++) {
      const s = 0.6 + Math.random() * 1.4;
      this.spawn(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02,
        n.x * s + (Math.random() - 0.5) * 0.8, n.y * s + (Math.random() - 0.3) * 0.8, n.z * s + (Math.random() - 0.5) * 0.8,
        0.05 + Math.random() * 0.06, 0.55 * light, 0.48 * light, 0.3 * light, 0.55, 0.5 + Math.random() * 0.6, 0.6, 0.25, 3);
    }
    for (let i = 0; i < 4; i++) {
      this.spawn(p.x, p.y, p.z, n.x * 3 + (Math.random() - 0.5) * 3, n.y * 3 + Math.random() * 2, n.z * 3 + (Math.random() - 0.5) * 3,
        0.012, 0.35 * light, 0.3 * light, 0.2 * light, 1, 0.4, 9.8, 0, 0.2);
    }
  }
  sparks(p, n) {
    for (let i = 0; i < 5; i++) this.spawn(p.x, p.y, p.z, n.x * 4 + (Math.random() - 0.5) * 5, n.y * 4 + Math.random() * 3, n.z * 4 + (Math.random() - 0.5) * 5, 0.012, 6, 3.5, 1.2, 1, 0.12 + Math.random() * 0.1, 9.8, 0, 0.5);
  }
  blood(p, d, light) {
    const L = Math.max(0.25, light);
    for (let i = 0; i < 10; i++) {
      this.spawn(p.x, p.y, p.z, d.x * 1.5 + (Math.random() - 0.5) * 1.6, d.y * 1.5 + (Math.random() - 0.2) * 1.4, d.z * 1.5 + (Math.random() - 0.5) * 1.6,
        0.03 + Math.random() * 0.06, 0.35 * L, 0.02 * L, 0.02 * L, 0.9, 0.35 + Math.random() * 0.4, 5, 0.12, 2);
    }
  }
  smoke(p, d, light) {
    for (let i = 0; i < 3; i++) this.spawn(p.x, p.y, p.z, d.x * 0.6 + (Math.random() - 0.5) * 0.2, d.y * 0.6 + 0.15, d.z * 0.6 + (Math.random() - 0.5) * 0.2,
      0.05, 0.6 * light, 0.58 * light, 0.52 * light, 0.18, 0.8 + Math.random() * 0.5, -0.12, 0.5, 2);
  }
}

export class Decals {
  constructor(scene, max = 220) {
    this.max = max; this.i = 0;
    const m = new THREE.MeshBasicMaterial({ map: TX.bulletHoleTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: 0x9a9a9a });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.q2 = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3();
  }
  add(p, n, size = 0.09) {
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28);
    this.q.multiply(this.q2);
    this.p.copy(p).addScaledVector(n, 0.004);
    this.s.set(size, size, 1);
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
      this.col.set([0.0, 0.0, 0.0, 2.4, 1.9, 1.1], k);
      n++;
    }
    this.lines.geometry.setDrawRange(0, n * 2);
    this.pa.needsUpdate = this.ca.needsUpdate = true;
  }
}

export class MuzzleSprites {
  constructor(scene, n = 10) {
    const mat = new THREE.SpriteMaterial({ map: TX.muzzleTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(3, 2.6, 2) });
    this.pool = [];
    for (let i = 0; i < n; i++) { const s = new THREE.Sprite(mat); s.visible = false; scene.add(s); this.pool.push({ s, t: 0 }); }
    this.i = 0;
  }
  fire(p, size = 0.35) {
    const e = this.pool[this.i++ % this.pool.length];
    e.s.position.copy(p); e.s.scale.setScalar(size * (0.8 + Math.random() * 0.4)); e.s.material.rotation = Math.random() * 6; e.s.visible = true; e.t = 0.05;
  }
  update(dt) { for (const e of this.pool) if (e.s.visible && (e.t -= dt) <= 0) e.s.visible = false; }
}

export class Shells {
  constructor(scene, max = 14) {
    const g = new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 8); g.rotateZ(Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshPhongMaterial({ color: 0xb8903a, specular: 0xffe0a0, shininess: 90 }), max);
    this.mesh.frustumCulled = false;
    this.items = []; this.max = max;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(1, 1, 1);
    scene.add(this.mesh);
    this.mesh.count = 0;
  }
  eject(p, big) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ p: p.clone(), v: new THREE.Vector3(0.9 + Math.random() * 0.6, 1.1 + Math.random() * 0.6, 0.2 + Math.random() * 0.3), r: new THREE.Vector3(), w: new THREE.Vector3(Math.random() * 20, Math.random() * 20, 10), t: 0.7, big });
  }
  update(dt) {
    this.items = this.items.filter((s) => (s.t -= dt) > 0);
    this.items.forEach((s, i) => {
      s.v.y -= 7 * dt;
      s.p.addScaledVector(s.v, dt);
      s.r.addScaledVector(s.w, dt);
      this.e.set(s.r.x, s.r.y, s.r.z);
      this.q.setFromEuler(this.e);
      this.s.setScalar(s.big ? 1.6 : 1);
      this.m4.compose(s.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
    });
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

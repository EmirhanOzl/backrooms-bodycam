// Bodycam lens pipeline: HDR scene → bloom → barrel distortion, chromatic aberration,
// rotational motion blur, ACES, grade, grain, vignette.
import * as THREE from 'three';

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class BodycamPost {
  constructor(renderer, msaa = 0) {
    this.r = renderer;
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true, samples: msaa });
    const o = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, o);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, o);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);

    this.bright = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThr: { value: 1.25 } },
      vertexShader: VS,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThr; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0,-1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0,-1.0)).rgb
                 + texture2D(tSrc, vUv + uTexel * vec2(-1.0,1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0,1.0)).rgb;
          c *= 0.25;
          float l = max(c.r, max(c.g, c.b));
          float k = smoothstep(uThr, uThr + 1.2, l);
          gl_FragColor = vec4(min(c * k, vec3(12.0)), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: VS,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main(){
          vec3 s = texture2D(tSrc, vUv).rgb * 0.2270;
          s += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.3162;
          s += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.0703;
          gl_FragColor = vec4(s, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.final = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
        uK: { value: 0.32 }, uZoom: { value: 0.8 }, uCA: { value: 0.07 }, uGrain: { value: 0.07 }, uExposure: { value: 1.0 },
        uBloom: { value: 0.9 }, uBlur: { value: new THREE.Vector2() }, uHurt: { value: 0 }, uLow: { value: 0 }, uDead: { value: 0 }, uFlash: { value: 0 },
        uLens: { value: 1 }, uScope: { value: 0 }, uSway: { value: new THREE.Vector2() },
      },
      vertexShader: VS,
      fragmentShader: `
        uniform sampler2D tScene, tBloom; uniform vec2 uRes, uBlur, uSway; uniform float uTime, uK, uZoom, uCA, uGrain, uExposure, uBloom, uHurt, uLow, uDead, uFlash, uLens, uScope;
        varying vec2 vUv;
        vec2 distort(vec2 uv, float k){
          vec2 c = uv - 0.5; float asp = uRes.x / uRes.y; c.x *= asp;
          float r2 = dot(c, c);
          c *= (1.0 + k * r2 + k * k * 0.45 * r2 * r2) * uZoom;
          c.x /= asp; return c + 0.5;
        }
        float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
        vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        void main(){
          float k = uK * uLens * (1.0 - uScope);
          vec2 uvG = mix(distort(vUv, k), vUv, uScope);
          vec2 cc = vUv - 0.5;
          float r2 = dot(cc * vec2(uRes.x / uRes.y, 1.0), cc * vec2(uRes.x / uRes.y, 1.0));
          float ca = uCA * mix(uLens, 3.0, uScope);
          vec2 uvR = 0.5 + (uvG - 0.5) * (1.0 + ca * r2 * 0.12);
          vec2 uvB = 0.5 + (uvG - 0.5) * (1.0 - ca * r2 * 0.12);
          vec3 col;
          if (dot(uBlur, uBlur) > 1e-7) {
            col = vec3(0.0);
            for (int i = 0; i < 6; i++) {
              vec2 o = uBlur * (float(i) / 5.0 - 0.5);
              col += vec3(texture2D(tScene, uvR + o).r, texture2D(tScene, uvG + o).g, texture2D(tScene, uvB + o).b);
            }
            col /= 6.0;
          } else {
            col = vec3(texture2D(tScene, uvR).r, texture2D(tScene, uvG).g, texture2D(tScene, uvB).b);
          }
          col += texture2D(tBloom, uvG).rgb * uBloom;
          col *= uExposure * (1.0 + uFlash);
          col = aces(col);
          // bodycam grade: slight desaturation, lifted blacks, cool-green shadows, warm highlights
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, 0.86 - uLow * 0.45 - uDead * 0.7);
          col = mix(col * vec3(0.92, 1.0, 0.97) + vec3(0.012, 0.016, 0.014), col, smoothstep(0.0, 0.6, l));
          col = pow(col, vec3(1.0 / 2.2));
          // sensor grain (stronger in shadows)
          float n = hash(vUv * uRes + fract(uTime * 13.37) * 100.0) - 0.5;
          col += n * uGrain * mix(0.35, 1.0, uLens) * (1.2 - l);
          // lens edge falloff + vignette
          float edge = smoothstep(0.0, 0.012, uvG.x) * smoothstep(1.0, 0.988, uvG.x) * smoothstep(0.0, 0.012, uvG.y) * smoothstep(1.0, 0.988, uvG.y);
          float v = smoothstep(1.15, 0.35, length(cc * vec2(uRes.x / uRes.y * 0.8, 1.0)));
          col *= mix(1.0, edge, uLens) * mix(mix(0.8, 0.55, uLens), 1.0, v);
          // rifle scope: circular eyepiece with duplex reticle; the ring drifts with breathing sway
          if (uScope > 0.001) {
            vec2 sc = (vUv - 0.5 - uSway) * vec2(uRes.x / uRes.y, 1.0);
            float rr = length(sc), R = 0.46;
            float inside = smoothstep(R, R - 0.012, rr);
            vec2 rc = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
            float thin = step(abs(rc.x), 0.0011) + step(abs(rc.y), 0.0011);
            float thick = (step(abs(rc.x), 0.0045) * step(0.13, abs(rc.y))) + (step(abs(rc.y), 0.0045) * step(0.13, abs(rc.x)));
            float ret = clamp(thin + thick, 0.0, 1.0);
            vec3 sCol = col * (1.0 - ret * 0.92) * mix(0.55, 1.0, smoothstep(R, R * 0.55, rr));
            sCol += vec3(0.8, 0.05, 0.03) * smoothstep(0.004, 0.0015, length(rc)) * 0.8;
            col = mix(col, sCol * inside, uScope);
          }
          // damage feedback
          float ring = smoothstep(0.25, 0.85, length(cc * vec2(1.2, 1.0)));
          col = mix(col, vec3(0.45, 0.02, 0.02), clamp(uHurt * ring * 0.85 + uLow * ring * (0.25 + 0.1 * sin(uTime * 6.0)), 0.0, 0.9));
          col *= 1.0 - uDead * 0.45;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.rtScene.setSize(w, h);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    this.rtA.setSize(bw, bh); this.rtB.setSize(bw, bh);
    this.final.uniforms.uRes.value.set(w, h);
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.qScene, this.cam);
  }

  render(scene, camera, vmScene, vmCamera) {
    const r = this.r;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);
    r.autoClear = false;
    r.clearDepth();
    r.render(vmScene, vmCamera);
    r.autoClear = true;
    const bw = this.rtA.width, bh = this.rtA.height;
    this.bright.uniforms.tSrc.value = this.rtScene.texture;
    this.bright.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this.pass(this.bright, this.rtA);
    for (const s of [1, 2.2]) {
      this.blur.uniforms.tSrc.value = this.rtA.texture; this.blur.uniforms.uDir.value.set(s / bw, 0); this.pass(this.blur, this.rtB);
      this.blur.uniforms.tSrc.value = this.rtB.texture; this.blur.uniforms.uDir.value.set(0, s / bh); this.pass(this.blur, this.rtA);
    }
    const u = this.final.uniforms;
    u.tScene.value = this.rtScene.texture;
    u.tBloom.value = this.rtA.texture;
    this.pass(this.final, null);
  }
}

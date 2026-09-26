// Procedural textures (canvas) — no external assets needed.
import * as THREE from 'three';
import { mulberry32 } from './shared/map.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// value noise (tileable) helper
function makeNoise(R, n) {
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = R();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = g[((yi % n + n) % n) * n + ((xi % n + n) % n)], b = g[((yi % n + n) % n) * n + (((xi + 1) % n + n) % n)];
    const c = g[(((yi + 1) % n + n) % n) * n + ((xi % n + n) % n)], d = g[(((yi + 1) % n + n) % n) * n + (((xi + 1) % n + n) % n)];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(noise, x, y, oct, scale) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); f *= 2; amp *= 0.5; }
  return s;
}

function perPixel(ctx, w, h, fn) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; fn(d, i, x, y); }
  ctx.putImageData(img, 0, 0);
}

// Level 0 wallpaper: mono-yellow, faint vertical stripes with a repeating chevron motif, aged & damp.
// Texture spans 4m horizontally, full wall height vertically.
export function wallpaperTextures() {
  const W = 1024, H = 768, R = mulberry32(7);
  const [c, x] = canvas(W, H);
  x.fillStyle = '#c9b765';
  x.fillRect(0, 0, W, H);
  // vertical stripe bands
  const band = 32;
  for (let i = 0; i < W / band; i++) {
    x.fillStyle = i % 2 ? 'rgba(120,100,30,0.05)' : 'rgba(255,245,180,0.05)';
    x.fillRect(i * band, 0, band, H);
    x.fillStyle = 'rgba(110,90,30,0.10)';
    x.fillRect(i * band, 0, 1.5, H);
  }
  // chevron / arrow motif
  x.strokeStyle = 'rgba(120,98,34,0.20)';
  x.lineWidth = 2;
  for (let i = 0; i < W / band; i++) for (let j = 0; j < H / 36 + 1; j++) {
    const cx = i * band + band / 2, cy = j * 36 + (i % 2) * 18;
    x.beginPath();
    x.moveTo(cx - 7, cy + 5); x.lineTo(cx, cy - 3); x.lineTo(cx + 7, cy + 5);
    x.stroke();
    x.fillStyle = 'rgba(245,230,150,0.10)';
    x.fillRect(cx - 1, cy + 8, 2, 4);
  }
  // large blotches / water damage
  for (let i = 0; i < 26; i++) {
    const px = R() * W, py = R() * H, r = 30 + R() * 140;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    const a = 0.04 + R() * 0.08;
    g.addColorStop(0, `rgba(110,85,30,${a})`); g.addColorStop(0.7, `rgba(120,95,35,${a * 0.5})`); g.addColorStop(1, 'rgba(120,95,35,0)');
    x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  // drips from ceiling
  for (let i = 0; i < 14; i++) {
    const px = R() * W, len = 60 + R() * 300, wdt = 3 + R() * 14;
    const g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(100,78,28,0.22)'); g.addColorStop(1, 'rgba(100,78,28,0)');
    x.fillStyle = g; x.fillRect(px, 0, wdt, len);
  }
  // grime near floor and ceiling
  let g = x.createLinearGradient(0, H, 0, H - 150);
  g.addColorStop(0, 'rgba(70,55,20,0.35)'); g.addColorStop(1, 'rgba(70,55,20,0)');
  x.fillStyle = g; x.fillRect(0, H - 150, W, 150);
  g = x.createLinearGradient(0, 0, 0, 40);
  g.addColorStop(0, 'rgba(80,65,25,0.25)'); g.addColorStop(1, 'rgba(80,65,25,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, 40);
  // wallpaper panel seams (every 0.53m)
  for (let s = 0; s < W; s += W / 7.5) { x.fillStyle = 'rgba(90,70,25,0.12)'; x.fillRect(s, 0, 2, H); x.fillStyle = 'rgba(255,240,170,0.08)'; x.fillRect(s + 2, 0, 1, H); }
  // baseboard (bottom ~9cm)
  const bb = 24;
  x.fillStyle = '#8b7640'; x.fillRect(0, H - bb, W, bb);
  x.fillStyle = 'rgba(255,240,190,0.25)'; x.fillRect(0, H - bb, W, 2);
  x.fillStyle = 'rgba(40,30,10,0.35)'; x.fillRect(0, H - 3, W, 3);
  // fine grain
  const bump = new Uint8ClampedArray(W * H);
  const noise = makeNoise(R, 64);
  perPixel(x, W, H, (d, i, px, py) => {
    const n = (R() - 0.5) * 12 + (fbm(noise, px / 16, py / 16, 3) - 0.5) * 16;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.7;
    bump[py * W + px] = 128 + n * 2 + (py > H - bb ? 40 : 0) + ((px % band) < 2 ? -30 : 0);
  });
  const [bc, bx] = canvas(W, H);
  const bimg = bx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { const v = bump[i]; bimg.data[i * 4] = bimg.data[i * 4 + 1] = bimg.data[i * 4 + 2] = v; bimg.data[i * 4 + 3] = 255; }
  bx.putImageData(bimg, 0, 0);
  return { map: tex(c), bump: tex(bc, { srgb: false }) };
}

// Damp mustard carpet, texture spans 4m x 4m.
export function carpetTextures() {
  const S = 1024, R = mulberry32(11);
  const [c, x] = canvas(S, S);
  const noise = makeNoise(R, 32), noise2 = makeNoise(R, 128);
  const bump = new Uint8ClampedArray(S * S);
  const img = x.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let px = 0; px < S; px++) {
    const i = (y * S + px) * 4;
    const large = fbm(noise, px / 64, y / 64, 4);
    const fib = noise2(px / 1.3, y / 1.3) * 0.6 + R() * 0.4;
    const k = 0.82 + large * 0.28 + (fib - 0.5) * 0.35;
    d[i] = 156 * k; d[i + 1] = 134 * k; d[i + 2] = 74 * k; d[i + 3] = 255;
    bump[y * S + px] = 90 + fib * 140;
  }
  x.putImageData(img, 0, 0);
  const [bc, bx] = canvas(S, S);
  const bimg = bx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) { bimg.data[i * 4] = bimg.data[i * 4 + 1] = bimg.data[i * 4 + 2] = bump[i]; bimg.data[i * 4 + 3] = 255; }
  bx.putImageData(bimg, 0, 0);
  return { map: tex(c, { aniso: 16 }), bump: tex(bc, { srgb: false, aniso: 16 }) };
}

// Drop ceiling: 0.5m x 1m acoustic tiles in a T-bar grid; texture spans 4m x 4m.
export function ceilingTexture() {
  const S = 1024, R = mulberry32(23), px = S / 4; // px per meter
  const [c, x] = canvas(S, S);
  x.fillStyle = '#d9d1ae'; x.fillRect(0, 0, S, S);
  const tw = px * 0.5, th = px * 1.0;
  for (let ty = 0; ty < S; ty += th) for (let tx = 0; tx < S; tx += tw) {
    const v = R();
    if (v < 0.12) {
      const g = x.createRadialGradient(tx + tw * R(), ty + th * R(), 0, tx + tw / 2, ty + th / 2, th * 0.6);
      g.addColorStop(0, 'rgba(150,120,50,0.45)'); g.addColorStop(0.6, 'rgba(160,130,60,0.2)'); g.addColorStop(1, 'rgba(160,130,60,0)');
      x.fillStyle = g; x.fillRect(tx, ty, tw, th);
    } else if (v < 0.25) {
      x.fillStyle = `rgba(120,110,80,${0.05 + R() * 0.06})`; x.fillRect(tx, ty, tw, th);
    }
  }
  perPixel(x, S, S, (d, i) => {
    const n = R();
    const pit = n < 0.05 ? -40 : n < 0.1 ? -18 : 0;
    const k = (R() - 0.5) * 10 + pit;
    d[i] += k; d[i + 1] += k; d[i + 2] += k;
  });
  // T-bar grid
  for (let ty = 0; ty <= S; ty += th) { x.fillStyle = '#b9b4a0'; x.fillRect(0, ty - 3, S, 6); x.fillStyle = 'rgba(60,50,30,0.35)'; x.fillRect(0, ty + 3, S, 2); }
  for (let tx = 0; tx <= S; tx += tw) { x.fillStyle = '#b9b4a0'; x.fillRect(tx - 3, 0, 6, S); x.fillStyle = 'rgba(60,50,30,0.35)'; x.fillRect(tx + 3, 0, 2, S); }
  return tex(c);
}

// Troffer diffuser (prismatic lens)
export function lensTexture() {
  const [c, x] = canvas(128, 256);
  x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 6) for (let i = 0; i < 128; i += 6) { x.fillStyle = 'rgba(200,200,190,0.35)'; x.fillRect(i + ((y / 6) % 2) * 3, y, 3, 3); }
  const g = x.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(180,175,160,0.5)'); g.addColorStop(0.15, 'rgba(0,0,0,0)'); g.addColorStop(0.85, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(180,175,160,0.5)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 256);
  return tex(c, { repeat: false });
}

// Wooden loot crate with frame, planks, cross-brace, stencil stripe.
export function crateTexture() {
  const S = 256, R = mulberry32(5);
  const [c, x] = canvas(S, S);
  const noise = makeNoise(R, 16);
  const img = x.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let px = 0; px < S; px++) {
    const i = (y * S + px) * 4;
    const plank = Math.floor(y / 51);
    const grain = Math.sin((px / 256) * 40 + noise(px / 40, y / 6 + plank * 7) * 6) * 0.5 + 0.5;
    const k = 0.75 + grain * 0.2 + (R() - 0.5) * 0.08 + (plank % 2) * 0.05;
    d[i] = 150 * k; d[i + 1] = 108 * k; d[i + 2] = 62 * k; d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  x.fillStyle = 'rgba(40,25,10,0.6)';
  for (let y = 51; y < S; y += 51) x.fillRect(0, y - 1, S, 2);
  // frame
  x.lineWidth = 26; x.strokeStyle = 'rgba(95,62,30,0.92)'; x.strokeRect(13, 13, S - 26, S - 26);
  x.lineWidth = 2; x.strokeStyle = 'rgba(30,18,8,0.8)'; x.strokeRect(26, 26, S - 52, S - 52); x.strokeRect(1, 1, S - 2, S - 2);
  // brace
  x.save(); x.translate(S / 2, S / 2); x.rotate(-Math.PI / 4);
  x.fillStyle = 'rgba(105,70,35,0.95)'; x.fillRect(-150, -13, 300, 26);
  x.fillStyle = 'rgba(30,18,8,0.7)'; x.fillRect(-150, -13, 300, 2); x.fillRect(-150, 11, 300, 2);
  x.restore();
  // nails
  x.fillStyle = '#2a2a2a';
  for (const [a, b] of [[13, 13], [S - 13, 13], [13, S - 13], [S - 13, S - 13], [S / 2, 13], [S / 2, S - 13]]) { x.beginPath(); x.arc(a, b, 3, 0, 7); x.fill(); }
  // yellow hazard stencil
  x.fillStyle = 'rgba(230,190,40,0.85)'; x.fillRect(40, S / 2 - 10, 50, 20);
  x.fillStyle = 'rgba(20,20,20,0.9)'; x.font = 'bold 15px monospace'; x.fillText('B-0', 46, S / 2 + 5);
  return tex(c, { repeat: false });
}

export function bulletHoleTexture() {
  const S = 64;
  const [c, x] = canvas(S, S);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.18, 'rgba(10,8,5,0.95)'); g.addColorStop(0.3, 'rgba(40,30,15,0.7)');
  g.addColorStop(0.55, 'rgba(60,45,20,0.25)'); g.addColorStop(1, 'rgba(60,45,20,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(20,15,8,0.6)'; x.lineWidth = 1;
  const R = mulberry32(3);
  for (let i = 0; i < 7; i++) { const a = R() * 6.28, l = 10 + R() * 14; x.beginPath(); x.moveTo(32, 32); x.lineTo(32 + Math.cos(a) * l, 32 + Math.sin(a) * l); x.stroke(); }
  return tex(c, { repeat: false, srgb: true });
}

export function muzzleTexture() {
  const S = 128;
  const [c, x] = canvas(S, S);
  x.translate(64, 64);
  for (let i = 0; i < 7; i++) {
    x.rotate((Math.PI * 2) / 7 + Math.random() * 0.3);
    const g = x.createLinearGradient(0, 0, 60, 0);
    g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.4, 'rgba(255,170,60,0.7)'); g.addColorStop(1, 'rgba(255,120,20,0)');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(0, -7); x.lineTo(62, 0); x.lineTo(0, 7); x.fill();
  }
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 34);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.5, 'rgba(255,190,90,0.6)'); g.addColorStop(1, 'rgba(255,140,40,0)');
  x.fillStyle = g; x.fillRect(-64, -64, 128, 128);
  return tex(c, { repeat: false });
}

export function softDotTexture() {
  const S = 64;
  const [c, x] = canvas(S, S);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return tex(c, { repeat: false, srgb: false });
}

export function labelTexture(text, color = '#fff') {
  const [c, x] = canvas(256, 48);
  x.font = 'bold 28px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillText(text, 129, 26);
  x.fillStyle = color; x.fillText(text, 128, 24);
  return tex(c, { repeat: false });
}

// Blood spatter decal: dark red core with irregular droplets.
export function bloodTexture() {
  const S = 128, R = mulberry32(17);
  const [c, x] = canvas(S, S);
  const drop = (px, py, r, a) => {
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(70,4,4,${a})`); g.addColorStop(0.7, `rgba(55,3,3,${a * 0.85})`); g.addColorStop(1, 'rgba(40,2,2,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  };
  drop(64, 64, 26, 0.95);
  for (let i = 0; i < 26; i++) {
    const a = R() * 6.28, d = 14 + R() * 44, r = 2 + R() * 7 * (1 - d / 64);
    drop(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, Math.max(1.5, r), 0.7 + R() * 0.3);
  }
  for (let i = 0; i < 7; i++) { // streaks
    const a = R() * 6.28, l = 20 + R() * 36;
    x.strokeStyle = 'rgba(60,3,3,0.8)'; x.lineWidth = 1.5 + R() * 2.5; x.lineCap = 'round';
    x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(a) * l, 64 + Math.sin(a) * l); x.stroke();
  }
  return tex(c, { repeat: false });
}

// Explosion scorch mark on the carpet.
export function scorchTexture() {
  const S = 128, R = mulberry32(29);
  const [c, x] = canvas(S, S);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(8,6,4,0.95)'); g.addColorStop(0.35, 'rgba(15,11,6,0.85)'); g.addColorStop(0.7, 'rgba(30,22,10,0.35)'); g.addColorStop(1, 'rgba(30,22,10,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(10,8,5,0.6)';
  for (let i = 0; i < 18; i++) { const a = R() * 6.28, l = 30 + R() * 30; x.lineWidth = 1 + R() * 3; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(a) * l, 64 + Math.sin(a) * l); x.stroke(); }
  return tex(c, { repeat: false });
}

// Almond-water vending machine: painted front (lit by the level) + self-lit sign and window (overlay).
export function vendorTextures() {
  const W = 256, H = 544, R = mulberry32(21);
  const [c, x] = canvas(W, H);
  const noise = makeNoise(R, 16);
  // cream enamel, grimy toward the bottom
  perPixel(x, W, H, (d, i, px, py) => {
    const n = fbm(noise, px / 30, py / 30, 3) - 0.5, grime = Math.max(0, (py - 380) / 164) * 0.35;
    const k = 0.9 + n * 0.12 - grime;
    d[i] = 204 * k; d[i + 1] = 190 * k; d[i + 2] = 150 * k; d[i + 3] = 255;
  });
  x.fillStyle = '#3b2a1a'; x.fillRect(0, 0, W, 76);                       // sign housing
  x.fillStyle = '#20180f'; x.fillRect(12, 84, 170, 322);                   // window frame
  x.fillStyle = '#6d6150'; x.fillRect(190, 96, 54, 250);                   // control panel
  x.fillStyle = '#1b1712'; x.fillRect(200, 108, 34, 22);                   // price display
  for (let r = 0; r < 4; r++) for (let q = 0; q < 3; q++) {
    x.fillStyle = '#d8d2c0'; x.fillRect(199 + q * 12, 142 + r * 16, 9, 11);
    x.fillStyle = '#4a4034'; x.font = 'bold 8px monospace'; x.fillText(String((r * 3 + q + 1) % 10), 201 + q * 12, 151 + r * 16);
  }
  x.fillStyle = '#26211a'; x.fillRect(208, 222, 18, 34); x.fillStyle = '#0c0a08'; x.fillRect(215, 226, 4, 26); // bill / coin slot
  x.fillStyle = '#9a8f78'; x.fillRect(204, 270, 26, 40); x.fillStyle = '#1a1612'; x.fillRect(209, 290, 16, 14);   // coin return
  x.fillStyle = '#1b1712'; x.fillRect(22, 430, 156, 74);                  // dispense opening
  x.fillStyle = '#3a342b'; x.fillRect(26, 434, 148, 36);                  // flap
  x.fillStyle = '#d9c9a0'; x.font = 'bold 13px monospace'; x.fillText('İT', 92, 458);
  x.fillStyle = 'rgba(70,40,20,0.35)';
  for (let i = 0; i < 26; i++) { x.beginPath(); x.arc(R() * W, 470 + R() * 74, 2 + R() * 7, 0, 7); x.fill(); }  // rust
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, H - 14, W, 14);
  const front = tex(c, { repeat: false });

  // self-lit overlay: glowing sign + lit window with rows of bottles
  const [c2, y] = canvas(W, H);
  y.clearRect(0, 0, W, H);
  const sg = y.createLinearGradient(0, 8, 0, 70);
  sg.addColorStop(0, '#f6ecc8'); sg.addColorStop(1, '#d9c796');
  y.fillStyle = sg; y.fillRect(8, 8, W - 16, 60);
  y.fillStyle = '#5a3a1c'; y.font = 'bold 30px monospace'; y.textAlign = 'center';
  y.fillText('BADEM SUYU', W / 2, 44);
  y.font = 'bold 11px monospace'; y.fillText('SEVİYE 0 · SOĞUK', W / 2, 61);
  y.textAlign = 'left';
  const wg = y.createLinearGradient(16, 88, 180, 400);
  wg.addColorStop(0, '#dfe6d6'); wg.addColorStop(1, '#a9b39c');
  y.fillStyle = wg; y.fillRect(16, 88, 162, 314);
  for (let s = 0; s < 5; s++) {
    const sy = 92 + s * 62;
    for (let b = 0; b < 5; b++) {
      const bx = 22 + b * 31;
      y.fillStyle = s === 4 && b > 2 ? 'rgba(0,0,0,0.12)' : '#f2f1e8'; y.fillRect(bx + 6, sy + 12, 17, 40);      // bottle
      y.fillStyle = '#c49a5a'; y.fillRect(bx + 6, sy + 26, 17, 14);                                          // label
      y.fillStyle = '#2c5ca8'; y.fillRect(bx + 10, sy + 5, 9, 7);                                            // cap
      y.fillStyle = 'rgba(255,255,255,0.5)'; y.fillRect(bx + 8, sy + 14, 3, 36);
    }
    y.fillStyle = '#7d7666'; y.fillRect(16, sy + 54, 162, 5);                                               // shelf + spiral
  }
  y.fillStyle = 'rgba(255,255,250,0.9)'; y.fillRect(18, 90, 158, 4);                                        // tube
  y.fillStyle = 'rgba(255,255,255,0.12)'; y.beginPath(); y.moveTo(16, 88); y.lineTo(90, 88); y.lineTo(30, 402); y.lineTo(16, 402); y.fill(); // glare
  y.fillStyle = '#ff5b3a'; y.font = 'bold 14px monospace'; y.fillText('$', 203, 125);
  y.fillStyle = '#7dff9a'; y.fillRect(221, 116, 8, 8);
  const glow = tex(c2, { repeat: false });
  return { front, glow };
}

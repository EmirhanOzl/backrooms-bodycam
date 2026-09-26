// Studio renders of shop goods (loot items, weapons, attachments), made once with the game's renderer and
// cached as data URLs for the vending machine menu.
import * as THREE from 'three';
import { mergedGunGeometry, mergedItemGeometry, attachmentGeometry } from './models.js';

const W = 176, H = 108, SS = 2; // icon size in CSS px, supersampling
const cache = new Map();

// entry: { id, k, w, a (attachment key) } as in SHOP
function geometryFor(it) {
  if (it.k === 'weapon') return { geo: mergedGunGeometry(it.w, 0).geo, side: true, rot: -Math.PI / 2 };
  if (it.k === 'att') return { geo: attachmentGeometry(it.id), side: true, rot: 0 }; // built along +X already
  return { geo: mergedItemGeometry(it.k, 60), side: false };
}

export function shopIcons(renderer, list) {
  const todo = list.filter((it) => !cache.has(it.id));
  if (todo.length) {
    const rt = new THREE.WebGLRenderTarget(W * SS, H * SS);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xfff6e6, 0.55));
    const key = new THREE.DirectionalLight(0xfff2dc, 1.25); key.position.set(1.5, 2.5, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(0xc8d8ff, 0.7); rim.position.set(-3, 1.5, -2); scene.add(rim);
    const cam = new THREE.PerspectiveCamera(24, W / H, 0.01, 50);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const prev = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), auto: renderer.autoClear };
    const px = new Uint8Array(W * SS * H * SS * 4);
    const big = document.createElement('canvas'); big.width = W * SS; big.height = H * SS;
    const bx = big.getContext('2d');
    const small = document.createElement('canvas'); small.width = W; small.height = H;
    const sx = small.getContext('2d');
    const box = new THREE.Box3(), size = new THREE.Vector3(), center = new THREE.Vector3();
    renderer.setClearColor(0x000000, 0); renderer.autoClear = true;
    for (const it of todo) {
      const { geo, side, rot } = geometryFor(it), gun = side;
      const mesh = new THREE.Mesh(geo, mat);
      // guns / attachments side-on, muzzle to the right; items seen from above and in front, as they lie
      if (side) mesh.rotation.set(0, rot, 0.06); else mesh.rotation.set(0, -0.55, 0);
      scene.add(mesh);
      mesh.updateMatrixWorld(true);
      box.setFromObject(mesh); box.getSize(size); box.getCenter(center);
      const el = gun ? 0.12 : 0.62, dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
      const r = Math.max(size.x / cam.aspect, size.y * Math.cos(el) + size.z * Math.sin(el), 0.05);
      const dist = (r / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) * 1.18 + size.z / 2;
      cam.position.copy(center).addScaledVector(dir, dist);
      cam.lookAt(center);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, W * SS, H * SS, px);
      const img = bx.createImageData(W * SS, H * SS), row = W * SS * 4;
      for (let y = 0; y < H * SS; y++) img.data.set(px.subarray((H * SS - 1 - y) * row, (H * SS - y) * row), y * row); // flip
      bx.putImageData(img, 0, 0);
      sx.clearRect(0, 0, W, H);
      sx.drawImage(big, 0, 0, W, H);
      cache.set(it.id, small.toDataURL('image/png'));
      scene.remove(mesh);
    }
    renderer.setRenderTarget(prev.target);
    renderer.setClearColor(prev.color, prev.alpha);
    renderer.autoClear = prev.auto;
    rt.dispose(); mat.dispose();
  }
  return Object.fromEntries(list.map((it) => [it.id, cache.get(it.id)]));
}

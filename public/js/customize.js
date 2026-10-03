// The workshop uses the same operator geometry as multiplayer, not a separate illustration.
import * as THREE from 'three';
import { Soldier } from './models.js';
import { APPEARANCE_OPTIONS, APPEARANCE_PALETTES, normalizeAppearance } from './shared/customization.js';
import { settings, saveSettings } from './settings.js';

export function buildCustomizer(host) {
  const wrap = document.createElement('div');
  wrap.className = 'operator-workshop';
  const preview = document.createElement('div');
  preview.className = 'operator-preview';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Seçilen operatörün canlı üç boyutlu önizlemesi');
  preview.append(canvas);
  const turn = document.createElement('input');
  turn.type = 'range'; turn.min = '-180'; turn.max = '180'; turn.value = '0';
  turn.setAttribute('aria-label', 'Operatörü döndür');
  preview.append(turn);
  const caption = document.createElement('p');
  caption.className = 'desc small'; caption.textContent = 'CANLI ÖNİZLEME · ALT ÇUBUKLA DÖNDÜR';
  preview.append(caption);
  const choices = document.createElement('div');
  choices.className = 'operator-choices';
  wrap.append(preview, choices); host.append(wrap);
  const buttons = [];
  const labels = { head: '01 / KAFA', chest: '02 / GÖĞÜS', legs: '03 / BACAK' };
  for (const key of ['head', 'chest', 'legs', 'palette']) {
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = labels[key] || '04 / KUMAŞ RENGİ';
    group.append(legend);
    const options = key === 'palette' ? APPEARANCE_PALETTES : APPEARANCE_OPTIONS[key];
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'operator-option';
      button.dataset.part = key; button.dataset.choice = option.id;
      const title = document.createElement('strong'); title.textContent = option.label;
      const detail = document.createElement('small'); detail.textContent = option.description || 'Tüm donanımlarla uyumlu';
      if (option.color) button.style.setProperty('--swatch', option.color);
      button.append(title, detail);
      button.onclick = () => {
        settings.appearance = normalizeAppearance({ ...settings.appearance, [key]: option.id });
        saveSettings(); refresh();
      };
      buttons.push({ button, key, id: option.id }); group.append(button);
    }
    choices.append(group);
  }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(300, 380, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 300 / 380, 0.1, 10);
  camera.position.set(0.25, 1.1, -3.1); camera.lookAt(0, 0.9, 0);
  scene.add(new THREE.AmbientLight(0xe5ecf2, 0.55));
  const key = new THREE.DirectionalLight(0xffe4b5, 2); key.position.set(-2, 3, -2); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8ac8ff, 1.7); rim.position.set(2, 2, 1); scene.add(rim);
  const model = new Soldier('#424b45', 'pistol', settings.appearance);
  scene.add(model.root);
  function refresh() {
    model.setAppearance(settings.appearance);
    for (const { button, key, id } of buttons) {
      const selected = settings.appearance[key] === id;
      button.classList.toggle('on', selected); button.setAttribute('aria-pressed', String(selected));
    }
  }
  refresh();
  return {
    refresh,
    update(dt) {
      model.update(dt, { x: 0, y: 0, z: 0, yaw: +turn.value * Math.PI / 180, pitch: -0.08, crouch: false, speed: 0, alive: true, flash: false, lean: 0, reload: false, sprint: false }, 0.8);
      renderer.render(scene, camera);
    },
    dispose() { model.dispose(); renderer.dispose(); },
  };
}

// Persistent player settings + the tabbed settings panel (shared by the main menu and the pause menu).
import { DEFAULT_APPEARANCE, normalizeAppearance } from './shared/customization.js';
const KEY = 'brbc2';

// rebindable actions: [id, label, default key code]
export const ACTIONS = [
  ['forward', 'İleri', 'KeyW'], ['back', 'Geri', 'KeyS'], ['left', 'Sola', 'KeyA'], ['right', 'Sağa', 'KeyD'],
  ['sprint', 'Koş · dürbünde nefes tut', 'ShiftLeft'], ['crouch', 'Çömel', 'KeyC'], ['jump', 'Zıpla', 'Space'],
  ['leanL', 'Sola eğil', 'KeyZ'], ['leanR', 'Sağa eğil', 'KeyX'], ['reload', 'Şarjör değiştir', 'KeyR'],
  ['mode', 'Atış modu', 'KeyB'], ['nade', 'El bombası (basılı tut: beklet)', 'KeyG'], ['use', 'Kullan: sandık aç · silah al · otomat', 'KeyE'],
  ['flash', 'Fener', 'KeyT'], ['inspect', 'Silahı / bıçağı incele', 'KeyF'], ['slot1', 'Birincil silah', 'Digit1'],
  ['slot2', 'İkincil silah', 'Digit2'], ['slot3', 'Bıçak', 'Digit3'], ['score', 'Skor tablosu', 'Tab'],
];
// fixed secondary keys that always work in addition to the binding
export const ALT_KEYS = { crouch: ['ControlLeft', 'ControlRight'], sprint: ['ShiftRight'], nade: ['Digit4'] };
const DEFAULT_BINDS = Object.fromEntries(ACTIONS.map(([a, , k]) => [a, k]));

export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  const map = { ShiftLeft: 'SHIFT', ShiftRight: 'SAĞ SHIFT', ControlLeft: 'CTRL', ControlRight: 'SAĞ CTRL', AltLeft: 'ALT', AltRight: 'ALT GR', Space: 'SPACE', Tab: 'TAB', CapsLock: 'CAPS', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Comma: ',', Period: '.', Slash: '/', Enter: 'ENTER', Backspace: 'BACKSPACE' };
  return map[code] || code.replace('Arrow', '').toUpperCase();
}

// crosshair (Valorant-style editor): lines, center dot, outline, color, dynamic spread
export const XH_DEFAULT = { show: true, color: '#ffffff', outline: true, olTh: 1, olA: 0.65, dot: true, dotSize: 2, dotA: 1, lines: true, len: 6, th: 2, gap: 4, lineA: 1, dynamic: true, tstyle: false };
export const XH_PRESETS = [
  ['Varsayılan', {}],
  ['Klasik CS', { color: '#4dff5e', dot: false, len: 8, th: 2, gap: 3, olA: 0.8 }],
  ['Keskin', { color: '#5ef2ff', dot: false, len: 4, th: 2, gap: 2, dynamic: false, olA: 0.5 }],
  ['Nokta', { lines: false, dotSize: 4, olA: 0.8 }],
  ['T-şekli', { tstyle: true, dot: false, len: 7, gap: 4 }],
  ['Büyük artı', { len: 10, th: 3, gap: 6, dot: false, color: '#ffe14d' }],
];
const XH_OLD_COLORS = { white: '#ffffff', green: '#6dff7a', cyan: '#5ef2ff', red: '#ff4b4b', yellow: '#ffe14d' };

export const DEFAULTS = {
  name: 'Gezgin', sens: 1, adsSens: 1, rawInput: true, invertY: false, holdAds: true, holdCrouch: true, xh: { ...XH_DEFAULT }, hitmarks: true,
  quality: 1, fov: 80, lens: 1, shake: 1, blur: true, bright: 1, fps: false,
  master: 0.8, sfx: 1, amb: 0.8, ui: 0.9, hrtf: true,
  bots: 6, onlineBots: 5, diff: 1, frags: 20, time: 10, mode: 'ffa', light: 'normal', layout: 'maze',
  onlineMode: 'ffa', onlineLayout: 'maze', onlineLight: 'normal', escapeRole: 'survivor', appearance: { ...DEFAULT_APPEARANCE },
  binds: DEFAULT_BINDS, bindsV: 2,
};

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem('brbc') || '{}'); } catch { /* private mode */ }
  if (saved.vol != null && saved.master == null) saved.master = saved.vol;
  const s = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (saved[k] != null && typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
  s.binds = { ...DEFAULT_BINDS, ...(saved.binds && typeof saved.binds === 'object' ? saved.binds : {}) };
  // v2 layout (CS style): E use, F inspect, lean moved to Z / X. Keys still on the old defaults move along.
  if (saved.binds && saved.bindsV !== 2) {
    const OLD = { use: 'KeyF', inspect: 'KeyV', leanL: 'KeyQ', leanR: 'KeyE' };
    for (const [a, k] of Object.entries(OLD)) if (s.binds[a] === k) s.binds[a] = DEFAULT_BINDS[a];
    // a custom key that now collides with a moved default gives way to it
    for (const a of Object.keys(OLD)) for (const b of Object.keys(s.binds)) if (b !== a && s.binds[b] === s.binds[a] && !(b in OLD)) s.binds[b] = saved.binds[a] || '';
  }
  s.bindsV = 2;
  s.xh = { ...XH_DEFAULT, ...(saved.xh && typeof saved.xh === 'object' ? saved.xh : {}) };
  if (!Number.isInteger(s.onlineBots) || s.onlineBots < 0 || s.onlineBots > 10) s.onlineBots = DEFAULTS.onlineBots;
  s.appearance = normalizeAppearance(s.appearance);
  for (const k of ['mode', 'onlineMode']) if (!['ffa', 'tdm', 'escape'].includes(s[k])) s[k] = DEFAULTS[k];
  for (const k of ['layout', 'onlineLayout']) if (!['maze', 'arena', 'escape'].includes(s[k])) s[k] = DEFAULTS[k];
  if (!['survivor', 'monster'].includes(s.escapeRole)) s.escapeRole = 'survivor';
  if (!saved.xh) { // settings from before the editor
    if (saved.xstyle === 'off' || saved.xhair === false) s.xh.show = false;
    if (saved.xstyle === 'dot') s.xh.lines = false;
    if (XH_OLD_COLORS[saved.xcolor]) s.xh.color = XH_OLD_COLORS[saved.xcolor];
  }
  return s;
}
export const settings = load();
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } }

const pct = (v) => `${Math.round(v * 100)}%`;
const SCHEMA = [
  {
    tab: 'OYUN', items: [
      { k: 'name', label: 'Operatör adı', type: 'text' },
      { k: 'sens', label: 'Fare hassasiyeti', type: 'range', min: 0.1, max: 4, step: 0.05, fmt: (v) => v.toFixed(2) },
      { k: 'adsSens', label: 'Nişan / dürbün hassasiyeti', type: 'range', min: 0.3, max: 1.6, step: 0.05, fmt: (v) => v.toFixed(2) },
      { k: 'rawInput', label: 'Ham fare girişi', type: 'check', hint: 'İşletim sisteminin fare ivmesini atlar; nişan tutarlı olur. Bir sonraki tıklamada geçerli olur.' },
      { k: 'invertY', label: 'Y eksenini ters çevir', type: 'check' },
      { k: 'holdAds', label: 'Nişan alma (sağ tık)', type: 'select', opts: [[true, 'Basılı tut'], [false, 'Aç / kapat']] },
      { k: 'holdCrouch', label: 'Çömelme', type: 'select', opts: [[true, 'Basılı tut'], [false, 'Aç / kapat']] },
      { k: 'hitmarks', label: 'Vuruş işaretleri', type: 'check' },
    ],
  },
  {
    tab: 'GÖRÜNTÜ', items: [
      { k: 'quality', label: 'Grafik kalitesi', type: 'select', opts: [[0, 'Düşük (hızlı)'], [1, 'Orta'], [2, 'Yüksek']] },
      { k: 'fov', label: 'Görüş açısı (FOV)', type: 'range', min: 65, max: 100, step: 1, fmt: (v) => `${v}°` },
      { k: 'lens', label: 'Bodycam lens efekti', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, hint: 'Balık gözü, renk sapması ve gren. Baş dönmesi yaşarsan azalt.' },
      { k: 'shake', label: 'Kamera sarsıntısı', type: 'range', min: 0, max: 1.5, step: 0.05, fmt: pct },
      { k: 'blur', label: 'Hareket bulanıklığı', type: 'check' },
      { k: 'bright', label: 'Parlaklık', type: 'range', min: 0.7, max: 1.5, step: 0.05, fmt: pct },
      { k: 'fps', label: 'FPS göstergesi', type: 'check' },
    ],
  },
  {
    tab: 'SES', items: [
      { k: 'master', label: 'Ana ses', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
      { k: 'sfx', label: 'Efektler (silah, adım)', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
      { k: 'amb', label: 'Ortam (uğultu, uzak sesler)', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
      { k: 'ui', label: 'Arayüz / vuruş sesleri', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
      { k: 'hrtf', label: '3D kulaklık sesi (HRTF)', type: 'check', hint: 'Kulaklıkla adım ve atış yönünü çok daha net duyarsın.' },
    ],
  },
  { tab: 'NİŞANGAH', crosshair: true },
  { tab: 'KONTROLLER', controls: true },
];

// Applies crosshair settings to a `.xh` element (the HUD one and the editor preview share this).
export function styleCrosshair(el, xh, gap = xh.gap) {
  const st = el.style, half = (v) => `${-Math.floor(v / 2)}px`;
  st.setProperty('--xc', xh.color);
  st.setProperty('--len', `${xh.len}px`); st.setProperty('--th', `${xh.th}px`); st.setProperty('--thh', half(xh.th));
  st.setProperty('--gap', `${gap}px`);
  st.setProperty('--la', xh.lines ? xh.lineA : 0);
  st.setProperty('--dot', `${xh.dotSize}px`); st.setProperty('--doth', half(xh.dotSize)); st.setProperty('--da', xh.dot ? xh.dotA : 0);
  st.setProperty('--ol', xh.outline ? `${xh.olTh}px` : '0px'); st.setProperty('--ola', xh.olA);
  el.classList.toggle('tstyle', !!xh.tstyle);
}

// Crosshair editor: live preview on switchable backgrounds, presets and every parameter.
function buildCrosshairEditor(page, onChange) {
  page.innerHTML = '';
  const xh = settings.xh;
  const prev = document.createElement('div'); prev.className = 'xhprev wall';
  prev.innerHTML = '<div class="xh"><i></i><i></i><i></i><i></i><b></b></div><div class="bgs"><button type="button" data-bg="wall">DUVAR</button><button type="button" data-bg="dark">KARANLIK</button><button type="button" data-bg="carpet">HALI</button></div>';
  const xel = prev.querySelector('.xh');
  prev.querySelectorAll('[data-bg]').forEach((b) => { b.onclick = () => { prev.className = 'xhprev ' + b.dataset.bg; }; });
  page.appendChild(prev);
  // with "dynamic" on, the preview breathes the way it opens while moving and firing
  let t0 = performance.now();
  const tick = () => {
    if (!page.isConnected) return;
    if (page.offsetParent !== null) styleCrosshair(xel, xh, xh.gap + (xh.dynamic ? (Math.sin((performance.now() - t0) / 450) * 0.5 + 0.5) * 10 : 0));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const presets = document.createElement('div'); presets.className = 'xhpresets';
  page.appendChild(presets);
  const rows = document.createElement('div'); page.appendChild(rows);
  const changed = (rebuild) => { saveSettings(); onChange('xh'); t0 = performance.now(); if (rebuild) render(); };
  for (const [name, p] of XH_PRESETS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost small'; b.textContent = name;
    b.onclick = () => { Object.assign(xh, XH_DEFAULT, p); changed(true); };
    presets.appendChild(b);
  }
  const check = (k, label) => {
    const row = document.createElement('label'); row.className = 'row';
    row.innerHTML = `<span class="lab">${label}</span>`;
    const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!xh[k]; i.dataset.k = 'xh.' + k;
    i.onchange = () => { xh[k] = i.checked; changed(); };
    row.appendChild(i); rows.appendChild(row);
  };
  const range = (k, label, min, max, step, fmt) => {
    const row = document.createElement('label'); row.className = 'row sub';
    row.innerHTML = `<span class="lab">${label}</span>`;
    const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = xh[k]; i.dataset.k = 'xh.' + k;
    const out = document.createElement('span'); out.className = 'val'; out.textContent = fmt(xh[k]);
    i.oninput = () => { xh[k] = +i.value; out.textContent = fmt(xh[k]); changed(); };
    row.append(i, out); rows.appendChild(row);
  };
  const pct = (v) => `${Math.round(v * 100)}%`, px = (v) => `${v}px`;
  const render = () => {
    rows.innerHTML = '';
    check('show', 'Nişangahı göster');
    const crow = document.createElement('div'); crow.className = 'row';
    crow.innerHTML = '<span class="lab">Renk</span>';
    const sw = document.createElement('div'); sw.className = 'swatches';
    for (const c of ['#ffffff', '#4dff5e', '#5ef2ff', '#ffe14d', '#ff5ad2', '#ff4b4b']) {
      const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.title = c;
      if (xh.color.toLowerCase() === c) b.className = 'on';
      b.onclick = () => { xh.color = c; changed(true); };
      sw.appendChild(b);
    }
    const pick = document.createElement('input'); pick.type = 'color'; pick.value = xh.color; pick.title = 'Özel renk';
    pick.oninput = () => { xh.color = pick.value; changed(); };
    sw.appendChild(pick); crow.appendChild(sw); rows.appendChild(crow);
    check('outline', 'Dış hat');
    range('olTh', 'Dış hat kalınlığı', 1, 3, 1, px);
    range('olA', 'Dış hat opaklığı', 0, 1, 0.05, pct);
    check('dot', 'Merkez noktası');
    range('dotSize', 'Nokta boyutu', 1, 6, 1, px);
    range('dotA', 'Nokta opaklığı', 0, 1, 0.05, pct);
    check('lines', 'İç çizgiler');
    range('len', 'Çizgi uzunluğu', 1, 20, 1, px);
    range('th', 'Çizgi kalınlığı', 1, 6, 1, px);
    range('gap', 'Merkez boşluğu', 0, 20, 1, px);
    range('lineA', 'Çizgi opaklığı', 0, 1, 0.05, pct);
    check('tstyle', 'T-şekli (üst çizgi yok)');
    check('dynamic', 'Hareket ve ateşle açılsın');
  };
  render();
}


// Rebinding table: click an action, then press the new key (Esc cancels). A key already in use is swapped.
export function buildControls(root, onChange = () => {}) {
  root.innerHTML = '';
  const t = document.createElement('table'); t.className = 'keys';
  for (const [a, label] of ACTIONS) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'), td2 = document.createElement('td');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'bind';
    const alt = ALT_KEYS[a] ? ` <span class="alt">/ ${ALT_KEYS[a].map(keyLabel).filter((x, i, arr) => arr.indexOf(x) === i).join(' / ')}</span>` : '';
    b.innerHTML = `<kbd>${keyLabel(settings.binds[a])}</kbd>`;
    b.onclick = () => {
      b.innerHTML = '<kbd class="wait">TUŞA BAS…</kbd>';
      const on = (e) => {
        e.preventDefault(); e.stopImmediatePropagation();
        window.removeEventListener('keydown', on, true);
        if (e.code !== 'Escape') {
          const other = Object.keys(settings.binds).find((k) => k !== a && settings.binds[k] === e.code);
          if (other) settings.binds[other] = settings.binds[a];
          settings.binds[a] = e.code;
          saveSettings(); onChange('binds');
        }
        for (const r of document.querySelectorAll('.controlsHost')) buildControls(r, onChange);
      };
      window.addEventListener('keydown', on, true);
    };
    td1.appendChild(b); td1.insertAdjacentHTML('beforeend', alt);
    td2.textContent = label;
    tr.append(td1, td2); t.appendChild(tr);
  }
  const fixed = [['SOL TIK', 'Ateş · bıçak: hafif saldırı'], ['SAĞ TIK', 'Nişan al · bıçak: ağır saplama'], ['TEKERLEK', 'Silah değiştir'], ['ESC', 'Duraklat']];
  for (const [k, v] of fixed) t.insertAdjacentHTML('beforeend', `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`);
  root.appendChild(t);
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'ghost small'; reset.textContent = 'TUŞLARI SIFIRLA';
  reset.onclick = () => { settings.binds = { ...DEFAULT_BINDS }; saveSettings(); onChange('binds'); for (const r of document.querySelectorAll('.controlsHost')) buildControls(r, onChange); };
  root.appendChild(reset);
}

// Builds the panel into `root`; onChange(key) is called after every change (already saved).
export function buildSettingsPanel(root, onChange) {
  root.innerHTML = '';
  const tabs = document.createElement('div'); tabs.className = 'tabs';
  const body = document.createElement('div'); body.className = 'tabbody';
  root.append(tabs, body);
  const pages = SCHEMA.map((sec, i) => {
    const b = document.createElement('button'); b.className = 'tab' + (i === 0 ? ' on' : ''); b.textContent = sec.tab; b.type = 'button';
    tabs.appendChild(b);
    const page = document.createElement('div'); page.className = 'page' + (i === 0 ? '' : ' hidden');
    body.appendChild(page);
    b.onclick = () => { tabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('on')); b.classList.add('on'); pages.forEach((p) => p.classList.add('hidden')); page.classList.remove('hidden'); };
    if (sec.controls) {
      page.classList.add('controlsHost');
      buildControls(page, onChange);
      return page;
    }
    if (sec.crosshair) { page.classList.add('xhHost'); buildCrosshairEditor(page, onChange); return page; }
    for (const it of sec.items) {
      const row = document.createElement('label'); row.className = 'row';
      const lab = document.createElement('span'); lab.className = 'lab'; lab.textContent = it.label;
      if (it.hint) lab.title = it.hint;
      row.appendChild(lab);
      let input, out = null;
      if (it.type === 'range') {
        input = document.createElement('input'); input.type = 'range'; input.min = it.min; input.max = it.max; input.step = it.step; input.value = settings[it.k];
        out = document.createElement('span'); out.className = 'val'; out.textContent = it.fmt(settings[it.k]);
        input.oninput = () => { settings[it.k] = +input.value; out.textContent = it.fmt(settings[it.k]); saveSettings(); onChange(it.k); };
      } else if (it.type === 'check') {
        input = document.createElement('input'); input.type = 'checkbox'; input.checked = settings[it.k];
        input.onchange = () => { settings[it.k] = input.checked; saveSettings(); onChange(it.k); };
      } else if (it.type === 'select') {
        input = document.createElement('select');
        it.opts.forEach(([v, t], j) => { const o = document.createElement('option'); o.value = j; o.textContent = t; if (v === settings[it.k]) o.selected = true; input.appendChild(o); });
        input.onchange = () => { settings[it.k] = it.opts[+input.value][0]; saveSettings(); onChange(it.k); };
      } else {
        input = document.createElement('input'); input.type = 'text'; input.maxLength = 16; input.value = settings[it.k];
        input.onchange = () => { settings[it.k] = input.value.trim().slice(0, 16) || DEFAULTS.name; input.value = settings[it.k]; saveSettings(); onChange(it.k); };
      }
      input.dataset.k = it.k;
      row.appendChild(input);
      if (out) row.appendChild(out);
      if (it.hint) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = it.hint; page.appendChild(row); page.appendChild(h); continue; }
      page.appendChild(row);
    }
    return page;
  });
  const reset = document.createElement('button'); reset.className = 'ghost small'; reset.type = 'button'; reset.textContent = 'VARSAYILANLARA DÖN';
  reset.onclick = () => { const name = settings.name, binds = settings.binds; Object.assign(settings, DEFAULTS, { name, binds, xh: { ...XH_DEFAULT } }); saveSettings(); buildSettingsPanel(root, onChange); for (const k of Object.keys(DEFAULTS)) onChange(k); };
  root.appendChild(reset);
}

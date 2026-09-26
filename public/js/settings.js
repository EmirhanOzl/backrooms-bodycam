// Persistent player settings + the tabbed settings panel (shared by the main menu and the pause menu).
const KEY = 'brbc2';

// rebindable actions: [id, label, default key code]
export const ACTIONS = [
  ['forward', 'İleri', 'KeyW'], ['back', 'Geri', 'KeyS'], ['left', 'Sola', 'KeyA'], ['right', 'Sağa', 'KeyD'],
  ['sprint', 'Koş · dürbünde nefes tut', 'ShiftLeft'], ['crouch', 'Çömel', 'KeyC'], ['jump', 'Zıpla', 'Space'],
  ['leanL', 'Sola eğil', 'KeyQ'], ['leanR', 'Sağa eğil', 'KeyE'], ['reload', 'Şarjör değiştir', 'KeyR'],
  ['mode', 'Atış modu', 'KeyB'], ['nade', 'El bombası (basılı tut: beklet)', 'KeyG'], ['use', 'Kutu aç · silah al', 'KeyF'],
  ['flash', 'Fener', 'KeyT'], ['inspect', 'Silahı incele', 'KeyV'], ['slot1', 'Birincil silah', 'Digit1'],
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

export const DEFAULTS = {
  name: 'Gezgin', sens: 1, adsSens: 1, invertY: false, holdAds: true, holdCrouch: true, xhair: true, hitmarks: true,
  quality: 1, fov: 80, lens: 1, shake: 1, blur: true, bright: 1, fps: false,
  master: 0.8, sfx: 1, amb: 0.8, ui: 0.9, hrtf: true,
  bots: 6, diff: 1, frags: 20, time: 10, mode: 'ffa',
  binds: DEFAULT_BINDS,
};

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem('brbc') || '{}'); } catch { /* private mode */ }
  if (saved.vol != null && saved.master == null) saved.master = saved.vol;
  const s = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (saved[k] != null && typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
  s.binds = { ...DEFAULT_BINDS, ...(saved.binds && typeof saved.binds === 'object' ? saved.binds : {}) };
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
      { k: 'invertY', label: 'Y eksenini ters çevir', type: 'check' },
      { k: 'holdAds', label: 'Nişan alma (sağ tık)', type: 'select', opts: [[true, 'Basılı tut'], [false, 'Aç / kapat']] },
      { k: 'holdCrouch', label: 'Çömelme', type: 'select', opts: [[true, 'Basılı tut'], [false, 'Aç / kapat']] },
      { k: 'xhair', label: 'Nişangah noktası', type: 'check' },
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
  { tab: 'KONTROLLER', controls: true },
];

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
  reset.onclick = () => { const name = settings.name, binds = settings.binds; Object.assign(settings, DEFAULTS, { name, binds }); saveSettings(); buildSettingsPanel(root, onChange); for (const k of Object.keys(DEFAULTS)) onChange(k); };
  root.appendChild(reset);
}

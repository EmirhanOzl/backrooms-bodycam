// Persistent player settings + the tabbed settings panel (shared by the main menu and the pause menu).
const KEY = 'brbc2';

export const DEFAULTS = {
  name: 'Gezgin', sens: 1, adsSens: 1, invertY: false, holdAds: true, holdCrouch: true, xhair: true, hitmarks: true,
  quality: 1, fov: 80, lens: 1, shake: 1, blur: true, bright: 1, fps: false,
  master: 0.8, sfx: 1, amb: 0.8, ui: 0.9, hrtf: true,
  bots: 6, diff: 1, frags: 20, time: 10,
};

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem('brbc') || '{}'); } catch { /* private mode */ }
  if (saved.vol != null && saved.master == null) saved.master = saved.vol;
  const s = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (saved[k] != null && typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
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
  {
    tab: 'KONTROLLER', keys: [
      ['W A S D', 'Hareket'], ['SHIFT', 'Koş · dürbünde nefes tut'], ['CTRL / C', 'Çömel'], ['Q / E', 'Sola / sağa eğil'], ['SPACE', 'Zıpla'],
      ['SOL TIK', 'Ateş · bıçak: hafif saldırı'], ['SAĞ TIK', 'Nişan al · bıçak: ağır saplama'], ['R', 'Şarjör değiştir'], ['B', 'Atış modu (otomatik / 3\'lü / tek)'],
      ['G veya 4', 'El bombası (basılı tut: pimi çekip beklet)'], ['F', 'Kutu aç · yerdeki silahı al'], ['T', 'Fener'], ['V', 'Silahı incele'],
      ['1 / 2 / 3', 'Birincil / ikincil / bıçak'], ['TEKERLEK', 'Silah değiştir'], ['TAB', 'Skor tablosu'], ['ESC', 'Duraklat'],
    ],
  },
];

export function controlsTable() {
  const sec = SCHEMA.find((x) => x.keys);
  return '<table class="keys">' + sec.keys.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('') + '</table>';
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
    if (sec.keys) {
      page.innerHTML = '<table class="keys">' + sec.keys.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('') + '</table>';
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
  reset.onclick = () => { const name = settings.name; Object.assign(settings, DEFAULTS, { name }); saveSettings(); buildSettingsPanel(root, onChange); for (const k of Object.keys(DEFAULTS)) onChange(k); };
  root.appendChild(reset);
}

// Lifetime player record (local only) + loading-screen tips.
import { WEAPONS, GRENADE } from './shared/weapons.js';

const KEY = 'brbc_career';
const blank = () => ({ matches: 0, wins: 0, kills: 0, deaths: 0, hs: 0, backstabs: 0, best: 0, accSum: 0, accN: 0, time: 0, byWeapon: {} });

function load() {
  try { return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return blank(); }
}
export const career = load();
let dirty = false;
export function saveCareer(force = false) {
  if (!dirty && !force) return;
  dirty = false;
  try { localStorage.setItem(KEY, JSON.stringify(career)); } catch { /* private mode */ }
}
export function recordKill(weapon, zone) {
  career.kills++;
  if (zone === 'h') career.hs++;
  if (zone === 'back') career.backstabs++;
  career.byWeapon[weapon] = (career.byWeapon[weapon] || 0) + 1;
  dirty = true;
}
export function recordDeath() { career.deaths++; dirty = true; }
export function recordMatch(won, row) {
  career.matches++;
  if (won) career.wins++;
  if (row) { career.best = Math.max(career.best, row.best || 0); if (row.acc != null) { career.accSum += row.acc; career.accN++; } }
  dirty = true;
  saveCareer();
}
export function addTime(dt) { career.time += dt; dirty = true; }

export function careerHtml() {
  const c = career;
  const kd = c.deaths ? (c.kills / c.deaths).toFixed(2) : c.kills.toFixed(2);
  const fav = Object.entries(c.byWeapon).sort((a, b) => b[1] - a[1])[0];
  const favName = fav ? (fav[0] === 'nade' ? GRENADE.label : WEAPONS[fav[0]]?.label || fav[0]) : '—';
  const h = Math.floor(c.time / 3600), m = Math.floor((c.time % 3600) / 60);
  const cell = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  return `<div class="stats">
    ${cell(c.matches, 'MAÇ')}${cell(c.matches ? Math.round((c.wins / c.matches) * 100) + '%' : '—', 'GALİBİYET')}
    ${cell(c.kills, 'LEŞ')}${cell(c.deaths, 'ÖLÜM')}${cell(kd, 'L/Ö ORANI')}
    ${cell(c.kills ? Math.round((c.hs / c.kills) * 100) + '%' : '—', 'KAFADAN')}${cell(c.accN ? Math.round(c.accSum / c.accN) + '%' : '—', 'İSABET')}
    ${cell(c.best, 'EN İYİ SERİ')}${cell(c.backstabs, 'SIRTTAN')}${cell(h ? `${h}s ${m}d` : `${m} dk`, 'SÜRE')}
  </div><p class="desc small">En çok leş aldığın silah: <b>${favName}</b>${fav ? ` (${fav[1]})` : ''}</p>`;
}
export function resetCareer() { Object.assign(career, blank()); saveCareer(true); }

export const TIPS = [
  'Sırttan bıçaklama tek vuruşta öldürür — koşarken ayak sesin duyulur, çömelerek yaklaş.',
  'Doluyken şarjör değiştirmek namludaki mermiyi korur ve daha hızlıdır.',
  'El bombasını basılı tutarak beklet; kaçacak zaman bırakma. Ama 3.4 saniyeyi geçirirsen elinde patlar.',
  'Feneri açık olan operatör karanlıkta çok uzaktan görünür.',
  'Kulaklık tak ve 3D sesi aç: adımlardan ve şarjör seslerinden düşmanın yerini bulabilirsin.',
  'Duvarların arkasından gelen sesler boğuktur; net duyuyorsan görüş hattındadır.',
  'Pompalı doldururken ateşe basarsan o anki fişekten sonra doldurma durur.',
  'R700 ile dürbündeyken Shift\'e basılı tutarak nefesini tut; titreme azalır.',
  'Eğilmek (Q/E) köşeden bakarken vücudunun çoğunu saklar.',
  'Zırh plakası yalnızca gövdeyi korur; kafaya ve bacaklara gelen isabetler tam işler.',
  'Ölen operatörlerin silahları yerde 45 saniye kalır — daha iyisini bulduysan değiştir.',
  'M4A1\'de B tuşuyla 3\'lü atışa geç: uzak mesafede tepme çok daha kontrollü.',
  'Koşmak nefesini tüketir; nefesin biterse bir süre koşamazsın.',
  'Botlar da kutuları açar ve bombalardan kaçar. Bomba uyarısı görürsen sen de kaç.',
  'Ayarlardan bodycam lens efektini azaltabilirsin; baş dönmesi yaşarsan işe yarar.',
];
export const randomTip = () => TIPS[(Math.random() * TIPS.length) | 0];

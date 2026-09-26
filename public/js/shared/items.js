// Loot items, money, the vending-machine shop and weapon attachments (server + client).
// Everything that comes out of a crate, a body or a vending machine is a physical item on the carpet:
// weapons are taken with the use key, the rest is collected by walking over it when it is useful.
import { WEAPONS } from './weapons.js';

// k → pickup data. `v` is the amount (health / armor / money).
export const ITEMS = {
  weapon: { label: '', expire: 45 },
  ammo: { label: 'MERMİ KUTUSU', expire: 40 },
  med: { label: 'İLK YARDIM', v: 50, expire: 40 },
  water: { label: 'BADEM SUYU', v: 25, expire: 40 },
  armor: { label: 'ZIRH PLAKASI', v: 50, expire: 40 },
  nade: { label: 'M67 EL BOMBASI', expire: 40 },
  cash: { label: 'PARA', expire: 45 },
};

// ---- attachments (bit flags, stored per weapon) ----
export const ATT = { SUP: 1, EXT: 2, LAS: 4 };
export const ATTACHMENTS = [
  { bit: ATT.SUP, key: 'sup', label: 'SUSTURUCU', desc: 'sessiz atış, alev yok · menzilde hafif hasar kaybı', fits: ['pistol', 'smg', 'rifle', 'm4', 'sniper'] },
  { bit: ATT.EXT, key: 'ext', label: 'UZATILMIŞ ŞARJÖR', desc: 'daha çok mermi · biraz daha yavaş şarjör değişimi', fits: ['pistol', 'smg', 'shotgun', 'rifle', 'm4', 'sniper'] },
  { bit: ATT.LAS, key: 'las', label: 'LAZER', desc: 'belden atışta çok daha isabetli · ışını herkes görür', fits: ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'm4', 'sniper'] },
];
const EXT_MAG = { pistol: 33, smg: 40, shotgun: 8, rifle: 45, m4: 40, sniper: 10 };
export const fitsAtt = (w, bit) => !!ATTACHMENTS.find((a) => a.bit === bit)?.fits.includes(w);
export const magSize = (w, a = 0) => (a & ATT.EXT && EXT_MAG[w] ? EXT_MAG[w] : WEAPONS[w].mag);
export const reloadMul = (a = 0) => (a & ATT.EXT ? 1.12 : 1);
export const SUP_DMG = 0.93;      // suppressed rounds lose a little energy
export const LASER_SPREAD = 0.55; // hip-fire cone with a laser
export const shotNoise = (a = 0) => (a & ATT.SUP ? 9 : 30);

// ---- money ----
export const ECON = { kill: 100, deathLoss: 0.25, crateCash: [15, 45] };
// style bonuses paid on a kill: [label, amount]
export const BONUS = {
  head: ['KAFADAN', 50],
  back: ['SIRTTAN BIÇAK', 100],
  knife: ['BIÇAKLA', 50],
  nade: ['UÇURDU', 40],
  long: ['UZAK ATIŞ', 50],
  air: ['HAVADA', 75],
  noscope: ['DÜRBÜNSÜZ', 75],
  multi: ['ÇOKLU LEŞ', 50],
  revenge: ['İNTİKAM', 60],
  first: ['İLK KAN', 75],
  ender: ['SERİ BİTİRİCİ', 75],
  clutch: ['SON NEFES', 40],
};

// ---- vending machine ("almond water" machines left around the level) ----
export const SHOP = [
  { id: 'water', k: 'water', label: 'Badem suyu', note: '+25 sağlık', price: 25 },
  { id: 'med', k: 'med', label: 'İlk yardım', note: '+50 sağlık', price: 60 },
  { id: 'armor', k: 'armor', label: 'Zırh plakası', note: '+50 zırh', price: 75 },
  { id: 'ammo', k: 'ammo', label: 'Mermi kutusu', note: 'yedek mermi', price: 35 },
  { id: 'nade', k: 'nade', label: 'M67 el bombası', note: `en fazla 2`, price: 60 },
  { id: 'revolver', k: 'weapon', w: 'revolver', price: 110 },
  { id: 'smg', k: 'weapon', w: 'smg', price: 180 },
  { id: 'shotgun', k: 'weapon', w: 'shotgun', price: 200 },
  { id: 'rifle', k: 'weapon', w: 'rifle', price: 250 },
  { id: 'm4', k: 'weapon', w: 'm4', price: 270 },
  { id: 'sniper', k: 'weapon', w: 'sniper', price: 300 },
  { id: 'sup', k: 'att', a: ATT.SUP, price: 150 },
  { id: 'ext', k: 'att', a: ATT.EXT, price: 120 },
  { id: 'las', k: 'att', a: ATT.LAS, price: 90 },
];
const KIND = { revolver: 'toplu tabanca', smg: 'hafif makineli', shotgun: 'pompalı', rifle: 'piyade tüfeği', m4: 'karabina', sniper: 'keskin nişancı' };
for (const s of SHOP) {
  if (s.k === 'weapon') { s.label = WEAPONS[s.w].short; s.note = KIND[s.w]; }
  if (s.k === 'att') { const A = ATTACHMENTS.find((a) => a.bit === s.a); s.label = A.label[0] + A.label.slice(1).toLocaleLowerCase('tr'); s.note = 'silaha takılır'; }
}
export const VENDOR_R = 1.9; // how close you must stand to use a machine

// ---- crate contents ----
// Rough weapon preference (bots pick up / keep the better one).
export const WEAPON_RANK = { pistol: 1, revolver: 2, smg: 3, shotgun: 3, sniper: 3, rifle: 4, m4: 4 };
const LOOT_WEAPONS = [['smg', 22], ['shotgun', 18], ['rifle', 16], ['m4', 16], ['revolver', 16], ['sniper', 9]];
const LOOT_TOTAL = LOOT_WEAPONS.reduce((s, [, w]) => s + w, 0);

export function rollLoot(R = Math.random) {
  const r = R();
  if (r < 0.34) {
    let x = R() * LOOT_TOTAL;
    for (const [w, wt] of LOOT_WEAPONS) { if ((x -= wt) < 0) return { k: 'weapon', w, a: R() < 0.2 ? ATTACHMENTS[(R() * 3) | 0].bit & attMask(w) : 0 }; }
  }
  if (r < 0.56) return { k: 'ammo' };
  if (r < 0.67) return { k: 'nade' };
  if (r < 0.77) return { k: 'med', v: ITEMS.med.v };
  if (r < 0.86) return { k: 'water', v: ITEMS.water.v };
  return { k: 'armor', v: ITEMS.armor.v };
}
const attMask = (w) => ATTACHMENTS.reduce((m, a) => (a.fits.includes(w) ? m | a.bit : m), 0);

// one main item, usually some money, sometimes a spare ammo box
export function crateLoot(R = Math.random) {
  const out = [rollLoot(R)];
  if (R() < 0.65) out.push({ k: 'cash', v: Math.round(ECON.crateCash[0] + R() * (ECON.crateCash[1] - ECON.crateCash[0])) });
  if (R() < 0.25 && out[0].k !== 'ammo') out.push({ k: 'ammo' });
  return out;
}

export function itemLabel(it) {
  if (it.k === 'weapon') return WEAPONS[it.w].label;
  if (it.k === 'cash') return `$${it.v}`;
  return ITEMS[it.k].label;
}

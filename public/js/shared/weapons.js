// Shared weapon stats. spread values are radians (cone half-angle).
// Balance (100 HP), point-blank body shots-to-kill: G17 4, .357 2, MP5 5, AK 4, M4 4, M870 one full blast, R700 2 (head 1).
// Legs deal 75%. Armor plates only cover the torso. slot: 'primary' | 'secondary' | 'melee'.
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle', 'revolver', 'm4', 'sniper', 'knife'];
export const SLOTS = ['primary', 'secondary', 'melee'];
export const LEG_MUL = 0.75;

export const WEAPONS = {
  pistol: {
    label: 'G17 TABANCA', short: 'G17', slot: 'secondary', dmg: 25, head: 2.3, rpm: 420, auto: false, mag: 17, reserve: 51, maxReserve: 119,
    reload: 1.45, spread: 0.018, adsSpread: 0.004, moveSpread: 0.022, recoil: 0.03, hRecoil: 0.008, pellets: 1,
    range: 70, fs: 12, fe: 40, minMul: 0.6, moveMul: 1.0, chamber: true,
  },
  revolver: {
    label: '.357 TOPLU TABANCA', short: '.357', slot: 'secondary', dmg: 52, head: 2.1, rpm: 150, auto: false, mag: 6, reserve: 18, maxReserve: 42,
    reload: 2.7, spread: 0.02, adsSpread: 0.003, moveSpread: 0.03, recoil: 0.075, hRecoil: 0.016, pellets: 1,
    range: 75, fs: 15, fe: 45, minMul: 0.7, moveMul: 1.0, chamber: false,
  },
  smg: {
    label: 'MP5 HAFİF MAKİNELİ', short: 'MP5', slot: 'primary', dmg: 20, head: 2.0, rpm: 800, auto: true, mag: 30, reserve: 60, maxReserve: 210,
    reload: 2.1, spread: 0.032, adsSpread: 0.01, moveSpread: 0.02, recoil: 0.016, hRecoil: 0.009, pellets: 1,
    range: 60, fs: 10, fe: 30, minMul: 0.55, moveMul: 0.97, chamber: true,
  },
  shotgun: {
    label: 'M870 POMPALI', short: 'M870', slot: 'primary', dmg: 12, head: 1.6, rpm: 70, auto: false, mag: 6, reserve: 18, maxReserve: 42,
    reload: 2.8, spread: 0.07, adsSpread: 0.055, moveSpread: 0.015, recoil: 0.085, hRecoil: 0.02, pellets: 9,
    range: 35, fs: 7, fe: 20, minMul: 0.2, moveMul: 0.93, chamber: false,
  },
  rifle: {
    label: 'AK-47 PİYADE TÜFEĞİ', short: 'AK-47', slot: 'primary', dmg: 32, head: 2.4, rpm: 600, auto: true, mag: 30, reserve: 60, maxReserve: 180,
    reload: 2.5, spread: 0.03, adsSpread: 0.005, moveSpread: 0.035, recoil: 0.032, hRecoil: 0.016, pellets: 1,
    range: 95, fs: 18, fe: 55, minMul: 0.65, moveMul: 0.92, chamber: true,
  },
  m4: {
    label: 'M4A1 KARABİNA', short: 'M4A1', slot: 'primary', dmg: 27, head: 2.3, rpm: 780, auto: true, mag: 30, reserve: 60, maxReserve: 180,
    reload: 2.3, spread: 0.027, adsSpread: 0.004, moveSpread: 0.03, recoil: 0.022, hRecoil: 0.01, pellets: 1,
    range: 90, fs: 20, fe: 60, minMul: 0.65, moveMul: 0.94, chamber: true,
  },
  sniper: {
    label: 'R700 KESKİN NİŞANCI', short: 'R700', slot: 'primary', dmg: 90, head: 2.5, rpm: 42, auto: false, mag: 5, reserve: 10, maxReserve: 25,
    reload: 3.0, spread: 0.07, adsSpread: 0.0004, moveSpread: 0.05, recoil: 0.1, hRecoil: 0.012, pellets: 1,
    range: 160, fs: 60, fe: 130, minMul: 0.85, moveMul: 0.88, chamber: false, scope: true, bolt: true,
  },
  knife: {
    label: 'SAVAŞ BIÇAĞI', short: 'BIÇAK', slot: 'melee', melee: true, dmg: 40, heavy: 75, backLight: 90, backHeavy: 200,
    light: 0.42, heavyT: 0.95, range: 1.8, moveMul: 1.08,
  },
};

export function zoneMul(w, zone) { return zone === 'h' ? w.head : zone === 'l' ? LEG_MUL : 1; }

export function dmgAt(w, dist) {
  if (dist <= w.fs) return w.dmg;
  if (dist >= w.fe) return w.dmg * w.minMul;
  return w.dmg * (1 - (1 - w.minMul) * ((dist - w.fs) / (w.fe - w.fs)));
}

// Server-side melee damage: backstab = attacker is behind the target.
export function meleeDamage(heavy, back) {
  const k = WEAPONS.knife;
  return heavy ? (back ? k.backHeavy : k.heavy) : (back ? k.backLight : k.dmg);
}

const LOOT_WEAPONS = [['smg', 22], ['shotgun', 18], ['rifle', 17], ['m4', 17], ['revolver', 16], ['sniper', 8]];
const LOOT_TOTAL = LOOT_WEAPONS.reduce((s, [, w]) => s + w, 0);

export function rollLoot(R = Math.random) {
  const r = R();
  if (r < 0.36) {
    let x = R() * LOOT_TOTAL;
    for (const [w, wt] of LOOT_WEAPONS) { if ((x -= wt) < 0) return { k: 'weapon', w }; }
  }
  if (r < 0.7) return { k: 'ammo' };
  if (r < 0.87) return { k: 'med', v: 50 };
  return { k: 'armor', v: 50 };
}

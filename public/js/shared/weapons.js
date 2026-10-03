// Shared weapon stats (server + client). spread values are radians (cone half-angle).
// Balance (100 HP), point-blank body shots-to-kill: G17 4, .357 2, MP5 5, AK 3, M4 4, M870 one full blast, AWP 1.
// Legs deal 75%. Armor plates only cover the torso (and soak part of explosions).
// slot: 'primary' | 'secondary' | 'melee'.  cls drives viewmodel animation + sound families.
export const WEAPON_ORDER = ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'm4', 'sniper', 'knife'];
export const SLOTS = ['primary', 'secondary', 'melee'];
export const LEG_MUL = 0.75;
export const MAX_NADES = 2;

export const WEAPONS = {
  pistol: {
    label: 'G17 TABANCA', short: 'G17', slot: 'secondary', cls: 'pistol', dmg: 25, head: 2.3, rpm: 450, modes: ['semi'], mag: 17, reserve: 51, maxReserve: 119,
    reload: 1.45, reloadEmpty: 1.75, spread: 0.016, adsSpread: 0.004, moveSpread: 0.02, recoil: 0.03, hRecoil: 0.008, pellets: 1,
    range: 70, fs: 12, fe: 40, minMul: 0.6, moveMul: 1.0, chamber: true, draw: 0.32, adsFov: 0.8,
  },
  revolver: {
    label: '.357 TOPLU TABANCA', short: '.357', slot: 'secondary', cls: 'revolver', dmg: 52, head: 2.1, rpm: 150, modes: ['semi'], mag: 6, reserve: 18, maxReserve: 42,
    reload: 2.6, reloadEmpty: 2.6, spread: 0.02, adsSpread: 0.003, moveSpread: 0.03, recoil: 0.075, hRecoil: 0.016, pellets: 1,
    range: 75, fs: 15, fe: 45, minMul: 0.7, moveMul: 1.0, chamber: false, draw: 0.4, adsFov: 0.78,
  },
  smg: {
    label: 'MP5 HAFİF MAKİNELİ', short: 'MP5', slot: 'primary', cls: 'smg', dmg: 20, head: 2.0, rpm: 800, modes: ['auto', 'semi'], mag: 30, reserve: 90, maxReserve: 210,
    reload: 2.0, reloadEmpty: 2.45, spread: 0.028, adsSpread: 0.009, moveSpread: 0.016, recoil: 0.016, hRecoil: 0.009, pellets: 1,
    range: 60, fs: 10, fe: 30, minMul: 0.55, moveMul: 0.97, chamber: true, draw: 0.45, adsFov: 0.74,
  },
  shotgun: {
    label: 'M870 POMPALI', short: 'M870', slot: 'primary', cls: 'shotgun', dmg: 12, head: 1.6, rpm: 70, modes: ['pump'], mag: 6, reserve: 18, maxReserve: 42,
    reload: 0, reloadEmpty: 0, shell: { start: 0.42, per: 0.52, end: 0.34 }, cycle: 0.62,
    spread: 0.052, adsSpread: 0.034, moveSpread: 0.012, recoil: 0.085, hRecoil: 0.02, pellets: 9,
    range: 42, fs: 10, fe: 34, minMul: 0.45, moveMul: 0.93, chamber: false, draw: 0.55, adsFov: 0.8,
  },
  rifle: {
    label: 'AK-47 PİYADE TÜFEĞİ', short: 'AK-47', slot: 'primary', cls: 'rifle', dmg: 34, head: 2.4, rpm: 600, modes: ['auto', 'semi'], mag: 30, reserve: 60, maxReserve: 180,
    reload: 2.5, reloadEmpty: 2.95, spread: 0.025, adsSpread: 0.0028, moveSpread: 0.014, recoil: 0.034, hRecoil: 0.017, pellets: 1,
    range: 95, fs: 18, fe: 55, minMul: 0.62, moveMul: 0.92, chamber: true, draw: 0.55, adsFov: 0.72,
  },
  m4: {
    label: 'M4A1 KARABİNA', short: 'M4A1', slot: 'primary', cls: 'm4', dmg: 27, head: 2.3, rpm: 780, modes: ['auto', 'burst', 'semi'], mag: 30, reserve: 60, maxReserve: 180,
    reload: 2.3, reloadEmpty: 2.7, spread: 0.022, adsSpread: 0.002, moveSpread: 0.012, recoil: 0.022, hRecoil: 0.01, pellets: 1,
    range: 90, fs: 20, fe: 60, minMul: 0.65, moveMul: 0.94, chamber: true, draw: 0.5, adsFov: 0.64,
  },
  sniper: {
    label: 'AWP KESKİN NİŞANCI', short: 'AWP', slot: 'primary', cls: 'bolt', dmg: 250, head: 2.5, rpm: 60, modes: ['bolt'], mag: 5, reserve: 10, maxReserve: 25,
    reload: 2.9, reloadEmpty: 3.2, cycle: 0.95, spread: 0.07, adsSpread: 0.0004, moveSpread: 0.05, recoil: 0.1, hRecoil: 0.012, pellets: 1,
    // Even a suppressed max-range torso hit exceeds 100 HP plus a full 100-point plate.
    range: 160, fs: 60, fe: 130, minMul: 0.9, moveMul: 0.88, chamber: false, scope: true, draw: 0.65, adsFov: 0.2,
  },
  knife: {
    label: 'M9 SÜNGÜ', short: 'M9', slot: 'melee', cls: 'knife', melee: true, modes: ['melee'], dmg: 45, heavy: 80, backLight: 100, backHeavy: 200,
    light: 0.42, heavyT: 0.95, lightHit: 0.12, heavyHit: 0.36, range: 1.8, moveMul: 1.08, draw: 0.3, adsFov: 1,
  },
};

export const GRENADE = { label: 'M67 EL BOMBASI', short: 'M67', dmg: 135, radius: 7.5, inner: 2.0, fuse: 3.4, speed: 13 };

export const FIRE_MODE_LABEL = { auto: 'OTOMATİK', burst: '3\'LÜ ATIŞ', semi: 'TEK ATIŞ', pump: 'POMPALI', bolt: 'SÜRGÜLÜ', melee: 'YAKIN DÖVÜŞ' };

export function zoneMul(w, zone) { return zone === 'h' ? w.head : zone === 'l' ? LEG_MUL : 1; }

export function dmgAt(w, dist) {
  if (dist <= w.fs) return w.dmg;
  if (dist >= w.fe) return w.dmg * w.minMul;
  return w.dmg * (1 - (1 - w.minMul) * ((dist - w.fs) / (w.fe - w.fs)));
}

// Melee damage: backstab = attacker is behind the target.
export function meleeDamage(heavy, back) {
  const k = WEAPONS.knife;
  return heavy ? (back ? k.backHeavy : k.heavy) : (back ? k.backLight : k.dmg);
}

// Explosion damage at distance d (before armor).
export function blastDamage(d) {
  const G = GRENADE;
  if (d >= G.radius) return 0;
  if (d <= G.inner) return G.dmg;
  const k = 1 - (d - G.inner) / (G.radius - G.inner);
  return G.dmg * Math.pow(k, 1.3);
}

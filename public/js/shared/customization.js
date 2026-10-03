// Shared, serializable operator appearance. Each choice maps to a distinct procedural mesh.
const option = (id, label, description) => Object.freeze({ id, label, description });
export const APPEARANCE_OPTIONS = Object.freeze({
  head: Object.freeze([
    option('helmet', 'BALİSTİK KASK', 'Kask, gözlük ve kulak koruması'),
    option('beanie', 'SAHA BERESİ', 'Örgü bere, açık yüz ve telsiz kulaklığı'),
    option('respirator', 'SOLUNUM MASKESİ', 'Çift filtreli maske ve kapüşon'),
  ]),
  chest: Object.freeze([
    option('carrier', 'PLAKA YELEĞİ', 'Zırh plakaları, şarjör cepleri ve sırt çantası'),
    option('rig', 'HAFİF TEÇHİZAT', 'Çapraz askılar ve kompakt göğüs cepleri'),
    option('jacket', 'SAHA CEKETİ', 'Yüksek yaka, uzun etek ve omuz takviyeleri'),
  ]),
  legs: Object.freeze([
    option('tactical', 'TAKTİK PANTOLON', 'Dar paça, dizlik ve hafif bot'),
    option('cargo', 'KARGO PANTOLON', 'Bol paça, büyük yan cepler ve saha botu'),
    option('armored', 'KORUMALI BACAK', 'Uyluk plakaları, sert dizlik ve ağır bot'),
  ]),
});
export const APPEARANCE_PALETTES = Object.freeze([
  Object.freeze({ id: 'graphite', label: 'GRAFİT', color: '#39434d' }),
  Object.freeze({ id: 'olive', label: 'ZEYTİN', color: '#566044' }),
  Object.freeze({ id: 'sand', label: 'KUM', color: '#99866a' }),
  Object.freeze({ id: 'slate', label: 'ARDUVAZ', color: '#526b7c' }),
]);
export const DEFAULT_APPEARANCE = Object.freeze({ head: 'helmet', chest: 'carrier', legs: 'tactical', palette: 'graphite' });
const ids = Object.fromEntries(Object.entries(APPEARANCE_OPTIONS).map(([key, values]) => [key, new Set(values.map((v) => v.id))]));
const palettes = new Set(APPEARANCE_PALETTES.map((v) => v.id));
export function normalizeAppearance(value) {
  const v = value && typeof value === 'object' ? value : DEFAULT_APPEARANCE;
  return {
    head: ids.head.has(v.head) ? v.head : DEFAULT_APPEARANCE.head,
    chest: ids.chest.has(v.chest) ? v.chest : DEFAULT_APPEARANCE.chest,
    legs: ids.legs.has(v.legs) ? v.legs : DEFAULT_APPEARANCE.legs,
    palette: palettes.has(v.palette) ? v.palette : DEFAULT_APPEARANCE.palette,
  };
}

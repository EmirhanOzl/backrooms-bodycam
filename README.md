# BACKROOMS: BODYCAM

Backrooms Seviye 0 (sarı duvar kağıtlı, nemli halılı, floresan uğultulu labirent) haritasında geçen,
Bodycam tarzı göğüs kamerası görüntülü, tarayıcıda oynanan 3D FPS. PvP (çok oyunculu) + botlar.

## Çalıştırma

```bash
npm install
npm start
```

Tarayıcıda `http://localhost:3000` aç.

- **Çevrimdışı (botlara karşı):** Menüden bot sayısı ve zorluğu seçip `OYNA`. Sunucu gerekmez; oyun
  simülasyonu tarayıcıda çalışır, yani `public/` klasörü herhangi bir statik sunucuda da oynanır
  (ES modülleri `file://` üzerinden açılamaz, bir HTTP sunucusu şart).
- **Çok oyunculu (PvP):** `npm start` ile sunucuyu başlatınca konsolda yerel ağ adresi yazılır
  (ör. `http://192.168.1.20:3000`). Arkadaşların bu adresi açıp `SUNUCUYA KATIL` der. Oyuncu sayısı
  azsa sunucu boşlukları botlarla doldurur.

Sunucu ayarları (ortam değişkenleri): `PORT` (3000), `BOTS` (toplam katılımcı hedefi, 5), `DIFF` (0/1/2), `FRAGS` (maç leş limiti, 25).

## Kontroller

| Tuş | İşlev |
| --- | --- |
| WASD | hareket |
| Shift | koş |
| Ctrl / C | çömel (maç sırasında Ctrl+W sekmeyi kapatmadan önce onay sorulur) |
| Q / E | sola / sağa eğil (köşeden bakma) |
| Space | zıpla |
| Sol tık | ateş |
| Sağ tık | nişan al |
| R | şarjör değiştir |
| F | kutu aç |
| T | fener |
| 1-4 / tekerlek | silah değiştir |
| Tab | skor tablosu |
| Esc | duraklat |

## Oynanış

- Herkes G17 tabancayla doğar. Yerdeki tahta kutular (F) rastgele **silah** (MP5, M870, AK-47),
  **mermi**, **ilk yardım** (+50 can) veya **zırh plakası** (+50 zırh) verir; kutular 40 sn sonra yeniden dolar.
- Serbest-herkese-karşı deathmatch; leş limitine ulaşan maçı kazanır, ardından **yeni üretilmiş bir seviyede** yeni maç başlar.
- Bazı bölgelerde floresanlar bozuk: karanlık alanlarda fener (T) şart, ama feneri açık olan daha uzaktan görülür.
- İsabet bölgeleri: kafa ×2–2.4 (silaha göre), gövde ×1, bacak ×0.75. Zırh plakası sadece gövdeyi korur
  (gövde hasarının yarısını emer). Mesafe arttıkça hasar düşer; çömelmek sekmeyi, eğilmek hedef alanını azaltır.
- Vuruş işaretleri: beyaz = gövde/bacak, sarı = kafa, mavi = zırha isabet, kırmızı = öldürme (her birinin sesi farklı).
- Sesler duvar arkasından boğuk gelir; ayak seslerinden ve yakından geçen mermilerin vızıltısından düşmanın yerini kestirebilirsin.
  Kafadan yara alınca kulak çınlar ve ses kısa süre boğuklaşır.

## Teknik

- `server.js` — statik dosya sunucusu + WebSocket (`/ws`), 30 Hz yetkili simülasyon.
- `public/js/shared/` — sunucu ve istemcinin ortak kodu: harita üretimi (tohumlu), ışın izleme, çarpışma,
  yol bulma (`map.js`), silah verileri (`weapons.js`), oyun çekirdeği ve bot yapay zekası (`core.js`).
- `public/js/world.js` — harita geometrisi; floresan ışıkları görünürlük testli olarak halıya (ışık haritası)
  ve duvarlara (köşe başına) önceden "pişirilir", böylece yüzlerce ışık gerçek zamanlı ışık maliyeti olmadan çizilir.
- `public/js/post.js` — bodycam lensi: HDR, bloom, balık gözü bozulması, kromatik sapma, dönüş bulanıklığı, gren, vinyet.
- `public/js/models.js` — prosedürel silah modelleri (profil ekstrüzyonu), eldivenli kollar, operatör modelleri.
- `public/js/audio.js` — tamamen sentezlenmiş ses: floresan uğultusu, yankılı silah sesleri, 3D ayak sesleri.
- Harici model/doku/ses dosyası yok; her şey kodla üretilir. Tek bağımlılıklar `three` ve `ws`.

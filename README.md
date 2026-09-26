# BACKROOMS: BODYCAM

Backrooms Seviye 0 (sarı duvar kağıtlı, nemli halılı, floresan uğultulu labirent) haritasında geçen,
göğüs kamerası (bodycam) görüntülü, tarayıcıda oynanan taktiksel 3D FPS. Botlara karşı çevrimdışı veya
yerel ağda PvP. Harita her maçta tohumdan yeniden üretilir; model, doku ve seslerin hepsi kodla üretilir.

## Çalıştırma

```bash
npm install
npm start          # http://localhost:3000
npm test           # ortak oyun çekirdeğinin testleri (botlarla tam maç simülasyonu dahil)
```

- **Çevrimdışı (botlara karşı):** Menüden mod (herkes herkese / takım çatışması), ışıklandırma (normal / loş / karartma),
  bot sayısı, zorluk, skor limiti ve süreyi seçip `OYNA`.
  Çevrimdışı maç ESC ile duraklatılınca (veya sekme arka plana geçince) gerçekten durur.
  Maç simülasyonu tarayıcıda ayrı bir Web Worker'da çalışır; `public/` klasörü herhangi bir statik
  sunucuda da oynanır (ES modülleri `file://` üzerinden açılamaz, bir HTTP sunucusu şart).
- **Çok oyunculu (PvP):** `npm start` konsolda yerel ağ adresini yazar (ör. `http://192.168.1.20:3000`).
  Arkadaşların bu adresi açıp `ÇOK OYUNCULU → SUNUCUYA KATIL` der. Boş yerleri botlar doldurur.

Sunucu ayarları (ortam değişkenleri): `PORT` (3000), `BOTS` (toplam katılımcı hedefi, 5), `DIFF` (0/1/2),
`FRAGS` (leş / takım skor limiti, 25), `TIME` (maç süresi, saniye, 600), `MODE` (`ffa` veya `tdm`),
`LIGHT` (`normal`, `dim` veya `dark`).

## Kontroller

Tüm tuşlar `KONTROLLER` menüsünden (veya oyun içi ayarlardan) yeniden atanabilir: eyleme tıkla, yeni tuşa bas.
Aşağıdakiler varsayılanlardır.

| Tuş | İşlev |
| --- | --- |
| WASD | hareket |
| Shift | koş (nefes/dayanıklılık harcar) · dürbündeyken nefes tut |
| Ctrl / C | çömel (basılı tut veya aç/kapat — ayarlardan) |
| Q / E | sola / sağa eğil (köşeden bakma) |
| Space | zıpla |
| Sol tık | ateş · bıçakta hafif saldırı |
| Sağ tık | nişan al · bıçakta ağır saplama |
| R | şarjör değiştir |
| B | atış modu (otomatik / 3'lü / tek atış) |
| G veya 4 | el bombası — basılı tut: pimi çek ve beklet (pişir), bırak: at |
| F | kutu aç · yerdeki silahı al / değiştir |
| T | fener |
| V | silahı incele |
| 1 / 2 / 3, tekerlek | birincil / ikincil / bıçak |
| Tab | skor tablosu |
| Esc | duraklat (ayarlar oyun içinden de değişir) |

## Silahlar

| Silah | Yuva | Özellik |
| --- | --- | --- |
| G17 tabanca | ikincil | herkes bununla doğar; boşalınca sürgü açık kalır |
| .357 toplu tabanca | ikincil | 2 gövde vuruşu; topluluğu açılıp hızlı doldurucuyla dolar |
| MP5 | birincil | otomatik/tek; yüksek atış hızı, kontrollü tepme |
| M870 pompalı | birincil | 9 saçma; fişek fişek doldurma (ateşe basınca durur), her atıştan sonra pompa |
| AK-47 | birincil | otomatik/tek; 3 vuruşta öldürür, sert tepme |
| M4A1 | birincil | otomatik/3'lü/tek; kırmızı noktalı nişangah |
| R700 | birincil | sürgülü, dürbünlü; nefes tutma (Shift), zırhsız gövdeye tek vuruş |
| Savaş bıçağı | yakın dövüş | hafif / ağır saldırı; **sırttan bıçaklama tek vuruşta öldürür** |
| M67 el bombası | — | seker, yuvarlanır; duvar arkasına hasar vermez; bekletilebilir (elde patlayabilir!) |

- Doluyken şarjör değiştirmek namludaki mermiyi korur (30+1); boş şarjör değişimi daha uzun sürer (kurma kolu).
- Kutular (F) rastgele silah, mermi, el bombası, ilk yardım (+50) veya zırh plakası (+50) verir; 40 sn sonra yeniden dolar.
  O yuvada zaten silahın varsa yeni silah kutunun yanına yere bırakılır — istersen F ile değiştirirsin.
- Ölen operatörün silahı yere düşer; 45 sn boyunca alınabilir.

## Oynanış

- **Herkes herkese (FFA):** leş limitine ulaşan ya da süre bitince önde olan kazanır.
- **Takım çatışması (TDM):** MAVİ ve KIRMIZI takımlar; dost ateşi yok, takım arkadaşlarının başında mavi işaret görünür,
  takım skoru limitine ulaşan takım kazanır. Botlar iki takımı eşit tutacak şekilde dağılır.
- Maç sonunda isabet, kafadan vuruş, en iyi seri ve verilen hasarı gösteren rapor çıkar; ardından
  **yeni üretilmiş bir seviyede** yeni maç başlar.
- `PROFİL` menüsü yerel kariyer kaydını tutar: maç, galibiyet oranı, leş/ölüm, kafadan oranı, isabet, en iyi seri, en sevdiğin silah.
- İsabet bölgeleri: kafa ×2–2.5 (silaha göre), gövde ×1, bacak ×0.75. Zırh plakası sadece gövdeyi korur
  (gövde hasarının yarısını, patlamanın %35'ini emer). Mesafe arttıkça hasar düşer; çömelmek sekmeyi, eğilmek hedef alanını azaltır.
- Vuruş işaretleri anında gelir: beyaz = gövde/bacak, sarı = kafa, mavi = zırh, kırmızı = öldürme (her birinin sesi farklı).
- Seriler: ÇİFTE LEŞ, ÜÇLÜ LEŞ, DURDURULAMAZ…
- Bazı bölgelerde floresanlar bozuk: karanlıkta fener (T) şart, ama feneri açık olan daha uzaktan görülür.
  **Karartma** ışıklandırmasında floresanların çoğu sönüktür: botlar karanlıkta fenerlerini açar, fenersiz ve karanlıktaki
  bir hedefi ancak yakından fark eder — fenerini kapatıp pusu kurabilir, ya da düşmanın feneri seni ele vermeden onu görebilirsin.
- Sesler duvar arkasından boğuk gelir; ayak seslerinden, şarjör değiştiren düşmanların sesinden ve yakından geçen
  mermilerin vızıltısından yön bulabilirsin (kulaklıkla HRTF 3D ses önerilir). Yakın patlama kulağı çınlatır.
- Doğduktan sonra 2 sn koruma vardır (ateş edince biter).

## Ayarlar

Oyun (isim, fare ve nişan/dürbün hassasiyeti, Y ekseni, nişan/çömelme basılı tut ↔ aç/kapat, nişangah, vuruş
işaretleri), Görüntü (kalite, FOV, **bodycam lens efekti yoğunluğu** — baş dönmesi yaşayanlar için, kamera sarsıntısı,
hareket bulanıklığı, parlaklık, FPS göstergesi), Ses (ana, efekt, ortam, arayüz, HRTF). Tarayıcıda saklanır.

## Teknik

- `server.js` — statik dosya sunucusu + WebSocket (`/ws`), 30 Hz yetkili simülasyon.
- `public/js/shared/` — sunucu ve istemcinin ortak kodu: harita üretimi, ışın izleme, çarpışma, yol bulma (`map.js`),
  silah verileri (`weapons.js`), deterministik el bombası fiziği (`physics.js`), oyun çekirdeği ve bot yapay zekası (`core.js`:
  envanter yuvaları, bıçak, el bombası, yere düşen silahlar, maç süresi/istatistikler; botlar kutu açar, silah toplar,
  bıçak kullanır, el bombası atar ve bombalardan kaçar).
- `public/js/main.js` — istemci: hareket, atış (kare hızından bağımsız atış ritmi), durum makineleri (şarjör, fişek fişek
  doldurma, pompa/sürgü, bıçak, el bombası), anında vuruş geri bildirimi, anlık görüntü enterpolasyonu (uzak oyuncular 100 ms
  geriden, pürüzsüz çizilir), menü arka planındaki canlı seviye.
- `public/js/viewmodel.js` — birinci şahıs silah: yay tabanlı geri tepme ve anahtar kareli prosedürel animasyonlar;
  animasyon olayları sesleri ve oyun mantığını (şarjör yerine oturunca mermi eklenir vb.) zamanlar.
- `public/js/sfx.js` + `sfx-worker.js` — tüm ses efektleri açılışta Web Worker'larda saf JS DSP ile bir kez sentezlenir
  (silah başına yakın/uzak/birinci şahıs varyantları, darbe, adım, mekanik parçalar, ortam).
- `public/js/audio.js` — ses motoru: hazır tamponlar, kategori başına ses sınırı (en eski ses çalınır), efekt/ortam/arayüz
  kanalları, ortak yankı (convolver), duvar arkası boğuklaştırma, HRTF, limitör. Uzak atışlar sunucu zaman damgasıyla
  ses saatine planlanır → takılma yok, tam otomatik ritim düzgün.
- `public/js/world.js` — harita geometrisi; floresan ışıkları görünürlük testli olarak halıya (ışık haritası) ve duvarlara pişirilir.
- `public/js/post.js` — bodycam lensi: HDR, bloom, balık gözü, kromatik sapma, dönüş bulanıklığı, gren, vinyet, dürbün.
- `public/js/models.js` — prosedürel silah modelleri (hareketli şarjör/sürgü/pompa/topluluk/sürgü kolu), eldivenli kollar,
  operatör modelleri (yönlü ölüm animasyonu).
- `public/js/effects.js` — parçacıklar, kurşun deliği / kan / yanık izleri, iz mermileri, namlu alevi, kovanlar, toz zerrecikleri.
- Tek bağımlılıklar `three` ve `ws`.

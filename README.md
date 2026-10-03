# BACKROOMS: BODYCAM

Göğüs kamerası (bodycam) görüntülü, tarayıcıda oynanan taktiksel 3D FPS: Backrooms Seviye 0,
kompakt M.E.G. Deposu arenası ve karanlık Derin Labirent. Botlara karşı çevrimdışı veya yerel ağda/internette
çok oyunculu çatışma ve asimetrik kaçış. Haritalar, modeller, dokular ve sesler kodla üretilir.

## 1.3.0 — oynanış ve kaçış güncellemesi

- M870'nin hasarı 10 m'ye kadar tamdır; 34 m'ye kadar yumuşakça %45'e düşer. Saçma konisi de daraltıldı.
  AK/M4 nişan dağılımı ve hareket/seri atış yayılması azaltıldı. AWP, korumasız rakibi zırhına ve isabet bölgesine
  bakmadan tek geçerli isabetle öldürür; susturucuyla da bu kural geçerlidir.
- Botlar yaralıyken, doldururken veya sayıca az kaldıklarında görüşü kesen siper arar; boş yere bıçakla hücum etmez.
- Fenerler gerçek gölge haritalarıyla duvarlar ve karakterler tarafından engellenir. Sahte ışık konisi kaldırıldı;
  kan lekeleri gerçek yüzeye oturur ve yüzey sınırına sığar. Geri tepme, mekanik silah parçaları ve isabet geri bildirimi geliştirildi.
- Dayanıklılık **300**, tam koşu kapasitesi **19,5 sn**; zıplama yaklaşık **0,9 m**. Kasa üstünde durma,
  kısa zıplama tamponu/coyote süresi ve **Space basılı + havada yön vererek bunny** desteklenir; hız 8,2 m/sn ile sınırlıdır.
- `OPERATÖR TASARLA`: kafa, göğüs ve bacakta üçer seçenek, dört renk; canlı 3D önizleme, kalıcı kayıt ve ağ üzerinden görünüm aktarımı.
- Halı/beton adımları, silah mekanikleri ve kısa mekâna uygun yankılar yeniden işlendi. Yürüme yaklaşık 18 m,
  koşu 27 m, çömelme 6 m duyulabilir; duvarlar sesin seviyesini ve tizlerini düşürür. HRTF ile yön takip edilir.


## Çalıştırma

```bash
npm install
npm start          # http://localhost:3000
npm test           # oyun çekirdeği + sunucu testleri (botlarla tam maç simülasyonu dahil)
npm run desktop    # masaüstü (Electron) sürümü
npm run e2e        # gerçek tarayıcıda uçtan uca duman testi (bir kez: npx playwright install chromium)
```

- **Çevrimdışı (botlara karşı):** Menüden mod (FFA / takım çatışması / karanlıktan kaçış), harita, ışıklandırma,
  bot sayısı, zorluk, skor limiti ve süreyi seçip `OYNA`. `5v5 ARENA HAZIRLA` depo/TDM/9 bot ayarını seçer.
  Çevrimdışı maç ESC ile duraklatılınca (veya sekme arka plana geçince) gerçekten durur.
  Maç simülasyonu tarayıcıda ayrı bir Web Worker'da çalışır; `public/` klasörü herhangi bir statik
  sunucuda da oynanır (ES modülleri `file://` üzerinden açılamaz, bir HTTP sunucusu şart).
- **Çok oyunculu (PvP):** `npm start` konsolda yerel ağ adresini yazar (ör. `http://192.168.1.20:3000`).
  İlk katılan oyuncu `ÇOK OYUNCULU` menüsünden mod, harita, ışıklandırma ve 0–10 bot seçip `SUNUCUYA KATIL` der.
  Sonradan katılanlar mevcut maç ayarlarını değiştirmez. Herkes ayrılınca yeni seçim yapılabilir.

- **Masaüstü sürümü (Steam / itch.io için):** `npm run desktop` — Electron penceresinde tam ekran açılır (F11 pencere
  modu), oyun sunucusu uygulamanın içinde çalışır: tek oyunculu oynarken aynı anda yerel ağda host olursun, adres
  `ÇOK OYUNCULU` panelinde görünür. Arka planda kısılma yoktur; `ÇIKIŞ` menüden kapatır. (`desktop/` klasörü kendi
  `package.json`'ına sahiptir; tarayıcı sürümü Electron indirmez.)

Sunucu ayarları (ortam değişkenleri): `PORT` (3000), `BOTS` (ilk seçimden önce toplam katılımcı hedefi, 5),
`DIFF` (0/1/2), `FRAGS` (leş / takım skor limiti, 25), `TIME` (saniye, 600),
`MODE` (`ffa`, `tdm`, `escape`), `LAYOUT` (`maze`, `arena`, `escape`), `LIGHT` (`normal`, `dim`, `dark`).
Kaçış modu karanlık labirenti zorunlu seçer; depo/TDM toplam 10 katılımcıyla sınırlıdır.

### İnternette arkadaşlarla ücretsiz oynama (Render)

Bu proje hem web sayfasını hem de çok oyunculu oyunu aynı Node sunucusunda çalıştırır. Yalnızca statik site
olarak yayımlamak çok oyunculu bağlantıyı çalıştırmaz. Kök dizindeki `render.yaml`, ücretsiz Web Service
ayarlarını içerir; oyun ve masaüstü sürümünün yerel ayarlarını değiştirmez.

1. Bu dalı GitHub'a gönder. Depo özel kalabilir; Render'a yalnızca bu depoya erişim ver.
2. [Render](https://dashboard.render.com/)'da **New → Blueprint** seç, GitHub deposunu ve `render.yaml` dosyasının
   bulunduğu dalı bağla. Oluşturulacak hizmetin **Free** planında olduğunu kontrol et.
3. İlk dağıtım tamamlanınca hizmetin verdiği `https://…onrender.com` adresini aç. `ÇOK OYUNCULU` panelinde
   **Sunucu aktif** yazısını gör ve `SUNUCUYA KATIL` ile dene.
4. Aynı `https://…onrender.com` adresini Discord'da arkadaşlarınla paylaş. Herkes aynı adresi açıp
   `ÇOK OYUNCULU → SUNUCUYA KATIL` seçer; tek ortak maça katılır.

Ücretsiz hizmet 15 dakika bağlantı/istek gelmezse uyur; ilk açılış yaklaşık bir dakika sürebilir. Hizmet
yeniden başlarsa mevcut maç ve bağlantılar sıfırlanır; oyuncular sayfayı yenileyip tekrar katılabilir.
Render'ın ücretsiz planı 0,1 CPU, 512 MB RAM ve çalışma alanı başına aylık 5 GB dış trafik içerir.
Trafik sınırı aşılırsa ödeme yöntemi olan hesapta ücret doğabilir; ödeme yöntemi olmayan hesapta hizmet
ayın kalanında durur. Bu yüzden kullanım sayfasını kontrol et. Bağlantıya sahip herkes maça katılabilir;
bu sürümde özel oda veya parola yoktur.


## Haritalar ve karanlıktan kaçış

| Harita | Boyut | Oynanış |
| --- | --- | --- |
| Seviye 0 | 72 × 72 m | Prosedürel, açık bağlantıları olan klasik Backrooms labirenti |
| M.E.G. Deposu | 40 × 40 m | Labirent olmayan simetrik üç hat, orta siperler, iki yan güzergâh ve korunaklı takım doğuşları |
| Derin Labirent | 176 × 176 m | Yaklaşık 5,98× alan; 10 ışıklı sığınak, geniş dallanan karanlık ağ ve uzak çıkış |

**Depo/TDM:** takım başına en fazla beş katılımcı. Oyuncular ve botlar eşit M4 + G17 + bıçak,
100 sağlık/100 zırh ve bir el bombasıyla başlar. İnsanlar botların yerini alabilir; çevrimdışı bot seçimi korunur.

**Gezgin:** ilk ışıklı sığınakta doğar. **E** ile tahliye haritasını incele, güzergâhı ezberle; dışarıda minimap yoktur.
Harita veya otomat açıkken maç devam eder. **Esc** yalnızca açık paneli kapatır; tarayıcı fareyi yeniden kilitlemek
için tıklama isterse `OYUNA DÖNMEK İÇİN TIKLA` görünür, duraklatma menüsü açılmaz.
Sığınakta iki saniye hareketsiz kalınca saniyede 4 sağlık yenilenir; oda başına 20, tur başına 60 sağlık sınırı vardır.
Karanlık yolculukta fener **T**, silah ve mevcut ganimet döngüsü kullanılabilir. Çıkışa varanlar veya ölenler
tur sonuna kadar gözlemci olur; yaşayan gezginin omuz kamerasından izleyebilir.

**Yaratık:** menüde rol tercihi seçilir; tek insan bu rolü alır, yoksa yapay zekâ devralır. Karanlık görüş,
birinci şahıs pençeler, sol tık hafif / sağ tık ağır saldırı; silah, bomba ve otomat yoktur. Işıklı sığınaklara
giremez, sınırdan içeri saldırı veya sıçrayarak geçme sunucuda da reddedilir. Sağlığı sonludur; gezginler onu etkisiz hale getirebilir.
Tüm gezginler çıkarsa veya yaratık ölürse gezginler; tüm gezginler yakalanırsa veya süre dolarsa yaratık kazanır.
Rolü isteyen birden fazla insan varsa yeni turlarda rol döner. İlk 15 saniye/ilk ölüm veya çıkıştan sonra katılan gezgin
bir sonraki turu bekler. İsteğe bağlı bot sayısı 0 olsa bile tek başına oynanan kaçışta gerekli bir AI rakip bulunur.

## Kontroller

Tüm tuşlar `KONTROLLER` menüsünden (veya oyun içi ayarlardan) yeniden atanabilir: eyleme tıkla, yeni tuşa bas.
Aşağıdakiler varsayılanlardır.

| Tuş | İşlev |
| --- | --- |
| WASD | hareket |
| Shift | koş (nefes/dayanıklılık harcar) · dürbündeyken nefes tut |
| Ctrl / C | çömel (basılı tut veya aç/kapat — ayarlardan) |
| Z / X | sola / sağa eğil (köşeden bakma) |
| Space | zıpla |
| Sol tık | ateş · bıçakta hafif saldırı |
| Sağ tık | nişan al · bıçakta ağır saplama |
| R | şarjör değiştir |
| B | atış modu (otomatik / 3'lü / tek atış) |
| G veya 4 | el bombası — basılı tut: pimi çek ve beklet (pişir), bırak: at |
| E | önündekini kullan (aşağı bakmana gerek yok): sandık aç · yerdeki silahı al / değiştir · otomatı aç |
| T | fener |
| F | silahı / bıçağı incele (M9 süngüyü parmağında çevirir) |
| 1 / 2 / 3, tekerlek | birincil / ikincil / bıçak |
| Tab | skor tablosu |
| Esc | duraklat (ayarlar oyun içinden de değişir) |

### Gamepad (Xbox / PlayStation / Steam Deck)

| Tuş | İşlev |
| --- | --- |
| Sol çubuk / sağ çubuk | hareket (analog yürüme) / bakış |
| RT / LT | ateş / nişan al (bıçakta ağır saplama) |
| A / B | zıpla / çömel |
| X | bağlama göre: kutu aç · silah al · otomat, yoksa şarjör değiştir |
| Y / LB | birincil ↔ ikincil / bıçak |
| RB | el bombası (basılı tut: beklet) |
| L3 / R3 | koş / silahı incele |
| Yön yukarı / aşağı / sol-sağ | fener / atış modu / eğil |
| View (basılı) / Menu | skor tablosu / duraklat |

Atış, isabet alma ve patlamalar titreşimle hissedilir; nişangah düşmanın üzerindeyken bakış hafifçe yavaşlar.
Otomat menüsünde: yön yukarı / aşağı seç, A satın al, B kapat.

## Silahlar

| Silah | Yuva | Özellik |
| --- | --- | --- |
| G17 tabanca | ikincil | herkes bununla doğar; boşalınca sürgü açık kalır |
| .357 toplu tabanca | ikincil | 2 gövde vuruşu; topluluğu açılıp hızlı doldurucuyla dolar |
| MP5 | birincil | otomatik/tek; yüksek atış hızı, kontrollü tepme |
| M870 pompalı | birincil | 9 saçma; fişek fişek doldurma (ateşe basınca durur), her atıştan sonra pompa |
| AK-47 | birincil | otomatik/tek; 3 vuruşta öldürür, sert tepme |
| M4A1 | birincil | otomatik/3'lü/tek; kırmızı noktalı nişangah |
| AWP | birincil | sürgülü, dürbünlü; nefes tutma (Shift), zırhlı rakibe de tek geçerli isabet |
| M9 süngü | yakın dövüş | hafif / ağır saldırı; **sırttan bıçaklama tek vuruşta öldürür**; F ile parmakta çevirerek incele |
| M67 el bombası | — | seker, yuvarlanır; duvar arkasına hasar vermez; bekletilebilir (elde patlayabilir!) |

- Doluyken şarjör değiştirmek namludaki mermiyi korur (30+1); boş şarjör değişimi daha uzun sürer (kurma kolu).

### Eklentiler

| Eklenti | Uyduğu silahlar | Etkisi |
| --- | --- | --- |
| Susturucu | G17, MP5, AK-47, M4A1, AWP | sessiz ve alevsiz atış, botlar seni çok daha zor duyar · menzilde hafif hasar kaybı |
| Uzatılmış şarjör | G17 (33), MP5 (40), M870 (8), AK-47 (45), M4A1 (40), AWP (10) | daha çok mermi · %12 daha yavaş şarjör değişimi |
| Lazer | tüm ateşli silahlar | belden atış çok daha isabetli, nokta nişangaha sıfırlı · ışını ve noktası herkes görür |

Eklentiler silahta kalır: silah yere düşerse (ölünce ya da değiştirince) eklentileriyle birlikte düşer.

## Oynanış

### Ganimet → para → otomat döngüsü

- **Her şey fiziksel:** kutudan, cesetten ya da otomattan çıkan eşyalar havaya fırlar, halıya düşer ve orada durur.
  Silaha **dönük dur ve E**'ye bas — nişanını bozup yere bakmana gerek yok (yuvan doluysa eldeki yere bırakılır).
  O yuvan boşsa ya da elindeki silahın aynısıysa (mermi olarak) **üzerinden geçmen** yeterli. İlk yardım, badem suyu,
  zırh plakası, el bombası, mermi kutusu ve para da üzerinden geçince — işine yarıyorsa — alınır. Seçili eşya hafifçe parlar.
- **M.E.G. ikmal sandıkları** (gezginlerin Seviye 0'a bıraktığı sert plastik taşıma çantaları) bir ana eşya (silah,
  mermi, el bombası, ilk yardım, badem suyu, zırh) ve çoğu zaman biraz para verir; 40 sn sonra yeniden dolar.
  Önlerindeki ışık doluyken yeşil, açılmışken kırmızı yanar. Kutudan çıkan silah da yere düşer — kimse eline zorla silah tutuşturmaz.
- **Para:** leş başına $100 ve stil bonusları — KAFADAN, SIRTTAN BIÇAK, BIÇAKLA, UÇURDU (el bombası), UZAK ATIŞ (25 m+),
  HAVADA, DÜRBÜNSÜZ (AWP nişan almadan), ÇOKLU LEŞ, İNTİKAM, İLK KAN, SERİ BİTİRİCİ, SON NEFES. Kazanç ekranda kalem
  kalem akar. Ölünce paranın dörtte biri cesedin yanına saçılır.
- **Badem suyu otomatları** (harita boyutuna göre, duvar diplerinde, ışıkları uzaktan görünür): önünde E ile aç.
  Menü resimli kartlardan oluşur, imleç serbest kalır: istediğine **tıkla** (ya da 1-0 kısayolları), E / ESC ile kapat.
  Sağlık, zırh, mermi, el bombası, her silah ve eklentiler satılır; aldığın şey bölmeden yuvarlanarak önüne düşer.
  Maç sen alışveriş yaparken durmaz.
  Botlar da para biriktirip otomattan silah ve zırh alır.
- **Cesetler savrulur:** öldüren darbe gövdeyi fırlatır — pompalı yakından geri iter, el bombası havaya uçurur,
  kafadan vuruş başı geriye atar. Gövde havada döner, duvara çarpıp sekebilir, halıya yığılır ve bir süre orada kalır.
  Sen ölürsen göğüs kameran da gövdeyle birlikte uçar.

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

Oyun (isim, fare ve nişan/dürbün hassasiyeti, ham fare girişi, Y ekseni, nişan/çömelme basılı tut ↔ aç/kapat, vuruş
işaretleri), **Nişangah** (Valorant tarzı düzenleyici: canlı önizleme, hazır şablonlar — Klasik CS, Keskin, Nokta,
T-şekli…; renk ve özel renk, dış hat kalınlığı/opaklığı, merkez noktası, çizgi uzunluğu/kalınlığı/boşluğu/opaklığı,
T-şekli, hareket ve ateşle açılma), Görüntü (kalite, FOV, **bodycam lens efekti yoğunluğu** — baş dönmesi yaşayanlar için, kamera sarsıntısı,
hareket bulanıklığı, parlaklık, FPS göstergesi), Ses (ana, efekt, ortam, arayüz, HRTF). Tarayıcıda saklanır.

## Teknik

- `lib/server.js` — statik dosya sunucusu + WebSocket (`/ws`) + `/info` (LAN adresleri), 30 Hz yetkili simülasyon;
  `server.js` (CLI) ve `desktop/main.cjs` (Electron) bunu kullanır.
- `public/js/shared/` — sunucu ve istemcinin ortak kodu: harita üretimi (otomatlar dahil), ışın izleme, çarpışma, yol bulma (`map.js`),
  silah verileri (`weapons.js`), ganimet / para / otomat / eklenti verileri (`items.js`), deterministik el bombası fiziği (`physics.js`),
  oyun çekirdeği ve bot yapay zekası (`core.js`: yere fırlayan eşyalar, para ve stil bonusları, otomat alışverişi, ceset fırlatma hızı,
  envanter yuvaları, bıçak, el bombası, yere düşen silahlar, maç süresi/istatistikler; botlar kutu açar, silah toplar,
  bıçak kullanır, el bombası atar ve bombalardan kaçar).
- `public/js/shared/movement.js` — 120 Hz'e kadar alt adımlı hareket, sürtünme/hava ivmesi, kasa desteği ve tavan açıklığı;
  `customization.js` — görünüm seçenekleri ve ağ girişinin normalleştirilmesi.
- `public/js/customize.js` — gerçek operatör modeliyle canlı atölye önizlemesi.
- `public/js/main.js` — istemci: hareket, atış (kare hızından bağımsız atış ritmi), durum makineleri (şarjör, fişek fişek
  doldurma, pompa/sürgü, bıçak, el bombası), anında vuruş geri bildirimi, anlık görüntü enterpolasyonu (uzak oyuncular 100 ms
  geriden, pürüzsüz çizilir), menü arka planındaki canlı seviye.
- `public/js/viewmodel.js` — birinci şahıs silah: yay tabanlı geri tepme ve anahtar kareli prosedürel animasyonlar;
  animasyon olayları sesleri ve oyun mantığını (şarjör yerine oturunca mermi eklenir vb.) zamanlar.
- `public/js/sfx.js` + `sfx-worker.js` — tüm ses efektleri açılışta Web Worker'larda saf JS DSP ile bir kez sentezlenir
  (silah başına yakın/uzak/birinci şahıs varyantları, darbe, adım, mekanik parçalar, ortam).
- `public/js/audio.js` — ses motoru: hazır tamponlar, kategori başına ses sınırı (en eski ses çalınır), efekt/ortam/arayüz
  kanalları, haritaya göre kısa yankı (convolver), duvar arkası boğuklaştırma, HRTF, silah/adım kanalları ve limitör. Uzak atışlar sunucu zaman damgasıyla
  ses saatine planlanır → takılma yok, tam otomatik ritim düzgün.
- `public/js/world.js` — 16 m geometri parçaları ve mesafe elemesi; en fazla 512² ışık haritası, görünürlük testli pişmiş ışık ve gerçek fener gölgeleri.
- `public/js/post.js` — bodycam lensi: HDR, bloom, balık gözü, kromatik sapma, dönüş bulanıklığı, gren, vinyet, dürbün.
- `public/js/models.js` — prosedürel silah modelleri (hareketli şarjör/sürgü/pompa/topluluk/sürgü kolu) ve eklentileri
  (susturucu, uzatılmış şarjör, lazer), ganimet modelleri (mermi kutusu, ilk yardım, badem suyu, zırh plakası, para),
  eldivenli kollar, operatör modelleri (savrulan, dönen ve yığılan ceset pozu).
- `public/js/effects.js` — parçacıklar, kurşun deliği / kan / yanık izleri, iz mermileri, namlu alevi, kovanlar, toz zerrecikleri.
- Tek bağımlılıklar `three` ve `ws`.

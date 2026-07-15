# Fiş Tarama Sistemi

Telefon kamerasıyla yazar kasa fişi / alışveriş fişi fotoğrafı çekip, üzerindeki
bilgileri (tarih, firma, toplam tutar, KDV, ödeme yöntemi vb.) otomatik olarak
okuyan ve tüm fişleri tek bir Excel dosyasında biriktiren bir sistem.

## Nasıl Çalışır

1. Telefonunuzun tarayıcısından (Chrome/Safari) uygulamayı açarsınız.
2. "Fiş Tara" düğmesine basıp fişin fotoğrafını çekersiniz.
3. Fotoğraf sunucuya yüklenir, Google Cloud Vision API ile fiş üzerindeki metin
   okunur, ardından tarih/firma/tutar/KDV gibi alanlar otomatik ayıklanır.
4. Ayıklanan bilgiler ekranda gösterilir; OCR hatalarını düzeltip **Kaydet**
   dersiniz. Kayıt yerel bir veritabanına (SQLite) eklenir. Taranan fotoğraf,
   fişin etrafındaki arka plan (masa, diğer nesneler vb.) otomatik olarak
   kırpılıp yalnızca fişin kendisini içeren tek sayfalık bir PDF belgesi
   olarak da saklanır; listedeki 📄 simgesinden veya Excel çıktısındaki
   bağlantıdan bu belgeye ulaşabilirsiniz.
5. İstediğiniz an **Excel İndir** düğmesiyle o ana kadarki tüm fişleri tek bir
   `.xlsx` dosyası olarak indirebilirsiniz (her fiş bir satır, toplamlar
   otomatik hesaplanır).

> İpucu: Birden fazla fişiniz varsa **"Birden Fazla Fiş Seç"** düğmesiyle
> galeriden hepsini birden seçebilirsiniz; sistem her birini sırayla okuyup
> tek tek onayınıza sunar, kaydettikçe otomatik olarak bir sonrakine geçer.

## Diğer Özellikler

- **Şifre koruması** — bkz. "Şifre Koruması" bölümü.
- **Bütçe/limit uyarısı** — Özet bölümündeki "Bütçe Ayarlarını Düzenle" ile
  kategori bazında aylık bütçe belirleyebilirsiniz; bu ay o kategoride
  harcamanız bütçeyi aşarsa çubuk kırmızıya döner ve ⚠️ ile uyarılırsınız
  (tarayıcınızda/localStorage'da tutulur, cihaza özeldir).
- **Tam metin arama** — filtre çubuğundaki "Ürün/Ham Metin" kutusu, kalemler
  ve okunan ham OCR metni içinde arama yapar (örn. bir ürünü hangi fişte
  aldığınızı bulmak için).
- **Sayfalama** — fiş listesi 25'erli sayfalara bölünür, performansı korur.
- **Yedekleme/İçe aktarma** — "Yedek İndir (JSON)" ile tüm fişlerinizi tek bir
  dosyada indirebilir, "Yedekten Geri Yükle" ile aynı dosyayı (veya başka bir
  kurulumdan alınan yedeği) mevcut kayıtlara ekleyebilirsiniz (üzerine
  yazmaz). Not: PDF belgeleri bu yedeğe dahil değildir, sadece dosya adı
  referansı taşınır.
- **Garanti süresi takibi** — fişe opsiyonel bir "Garanti Bitiş Tarihi"
  girebilirsiniz; listede son 30 gün içinde bitecek garantiler ⏰ sarı,
  geçmiş garantiler ⏰ kırmızı rozetle işaretlenir.
- **Çevrimdışı kuyruk** — kaydetme sırasında ağ hatası (sunucuya hiç
  ulaşılamaması) olursa kayıt kaybolmaz, sayfa açık kaldığı sürece kuyruğa
  alınıp bağlantı geri gelince otomatik gönderilir.
- **Karanlık mod** — sistem temanıza otomatik uyar; sağ üstteki 🌙/☀️
  düğmesiyle manuel de değiştirebilirsiniz (tercihiniz hatırlanır).

## Mimari

```
public/          -> Telefonda açılan web arayüzü (PWA, kameraya erişir)
server/
  index.js       -> Express sunucusu, ana giriş noktası
  db.js          -> SQLite veritabanı (data/fisler.db, otomatik oluşur)
  visionOcr.js   -> Google Cloud Vision API entegrasyonu (fotoğraf -> ham metin)
  receiptParser.js -> Ham metinden Türk fişi alanlarını (tarih, tutar, KDV, ...) ayıklar
  excelExport.js -> Kayıtlı fişleri biçimlendirilmiş .xlsx dosyasına dönüştürür
  routes/receipts.js -> API uç noktaları
data/            -> SQLite veritabanı dosyası burada tutulur (git'e eklenmez)
```

Veriler yerel bir SQLite dosyasında tutulur; ekstra bir veritabanı sunucusu
kurmanıza gerek yoktur.

## Kurulum

### 1. Bağımlılıkları yükleyin

```bash
npm install
```

### 2. Google Vision API Anahtarı Alma

Fiş fotoğraflarındaki yazıyı okumak için Google Cloud Vision API kullanılıyor.
Ücretsiz kotası vardır (aylık ilk 1000 görsel ücretsiz), sonrasında görsel
başına düşük bir ücret alınır.

1. https://console.cloud.google.com/ adresine gidip bir proje oluşturun
   (veya var olan bir projeyi seçin).
2. Sol menüden **APIs & Services > Library** kısmına girin, "Cloud Vision API"
   arayıp **Enable** (etkinleştir) butonuna basın.
3. **APIs & Services > Credentials** sayfasına gidip **Create Credentials >
   API key** seçeneğiyle bir API anahtarı oluşturun.
4. Güvenlik için oluşturduğunuz anahtarı "Restrict key" ile sadece
   "Cloud Vision API" kullanacak şekilde kısıtlamanız önerilir.
5. Projenin kök dizininde `.env.example` dosyasını `.env` olarak kopyalayıp
   `GOOGLE_VISION_API_KEY=` satırına aldığınız anahtarı yapıştırın:

```bash
cp .env.example .env
# .env dosyasini acip GOOGLE_VISION_API_KEY=xxxxxx satirini doldurun
```

### 3. Sunucuyu başlatın

```bash
npm start
```

Terminalde `http://0.0.0.0:3000 adresinde çalışıyor` yazısını görmelisiniz.

### 4. Telefondan erişme

Bilgisayarınız ve telefonunuz **aynı Wi-Fi ağında** olmalı.

1. Bilgisayarınızın yerel ağ IP adresini bulun:
   - Mac/Linux: `ifconfig` veya `ip addr` (örn. `192.168.1.5`)
   - Windows: `ipconfig` (IPv4 Address)
2. Telefonunuzun tarayıcısından `http://<bilgisayarinizin-ip-adresi>:3000`
   adresini açın (örn. `http://192.168.1.5:3000`).
3. Sağ üstteki paylaş/menü düğmesinden "Ana Ekrana Ekle" seçeneğiyle
   uygulamayı ikon olarak telefonunuza ekleyebilirsiniz (PWA).

> Not: `<input type="file" capture="environment">` kullanıldığı için kamera
> erişimi native tarayıcı kamerası üzerinden açılır ve bu, `getUserMedia`'nın
> aksine HTTP (HTTPS olmayan) bağlantılarda da genelde sorunsuz çalışır. Yine
> de gerçek/kalıcı bir kuruluma (ev dışından erişim, birden fazla kullanıcı)
> geçerseniz sunucuyu HTTPS ile (örn. bir ters proxy + Let's Encrypt ile)
> yayınlamanız önerilir.

## Render.com Üzerinde Kalıcı Yayınlama (Opsiyonel)

Aynı Wi-Fi şartı olmadan her yerden erişilebilir sabit bir link isterseniz,
projeyi ücretsiz Render.com üzerinde yayınlayabilirsiniz:

1. https://render.com adresinde GitHub hesabınızla üye olun.
2. **New +  >  Web Service** deyip bu GitHub reposunu seçin (repo bu depoya
   push edilmiş `render.yaml` dosyasını otomatik algılar; algılamazsa Build
   Command: `npm install`, Start Command: `npm start` girin).
3. **Environment** sekmesinden `GOOGLE_VISION_API_KEY` değişkenini ekleyip
   kendi anahtarınızı yapıştırın.
4. (Opsiyonel ama önerilir) Yedek yapay zeka katmanının canlıda da
   çalışması için aynı sekmeden `ANTHROPIC_API_KEY` değişkenini de
   ekleyin (https://console.anthropic.com/settings/keys). Eklemezseniz
   sistem sorunsuz çalışmaya devam eder, sadece regex başarısız/şüpheli
   kaldığında alanlar boş/hatalı kalabilir.
5. **(Şiddetle önerilir)** Uygulama public bir linkte yayınlanacağı için
   `APP_PASSWORD` değişkenini de ekleyip bir şifre belirleyin — aksi
   halde linki bilen/tahmin eden herkes tüm fişlerinizi görebilir.
   Aşağıdaki "Şifre Koruması" bölümüne bakın.
6. Deploy tamamlanınca size `https://<servis-adi>.onrender.com` şeklinde
   sabit bir link verir; bunu telefonunuzdan doğrudan açabilirsiniz.

> Not: Render'ın ücretsiz planında disk kalıcı değildir — her yeniden
> başlatma/deploy'da veritabanı sıfırlanır. Sadece test/demo amaçlı
> kullanım için uygundur; gerçek/sürekli kullanım için aşağıdaki gibi
> ücretli bir "persistent disk" eklemeniz gerekir.

### Kalıcı Disk Ekleme (Verilerin Deploy'lar Arasında Korunması)

Render'ın ücretli planlarında bir "Persistent Disk" ekleyip veritabanını
(ve fiş fotoğraflarını) orada tutabilirsiniz, böylece her yeni deploy'da
kayıtlarınız silinmez:

1. Render servisinizin **Disks** sekmesinden **Add Disk** deyip bir mount
   noktası belirleyin (örn. `/var/data`).
2. **Environment** sekmesinden `DATA_DIR` değişkenini ekleyip mount
   noktasıyla aynı değeri girin (örn. `/var/data`).
3. Yeniden deploy edin; sunucu artık veritabanını ve fiş fotoğraflarını
   bu kalıcı diskte tutacaktır.

`DATA_DIR` boş bırakılırsa (varsayılan), proje kendi `data/` klasörünü
kullanır — yerel geliştirme için yeterlidir ama Render'ın ücretsiz
planında kalıcı değildir.

### Şifre Koruması

Uygulama tüm fişlerinizi/finansal verilerinizi tek bir linkte tutuyor;
`.env` dosyasına (veya Render'ın Environment sekmesine) bir `APP_PASSWORD`
eklerseniz tarayıcı ilk açılışta basit bir kullanıcı adı/şifre penceresi
gösterir (HTTP Basic Auth) — kullanıcı adı önemsenmez, sadece girdiğiniz
şifre kontrol edilir. `APP_PASSWORD` boş bırakılırsa (varsayılan) uygulama
korumasız çalışır; **linki herkese açık bir yerde (Render vb.) yayınlıyorsanız
bunu ayarlamanız şiddetle önerilir**, aksi halde linki bilen/tahmin eden
herkes tüm kayıtlarınızı görebilir.

## Fiş Ayrıştırma Hakkında

`server/receiptParser.js`, Türk yazar kasa fişlerinde sık görülen ifadelere
(`TOPLAM`, `KDV`, `FİŞ NO`, `TARİH`, `NAKİT`/`KREDİ KARTI` vb.) dayanarak alan
çıkarımı yapar. Fiş formatları POS marka/modeline göre değiştiği için bu bir
"en iyi tahmin" ayıklamasıdır — bu yüzden arayüzde kaydetmeden önce alanları
gözden geçirip düzeltme imkanı vardır. Okunan ham metni de "Okunan ham metni
göster" bölümünden görebilirsiniz.

### KDV Oranına Göre Kırılım

Birçok fişte toplam tutarın altında, güncel KDV oranlarına (%1, %10, %20) göre
bir kırılım tablosu basılıdır (örn. "KDV MATRAH KDV TUTAR KDV DAHİL" veya "KDV
Oranı KDV Dahil Tutar KDV" başlıklı bir tablo). Sistem bu tabloyu otomatik
okuyup her oran için Toplam Tutar / Matrah / KDV değerlerini formdaki "KDV
Oranına Göre Kırılım" bölümüne ve Excel çıktısına ayrı sütunlar olarak ekler.
Fişte bu kırılım tablosu hiç yoksa (yalnızca tek bir toplam KDV varsa) ilgili
alanlar boş kalır; bu normaldir, mevcut olmayan bir veri türetilmez.

### Yedek Yapay Zeka Modeli (regex başarısız/belirsiz kaldığında)

Regex tabanlı ayıklama iki durumda otomatik olarak `server/aiFallback.js`
üzerinden Claude Haiku 4.5'i yedek olarak devreye sokar:

1. **Eksik** — temel alanlardan (tarih, saat, firma, toplam, KDV, fiş no,
   ödeme yöntemi) biri hiç bulunamamışsa.
2. **Şüpheli** — regex bir değer bulmuş ama `receiptParser.js` içindeki
   `findAmbiguousFields` aritmetik tutarlılık kontrolünden geçememişse
   (örn. KDV, toplamdan büyük çıkmış — TOPLAM/TOPKDV yer değiştirmiş
   olabilir; KDV kırılım tablosunun toplamı genel toplamla uyuşmuyor;
   tarih gelecekte veya geçersiz).

Şüpheli durumda sadece OCR metni değil, fişin **kırpılmış fotoğrafı da**
modele gönderilir; OCR metninin satır sırası/eşleşmesi hatalı olsa bile
model görseldeki gerçek yerleşimi esas alıp doğru değeri belirlemeye
çalışır. Regex'in tutarlı bulduğu değerlere hiçbir durumda dokunulmaz.

Form üzerinde bu durumda "🤖 Şu alanlar ... tamamlandı/düzeltildi" notu,
hangi alanların etkilendiğini adlarıyla birlikte gösterir.

Bu katmanın çalışması için `.env` dosyasına bir `ANTHROPIC_API_KEY`
eklemeniz gerekir (https://console.anthropic.com/settings/keys). Anahtar
girilmezse yedek katman sessizce devre dışı kalır, sistem sorunsuz şekilde
sadece regex ile çalışmaya devam eder.

Maliyet: yalnızca eksik/şüpheli fişlerde devreye girdiği için genel
maliyet düşüktür; ancak görsel içeren çağrılar (şüpheli durum) salt metin
çağrılarına göre biraz daha maliyetlidir (fotoğrafın çözünürlüğüne bağlı
olarak ek görsel token'ı eklenir).

> Not: Uygulama bir PWA olduğu için telefonunuzda arayüz dosyaları (Service
> Worker) önbelleğe alınır. Her deploy sonrası telefonda en güncel arayüzün
> yüklendiğinden emin olmak için sayfayı birkaç saniye bekleyip yeniden
> açın/yenileyin; `sw.js` artık ağdan gelen sürümü öncelikli kullanacak
> (network-first) şekilde ayarlıdır, bu yüzden yeni bir deploy'dan sonraki
> ilk açılışta güncel sürüm otomatik çekilir.

## API Uç Noktaları

| Yöntem | Yol                        | Açıklama                                   |
|--------|-----------------------------|---------------------------------------------|
| POST   | `/api/receipts/scan`       | Fiş fotoğrafını OCR'dan geçirip alanları döner (henüz kaydetmez) |
| POST   | `/api/receipts`            | Onaylanan fiş bilgilerini kaydeder          |
| GET    | `/api/receipts`            | Tüm kayıtlı fişleri listeler                |
| PUT    | `/api/receipts/:id`        | Bir fişi günceller                          |
| DELETE | `/api/receipts/:id`        | Bir fişi siler                              |
| GET    | `/api/receipts/export/excel` | Tüm fişleri tek bir `.xlsx` dosyası olarak indirir |
| GET    | `/api/receipts/export/json` | Tüm fişleri tek bir `.json` yedek dosyası olarak indirir |
| POST   | `/api/receipts/import/json` | Bir `.json` yedeğini mevcut kayıtlara ekler (üzerine yazmaz) |

## Geliştirme

```bash
npm run dev   # dosya degisikliklerinde otomatik yeniden baslatir
npm test      # receiptParser.js icin regresyon testlerini calistirir
```

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
   dersiniz. Kayıt yerel bir veritabanına (SQLite) eklenir.
5. İstediğiniz an **Excel İndir** düğmesiyle o ana kadarki tüm fişleri tek bir
   `.xlsx` dosyası olarak indirebilirsiniz (her fiş bir satır, toplamlar
   otomatik hesaplanır).

> İpucu: Birden fazla fişiniz varsa **"Birden Fazla Fiş Seç"** düğmesiyle
> galeriden hepsini birden seçebilirsiniz; sistem her birini sırayla okuyup
> tek tek onayınıza sunar, kaydettikçe otomatik olarak bir sonrakine geçer.

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
4. Deploy tamamlanınca size `https://<servis-adi>.onrender.com` şeklinde
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

## Geliştirme

```bash
npm run dev   # dosya degisikliklerinde otomatik yeniden baslatir
```

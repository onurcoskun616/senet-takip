const sharp = require('sharp');
const PDFDocument = require('pdfkit');

// Fisin OCR sirasinda tespit edilen cropBox'ina (bkz. visionOcr.js)
// gore fotografi kirpar; boylece kaydedilen belgede fisin etrafindaki
// arka plan (masa, diger nesneler vb.) degil, sadece fisin kendisi
// gorunur. cropBox verilmemisse ya da gecersizse fotografin tamami
// kullanilir.
const PADDING_RATIO = 0.04;

async function cropToReceipt(imageBuffer, cropBox) {
  // Google Vision, fotografin EXIF yonelim bilgisine gore dogru (goruntulenen)
  // yonde analiz yapip cropBox koordinatlarini da o yone gore donduruyor.
  // Bu yuzden once EXIF donusunu piksellere kalici olarak isleyip (rotate()),
  // genislik/yukseklik ve kirpma islemini bu "duzeltilmis" goruntu uzerinden
  // yapiyoruz - aksi halde 90 derece donuk bir fotografta kirpma alani yanlis
  // cikabilirdi.
  const rotatedBuffer = await sharp(imageBuffer).rotate().toBuffer();
  const { width, height } = await sharp(rotatedBuffer).metadata();

  let left = 0;
  let top = 0;
  let cropWidth = width;
  let cropHeight = height;

  if (cropBox && width && height) {
    const paddingX = (cropBox.maxX - cropBox.minX) * PADDING_RATIO;
    const paddingY = (cropBox.maxY - cropBox.minY) * PADDING_RATIO;
    const left2 = Math.max(0, Math.floor(cropBox.minX - paddingX));
    const top2 = Math.max(0, Math.floor(cropBox.minY - paddingY));
    const right = Math.min(width, Math.ceil(cropBox.maxX + paddingX));
    const bottom = Math.min(height, Math.ceil(cropBox.maxY + paddingY));
    if (right - left2 > 0 && bottom - top2 > 0) {
      left = left2;
      top = top2;
      cropWidth = right - left2;
      cropHeight = bottom - top2;
    }
  }

  const buffer = await sharp(rotatedBuffer)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .jpeg({ quality: 90 })
    .toBuffer();

  return { buffer, width: cropWidth, height: cropHeight };
}

// Kirpilmis fis goruntusunu, tam sayfayi kaplayan tek sayfalik bir
// PDF'e gomer (kenar bosluksuz - "taranmis belge" gorunumu icin).
function imageToPdf(imageBuffer, width, height) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [width, height], margin: 0 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.image(imageBuffer, 0, 0, { width, height });
    doc.end();
  });
}

// Ham fis fotografini alip, fisin disindaki alani kirpar ve tek
// sayfalik bir PDF buffer'i olarak dondurur.
async function buildReceiptPdf(imageBuffer, cropBox) {
  const { buffer, width, height } = await cropToReceipt(imageBuffer, cropBox);
  return imageToPdf(buffer, width, height);
}

module.exports = { buildReceiptPdf, cropToReceipt, imageToPdf };

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { extractText } = require('../visionOcr');
const { parseReceiptText } = require('../receiptParser');
const { buildWorkbook } = require('../excelExport');
const { buildReceiptPdf } = require('../documentBuilder');

const router = express.Router();

const KDV_RATE_FIELDS = ['1', '10', '20'];

// Taranan fişlerin kırpılmış PDF belgeleri burada saklanır (DATA_DIR
// altında, veritabanıyla aynı kalıcı disk üzerinde olacak şekilde).
const photosDir = path.join(db.dataDir, 'photos');
if (!fs.existsSync(photosDir)) {
  fs.mkdirSync(photosDir, { recursive: true });
}

function saveDocument(buffer) {
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(photosDir, filename), buffer);
  return filename;
}

function deleteDocument(filename) {
  if (!filename) return;
  const filePath = path.join(photosDir, path.basename(filename));
  fs.unlink(filePath, () => {});
}

// Guncel KDV oranlarina (%1/%10/%20) gore Toplam/Matrah/KDV kirilimi
// alanlarini istek govdesinden (kamelCase) veritabani sutunlarina
// (snake_case) esler.
function toNumberOrNull(value) {
  return value === '' || value === undefined || value === null ? null : Number(value);
}

function extractKdvRateFields(body) {
  const fields = {};
  for (const rate of KDV_RATE_FIELDS) {
    fields[`toplam_${rate}`] = toNumberOrNull(body[`toplam${rate}`]);
    fields[`matrah_${rate}`] = toNumberOrNull(body[`matrah${rate}`]);
    fields[`kdv_${rate}`] = toNumberOrNull(body[`kdv${rate}`]);
  }
  return fields;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Sadece resim dosyaları kabul edilir.'));
    }
    cb(null, true);
  },
});

// Fiş fotoğrafını OCR'dan geçirip alanları çıkarır (henüz kaydetmez).
// Fotoğraf, OCR sırasında tespit edilen fişin kendi alanına kırpılıp
// (etrafındaki masa/arka plan atılıp) tek sayfalık bir PDF belgesi olarak
// diske kaydedilir; kullanıcı fişi kaydettiğinde (POST /) bu dosya adı
// veritabanına yazılır, böylece sonradan tekrar bakılabilir.
router.post('/scan', upload.single('fis'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Fiş fotoğrafı yüklenmedi.' });
    }
    const { text: rawText, paragraphs, cropBox } = await extractText(req.file.buffer);
    if (!rawText) {
      return res.status(422).json({ error: 'Fotoğrafta okunabilir bir metin bulunamadı. Daha net bir fotoğraf deneyin.' });
    }
    const fields = parseReceiptText(rawText, paragraphs);
    const pdfBuffer = await buildReceiptPdf(req.file.buffer, cropBox);
    const fotoDosya = saveDocument(pdfBuffer);
    res.json({ fields: { ...fields, fotoDosya } });
  } catch (err) {
    console.error('OCR hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bir fişin taranmış belgesini (PDF) görüntüler (Excel'deki bağlantı ve
// listedeki önizleme için kullanılır).
router.get('/photos/:filename', (req, res) => {
  const filePath = path.join(photosDir, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Belge bulunamadı.' });
  }
  res.sendFile(filePath);
});

// Kullanıcının onayladığı/düzelttiği fiş bilgilerini kaydeder.
router.post('/', (req, res) => {
  const { tarih, saat, firma, toplam, kdv, odemeYontemi, fisNo, belgeTuru, kategori, notlar, kalemler, kdvDetay, hamMetin, fotoDosya } = req.body;
  const kdvRateFields = extractKdvRateFields(req.body);

  const stmt = db.prepare(`
    INSERT INTO receipts (
      tarih, saat, firma, toplam, kdv, odeme_yontemi, fis_no, belge_turu, kategori, notlar, kalemler, kdv_detay,
      toplam_1, matrah_1, kdv_1, toplam_10, matrah_10, kdv_10, toplam_20, matrah_20, kdv_20, ham_metin, foto_dosya
    )
    VALUES (
      @tarih, @saat, @firma, @toplam, @kdv, @odeme_yontemi, @fis_no, @belge_turu, @kategori, @notlar, @kalemler, @kdv_detay,
      @toplam_1, @matrah_1, @kdv_1, @toplam_10, @matrah_10, @kdv_10, @toplam_20, @matrah_20, @kdv_20, @ham_metin, @foto_dosya
    )
  `);

  const info = stmt.run({
    tarih: tarih || null,
    saat: saat || null,
    firma: firma || null,
    toplam: toNumberOrNull(toplam),
    kdv: toNumberOrNull(kdv),
    odeme_yontemi: odemeYontemi || null,
    fis_no: fisNo || null,
    belge_turu: belgeTuru || null,
    kategori: kategori || null,
    notlar: notlar || null,
    kalemler: kalemler || null,
    kdv_detay: kdvDetay || null,
    ...kdvRateFields,
    ham_metin: hamMetin || null,
    foto_dosya: fotoDosya || null,
  });

  const created = db.prepare('SELECT * FROM receipts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

// Tüm kayıtlı fişleri listeler.
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM receipts ORDER BY id DESC').all();
  res.json(rows);
});

// Tek bir fişi günceller (OCR hatalarını manuel düzeltmek için).
router.put('/:id', (req, res) => {
  const { tarih, saat, firma, toplam, kdv, odemeYontemi, fisNo, belgeTuru, kategori, notlar, kalemler, kdvDetay, fotoDosya } = req.body;
  const kdvRateFields = extractKdvRateFields(req.body);

  const existing = db.prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Fiş bulunamadı.' });

  db.prepare(`
    UPDATE receipts SET
      tarih = @tarih, saat = @saat, firma = @firma, toplam = @toplam, kdv = @kdv,
      odeme_yontemi = @odeme_yontemi, fis_no = @fis_no, belge_turu = @belge_turu,
      kategori = @kategori, notlar = @notlar,
      kalemler = @kalemler, kdv_detay = @kdv_detay,
      toplam_1 = @toplam_1, matrah_1 = @matrah_1, kdv_1 = @kdv_1,
      toplam_10 = @toplam_10, matrah_10 = @matrah_10, kdv_10 = @kdv_10,
      toplam_20 = @toplam_20, matrah_20 = @matrah_20, kdv_20 = @kdv_20,
      foto_dosya = @foto_dosya
    WHERE id = @id
  `).run({
    id: req.params.id,
    tarih: tarih || null,
    saat: saat || null,
    firma: firma || null,
    toplam: toNumberOrNull(toplam),
    kdv: toNumberOrNull(kdv),
    odeme_yontemi: odemeYontemi || null,
    fis_no: fisNo || null,
    belge_turu: belgeTuru || null,
    kategori: kategori || null,
    notlar: notlar || null,
    kalemler: kalemler || null,
    kdv_detay: kdvDetay || null,
    ...kdvRateFields,
    // Duzenleme sirasinda fotograf yeniden taranmadiysa mevcut dosyayi koru.
    foto_dosya: fotoDosya !== undefined ? fotoDosya || null : existing.foto_dosya,
  });

  const updated = db.prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// Bir fişi siler.
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT foto_dosya FROM receipts WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM receipts WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Fiş bulunamadı.' });
  deleteDocument(existing?.foto_dosya);
  res.status(204).end();
});

// Tüm fişleri tek bir Excel dosyası olarak indirir.
router.get('/export/excel', async (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM receipts ORDER BY tarih ASC, id ASC').all();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const workbook = await buildWorkbook(rows, baseUrl);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="fisler_${new Date().toISOString().slice(0, 10)}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

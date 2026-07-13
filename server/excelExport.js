const ExcelJS = require('exceljs');

const COLUMNS = [
  { header: 'ID', key: 'id', width: 6 },
  { header: 'Tarih', key: 'tarih', width: 12 },
  { header: 'Saat', key: 'saat', width: 10 },
  { header: 'Firma', key: 'firma', width: 32 },
  { header: 'Toplam Tutar', key: 'toplam', width: 16 },
  { header: 'KDV Tutarı', key: 'kdv', width: 14 },
  { header: 'Ödeme Yöntemi', key: 'odeme_yontemi', width: 16 },
  { header: 'Belge Türü', key: 'belge_turu', width: 16 },
  { header: 'Fiş / Fatura No', key: 'fis_no', width: 18 },
  { header: 'Kalemler', key: 'kalemler', width: 40 },
  { header: 'KDV Detayı', key: 'kdv_detay', width: 24 },
  // Kullanicinin paylastigi ornek tabloyla ayni yapida: KDV oranina gore
  // (guncel oranlar %1/%10/%20) Toplam Tutar / Matrah / KDV kirilimi.
  { header: 'TOPLAM TUTAR %1', key: 'toplam_1', width: 16 },
  { header: 'TOPLAM TUTAR %10', key: 'toplam_10', width: 16 },
  { header: 'TOPLAM TUTAR %20', key: 'toplam_20', width: 16 },
  { header: 'MATRAH %1', key: 'matrah_1', width: 14 },
  { header: 'MATRAH %10', key: 'matrah_10', width: 14 },
  { header: 'MATRAH %20', key: 'matrah_20', width: 14 },
  { header: 'KDV %1', key: 'kdv_1', width: 12 },
  { header: 'KDV %10', key: 'kdv_10', width: 12 },
  { header: 'KDV %20', key: 'kdv_20', width: 12 },
  { header: 'Kategori', key: 'kategori', width: 16 },
  { header: 'Notlar', key: 'notlar', width: 26 },
  { header: 'Fiş Fotoğrafı', key: 'foto_dosya', width: 20 },
  { header: 'Eklenme Tarihi', key: 'created_at', width: 20 },
  { header: 'Okunan Ham Metin', key: 'ham_metin', width: 60 },
];

const KDV_RATE_NUMERIC_KEYS = [
  'toplam_1', 'toplam_10', 'toplam_20',
  'matrah_1', 'matrah_10', 'matrah_20',
  'kdv_1', 'kdv_10', 'kdv_20',
];

async function buildWorkbook(rows, baseUrl) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Fiş Tarama Sistemi';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Fişler', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = COLUMNS;

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5233' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  for (const row of rows) {
    const addedRow = sheet.addRow(row);
    // Fotograf varsa, dosya adi yerine tiklanabilir bir baglanti goster.
    if (row.foto_dosya && baseUrl) {
      const cell = addedRow.getCell('foto_dosya');
      cell.value = { text: 'Fotoğrafı Görüntüle', hyperlink: `${baseUrl}/api/receipts/photos/${row.foto_dosya}` };
      cell.font = { color: { argb: 'FF2F5233' }, underline: true };
    }
  }

  sheet.getColumn('toplam').numFmt = '#,##0.00 "TL"';
  sheet.getColumn('kdv').numFmt = '#,##0.00 "TL"';
  sheet.getColumn('ham_metin').alignment = { wrapText: true, vertical: 'top' };
  sheet.getColumn('kalemler').alignment = { wrapText: true, vertical: 'top' };
  sheet.getColumn('kdv_detay').alignment = { wrapText: true, vertical: 'top' };
  for (const key of KDV_RATE_NUMERIC_KEYS) {
    sheet.getColumn(key).numFmt = '#,##0.00 "TL"';
  }

  const lastDataRow = rows.length + 1;
  if (rows.length > 0) {
    const totalRowIndex = lastDataRow + 1;
    const totalLabelCell = sheet.getCell(`D${totalRowIndex}`);
    totalLabelCell.value = 'GENEL TOPLAM:';
    totalLabelCell.font = { bold: true };

    const totalValueCell = sheet.getCell(`E${totalRowIndex}`);
    totalValueCell.value = { formula: `SUM(E2:E${lastDataRow})` };
    totalValueCell.font = { bold: true };
    totalValueCell.numFmt = '#,##0.00 "TL"';

    const kdvTotalCell = sheet.getCell(`F${totalRowIndex}`);
    kdvTotalCell.value = { formula: `SUM(F2:F${lastDataRow})` };
    kdvTotalCell.font = { bold: true };
    kdvTotalCell.numFmt = '#,##0.00 "TL"';

    for (const key of KDV_RATE_NUMERIC_KEYS) {
      const letter = sheet.getColumn(key).letter;
      const cell = sheet.getCell(`${letter}${totalRowIndex}`);
      cell.value = { formula: `SUM(${letter}2:${letter}${lastDataRow})` };
      cell.font = { bold: true };
      cell.numFmt = '#,##0.00 "TL"';
    }
  }

  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(COLUMNS.length).letter}1` };

  return workbook;
}

module.exports = { buildWorkbook };

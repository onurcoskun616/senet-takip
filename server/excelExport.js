const ExcelJS = require('exceljs');

const COLUMNS = [
  { header: 'ID', key: 'id', width: 6 },
  { header: 'Tarih', key: 'tarih', width: 12 },
  { header: 'Saat', key: 'saat', width: 10 },
  { header: 'Firma', key: 'firma', width: 32 },
  { header: 'Toplam Tutar', key: 'toplam', width: 16 },
  { header: 'KDV Tutarı', key: 'kdv', width: 14 },
  { header: 'Ödeme Yöntemi', key: 'odeme_yontemi', width: 16 },
  { header: 'Fiş No', key: 'fis_no', width: 16 },
  { header: 'Kategori', key: 'kategori', width: 16 },
  { header: 'Notlar', key: 'notlar', width: 26 },
  { header: 'Eklenme Tarihi', key: 'created_at', width: 20 },
  { header: 'Okunan Ham Metin', key: 'ham_metin', width: 60 },
];

async function buildWorkbook(rows) {
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
    sheet.addRow(row);
  }

  sheet.getColumn('toplam').numFmt = '#,##0.00 "TL"';
  sheet.getColumn('kdv').numFmt = '#,##0.00 "TL"';
  sheet.getColumn('ham_metin').alignment = { wrapText: true, vertical: 'top' };

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
  }

  sheet.autoFilter = { from: 'A1', to: 'L1' };

  return workbook;
}

module.exports = { buildWorkbook };

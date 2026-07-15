const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReceiptText, parseAmount, findAmbiguousFields } = require('./receiptParser');

// NOT: Bu fixture'lar sentetik/uydurma metinlerdir - kullanicinin gercek
// fis fotograflarindan HICBIR veri icermez. Amac, gecmiste tek tek elle
// (gercek fis gorselleriyle) dogrulanip sonra unutulan hata siniflarini
// kalici, otomatik calisan bir regresyon setine donusturmek.

test('parseReceiptText - temel alanlari (tarih/saat/firma/toplam/kdv/fisNo/odeme) dogru ayiklar', () => {
  const raw = [
    'FUNIDO TEKNOLOJI A.S.',
    'Ornek Mah. Test Sok. No:1',
    '05.05.2025',
    'SAAT : 10:30',
    'TOPLAM 205,00',
    'KDV 34,17',
    'FİŞ NO: 123',
    'NAKİT',
  ].join('\n');

  const fields = parseReceiptText(raw);
  assert.equal(fields.tarih, '05.05.2025');
  assert.equal(fields.saat, '10:30:00');
  assert.equal(fields.firma, 'FUNIDO TEKNOLOJI A.S.');
  assert.equal(fields.toplam, 205);
  assert.equal(fields.kdv, 34.17);
  assert.equal(fields.fisNo, '123');
  assert.equal(fields.odemeYontemi, 'Nakit');
});

test('parseReceiptText - A101 tipi "Mgz Adi/Mgz Kodu" satiri firma adina sizmaz', () => {
  const raw = [
    'A101 YENI MAGAZACILIK A.S.',
    'Mgz Adi : Hazar Bingol / Mgz Kodu : 8990',
    'Ornek Mah. Test Sok. No:5',
    '14.03.2025',
    'TOPLAM 50,00',
    'KDV 8,33',
    'FİŞ NO: 456',
    'NAKİT',
  ].join('\n');

  const fields = parseReceiptText(raw);
  assert.equal(fields.firma, 'A101 YENI MAGAZACILIK A.S.');
});

test('parseReceiptText - bastaki sifirla basilan KDV orani ("%01") taninir', () => {
  const raw = [
    'SOK MARKETLER TIC. A.S.',
    'Ornek Mah. Test Sok. No:2',
    '01.02.2025',
    'KDV ORANI KDV MATRAH KDV TUTAR KDV DAHİL',
    '%01 9,90 0,10 10,00',
    'TOPLAM 10,00',
    'KDV 0,10',
    'FİŞ NO: 789',
    'NAKİT',
  ].join('\n');

  const fields = parseReceiptText(raw);
  assert.equal(fields.toplam1, 10);
  assert.equal(fields.matrah1, 9.9);
  assert.equal(fields.kdv1, 0.1);
});

test('parseReceiptText - "%" isaretinin rakama karisip bozulmus hali ("201") taninir', () => {
  const raw = [
    'ORNEK MARKET A.S.',
    'Ornek Mah. Test Sok. No:3',
    '02.02.2025',
    'KDV ORANI KDV MATRAH KDV TUTAR KDV DAHİL',
    '201 9,90 0,10 10,00',
    'TOPLAM 10,00',
    'KDV 0,10',
    'FİŞ NO: 321',
    'NAKİT',
  ].join('\n');

  const fields = parseReceiptText(raw);
  assert.equal(fields.toplam1, 10);
  assert.equal(fields.matrah1, 9.9);
  assert.equal(fields.kdv1, 0.1);
});

test('parseReceiptText - tek kalemli fişte kirilim tablosu yoksa ve urun satirindan hesaplanan tutar guvenilir TOPLAM ile celisiyorsa, guvenilir TOPLAM/TOPKDV esas alinir', () => {
  const raw = [
    'FUNIDO TEKNOLOJI A.S.',
    'Ornek Mah. Test Sok. No:1',
    '05.05.2025',
    'URUN A %20 * 100,00',
    'TOPLAM 205,00',
    'KDV 34,17',
    'FİŞ NO: 123',
    'NAKİT',
  ].join('\n');

  const fields = parseReceiptText(raw);
  // Urun satirindan tek basina hesaplansaydi (yanlislikla) 100 TL cikardi;
  // guvenilir TOPLAM/TOPKDV ile tutarli oldugu icin duzeltilip 205 olmali.
  assert.equal(fields.toplam20, 205);
  assert.equal(fields.matrah20, 170.83);
  assert.equal(fields.kdv20, 34.17);
});

test('parseAmount - farkli ondalik/binlik ayiraci varyasyonlarini dogru cozer', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1.234.56'), 1234.56);
  assert.equal(parseAmount('1,234,56'), 1234.56);
  assert.equal(parseAmount('-164,99'), -164.99);
  assert.equal(parseAmount('125,50'), 125.5);
});

test('findAmbiguousFields - tutarli bir fiste hicbir alani supheli isaretlemez', () => {
  const fields = { toplam: 246, kdv: 41, tarih: '14.07.2025', firma: 'ÖRNEK MARKET A.Ş.', toplam1: null, kdv1: null, toplam10: null, kdv10: null, toplam20: null, kdv20: null };
  assert.deepEqual(findAmbiguousFields(fields), []);
});

test('findAmbiguousFields - KDV, toplamdan buyukse Toplam/KDV yer degistirmis olabilir diye isaretler', () => {
  const fields = { toplam: 0.97, kdv: 97.5, tarih: '14.07.2025', firma: 'CARREFOURSA', toplam1: null, kdv1: null, toplam10: null, kdv10: null, toplam20: null, kdv20: null };
  const result = findAmbiguousFields(fields);
  const flagged = result.map((r) => r.field).sort();
  assert.deepEqual(flagged, ['kdv', 'toplam']);
  assert.match(result.find((r) => r.field === 'toplam').reason, /yer değiştirmiş/);
});

test('findAmbiguousFields - gelecek tarihi supheli isaretler', () => {
  const fields = { toplam: 100, kdv: 10, tarih: '01.01.2030', firma: 'ÖRNEK MARKET A.Ş.' };
  const result = findAmbiguousFields(fields);
  assert.ok(result.some((r) => r.field === 'tarih'));
});

test('findAmbiguousFields - kirilim toplami genel toplamla uyusmuyorsa supheli isaretler', () => {
  const fields = {
    toplam: 300, kdv: 30, tarih: '14.07.2025', firma: 'ÖRNEK MARKET A.Ş.',
    toplam1: 100, matrah1: 99, kdv1: 1, toplam10: null, matrah10: null, kdv10: null, toplam20: null, matrah20: null, kdv20: null,
  };
  const result = findAmbiguousFields(fields);
  assert.ok(result.some((r) => r.field === 'toplam'));
});

test('findAmbiguousFields - kirilimda bir oranin kendi ici tutarsizsa (dahil != matrah+kdv) supheli isaretler', () => {
  const fields = {
    toplam: 205, kdv: 34.17, tarih: '14.07.2025', firma: 'ÖRNEK MARKET A.Ş.',
    toplam1: null, matrah1: null, kdv1: null, toplam10: null, matrah10: null, kdv10: null,
    toplam20: 205, matrah20: 100, kdv20: 34.17, // 100 + 34.17 != 205
  };
  const result = findAmbiguousFields(fields);
  assert.ok(result.some((r) => r.field === 'kdv'));
});

test('findAmbiguousFields - anlamsiz/cok kisa firma adini supheli isaretler', () => {
  const fields = { toplam: 100, kdv: 10, tarih: '14.07.2025', firma: '--' };
  const result = findAmbiguousFields(fields);
  assert.ok(result.some((r) => r.field === 'firma'));
});

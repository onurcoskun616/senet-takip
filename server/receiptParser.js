/**
 * Google Vision OCR'dan gelen ham metni alip, Turk yazar kasa fisi /
 * alisveris fisi formatina ozgu alanlari (tarih, saat, firma, toplam,
 * KDV, fis no, odeme yontemi) cikarmaya calisir. Fis formatlari POS
 * markasina gore degistigi icin bu bir "en iyi tahmin" (heuristic)
 * ayiklamadir; kullanici sonuclari kaydetmeden once duzenleyebilir.
 */

function parseAmount(raw) {
  if (!raw) return null;
  // "1.234,56" -> 1234.56  |  "125,50" -> 125.50  |  "125.50" -> 125.50
  let s = raw.trim().replace(/[^\d.,]/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function findDate(lines) {
  for (const line of lines) {
    const m = line.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
    if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  }
  return null;
}

function findTime(lines) {
  for (const line of lines) {
    const m = line.match(/\b(\d{2}):(\d{2})(:\d{2})?\b/);
    if (m) return m[3] ? `${m[1]}:${m[2]}${m[3]}` : `${m[1]}:${m[2]}:00`;
  }
  return null;
}

const AMOUNT_RE = /(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+[.,]\d{2})\s*(?:TL|₺)?\s*$/i;

function findAmountOnLine(line) {
  const m = line.match(AMOUNT_RE);
  return m ? parseAmount(m[1]) : null;
}

function findTotal(lines) {
  const priorityKeywords = ['GENEL TOPLAM', 'TOPLAM TUTAR', 'ÖDENEN', 'ODENEN'];
  const fallbackKeywords = ['TOPLAM'];
  const excludeKeywords = ['ARA TOPLAM', 'KDV'];

  for (const kw of priorityKeywords) {
    for (const line of lines) {
      if (line.toLocaleUpperCase('tr').includes(kw)) {
        const amt = findAmountOnLine(line);
        if (amt !== null) return amt;
      }
    }
  }
  for (const line of lines) {
    const upper = line.toLocaleUpperCase('tr');
    if (fallbackKeywords.some((kw) => upper.includes(kw)) && !excludeKeywords.some((kw) => upper.includes(kw) && !upper.includes('GENEL'))) {
      const amt = findAmountOnLine(line);
      if (amt !== null) return amt;
    }
  }
  return null;
}

function findKdv(lines) {
  let total = 0;
  let found = false;
  for (const line of lines) {
    const upper = line.toLocaleUpperCase('tr');
    if (upper.includes('KDV') || upper.includes('TOPKDV')) {
      const amt = findAmountOnLine(line);
      if (amt !== null) {
        total += amt;
        found = true;
      }
    }
  }
  return found ? Math.round(total * 100) / 100 : null;
}

function findFisNo(lines) {
  const patterns = [/F[İI][SŞ]\s*NO\s*[:.]?\s*(\S+)/i, /BELGE\s*NO\s*[:.]?\s*(\S+)/i, /EK[UÜ]\s*NO\s*[:.]?\s*(\S+)/i, /F[İI][SŞ]\s*[:#]\s*(\S+)/i];
  for (const line of lines) {
    for (const re of patterns) {
      const m = line.match(re);
      if (m) return m[1];
    }
  }
  return null;
}

function findPaymentMethod(lines) {
  for (const line of lines) {
    const upper = line.toLocaleUpperCase('tr');
    if (upper.includes('KREDİ KART') || upper.includes('KREDI KART') || upper.includes('BANKA KART')) return 'Kredi Kartı';
    if (upper.includes('NAKİT') || upper.includes('NAKIT')) return 'Nakit';
    if (upper.includes('TEMASSIZ')) return 'Temassız Kart';
  }
  return null;
}

function findFirma(lines) {
  // Fis basindaki ilk anlamli satir(lar) genelde magaza/firma adidir; isim
  // birden fazla satira yayilmis olabilir (orn. "FUNIDO" / "BİLİŞİM" /
  // "TEKNOLOJİLERİ A.Ş."). Adres/vergi/tarih bilgisine varana kadar
  // birbirini izleyen bu satirlari tek bir firma adinda birlestiriyoruz.
  const stopRe = /(VKN|VD\s*[:.]|VERG[İI]|ADRES|TEL\s*[:.]|CAD\.|SOK\.|MAH\.|BLV|NO\s*[:.]?\s*\d|\d{2}[.\/-]\d{2}[.\/-]\d{4}|\/[A-ZÇĞİÖŞÜ]+$)/i;
  const nameParts = [];
  for (const line of lines.slice(0, 6)) {
    const trimmed = line.trim();
    if (!trimmed || /^\d+$/.test(trimmed)) continue;
    if (stopRe.test(trimmed)) break;
    nameParts.push(trimmed);
    if (nameParts.length >= 3) break;
  }
  return nameParts.length ? nameParts.join(' ') : null;
}

function findKalemler(lines) {
  // Urun satirlari genelde "miktar x/İ birim fiyat" seklinde bir desen
  // icerir (orn. "2 x 22,75", "20 * 205,00"). Bu satirlari oldugu gibi
  // toplayip kullaniciya gosteriyoruz; tam urun adi/KDV orani eslestirmesi
  // fis siralamasi cok bozuk cikan durumlarda guvenilir yapilamiyor, bu
  // yuzden kullanicinin gozden gecirip duzenlemesi icin ham aday satirlari
  // birer birer listeliyoruz.
  const itemRe = /\d+([.,]\d+)?\s*[x×\*]\s*\d+[.,]\d{2}/i;
  const items = lines.filter((line) => itemRe.test(line)).map((l) => l.trim());
  return items.length ? items.join('\n') : null;
}

function findKdvDetay(lines) {
  // "%20 KDV", "KDV %10", "TOPKDV" gibi KDV oranina/tutarina isaret eden
  // satirlari topluyor.
  const kdvRe = /%\s*\d{1,2}\s*KDV|KDV\s*%?\s*\d{1,2}|TOPKDV/i;
  const items = lines.filter((line) => kdvRe.test(line)).map((l) => l.trim());
  return items.length ? items.join('\n') : null;
}

function parseReceiptText(rawText) {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return {
    tarih: findDate(lines),
    saat: findTime(lines),
    firma: findFirma(lines),
    toplam: findTotal(lines),
    kdv: findKdv(lines),
    fisNo: findFisNo(lines),
    odemeYontemi: findPaymentMethod(lines),
    kalemler: findKalemler(lines),
    kdvDetay: findKdvDetay(lines),
    hamMetin: rawText,
  };
}

module.exports = { parseReceiptText, parseAmount };

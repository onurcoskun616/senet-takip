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
    // OCR bazen "08 / 07 / 2026" gibi ayraclarin etrafina bosluk koyabiliyor.
    const m = line.match(/(\d{2})\s*[.\/-]\s*(\d{2})\s*[.\/-]\s*(\d{4})/);
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
// Bir satirin tamamen (baslik/etiket olmadan) bir tutardan ibaret olup
// olmadigini kontrol eder - orn. "* 205,00", "#59,90".
const BARE_AMOUNT_RE = /^[*#$₺\s]*(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+[.,]\d{2})\s*(?:TL|₺)?[*#\s]*$/i;

function findAmountOnLine(line) {
  const m = line.match(AMOUNT_RE);
  return m ? parseAmount(m[1]) : null;
}

const ARA_TOPLAM_RE = /ARA\s*TOPLAM/i;
const GENEL_TOPLAM_RE = /GENEL\s*TOPLAM|TOPLAM\s*TUTAR|ÖDENEN|ODENEN/i;
const TOPLAM_RE = /TOPLAM/i;
const KDV_RE = /TOPKDV|KDV/i;

/**
 * TOPLAM ve KDV tutarlarini birlikte cikarir. Once klasik "ETIKET: TUTAR"
 * (ayni satirda) durumunu dener; bulunamayanlar icin, etiketlerin (TOPKDV,
 * TOPLAM) kendi satirinda, tutarlarin ise birkac satir sonra ayri ayri
 * "ciplak" satirlar halinde kumelendigi (fisin gercek gorsel sirasindan
 * farkli OCR okuma sirasi yuzunden) durumu ele alir: etiketleri ve
 * ciplak tutarlari kendi karsilastiklari sirayla birebir eslestirir, boylece
 * iki etiket + iki tutar kumesi (orn. TOPKDV/TOPLAM ... *34,17/*205,00)
 * yanlislikla birbirine karismaz.
 */
function findTotalAndKdv(lines) {
  let toplam = null;
  let kdv = null;

  // 1) Ayni satirda tutar barindiran etiketler.
  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].toLocaleUpperCase('tr');
    const amt = findAmountOnLine(lines[i]);
    if (amt === null) continue;
    if (toplam === null && GENEL_TOPLAM_RE.test(upper)) toplam = amt;
    else if (toplam === null && TOPLAM_RE.test(upper) && !ARA_TOPLAM_RE.test(upper)) toplam = amt;
    if (kdv === null && KDV_RE.test(upper)) kdv = amt;
  }
  if (toplam !== null && kdv !== null) return { toplam, kdv };

  // 2) Etiket ile tutarin ayri satirlara dustugu durum: etiketleri ve
  // "ciplak" tutar satirlarini kendi aralarinda sirali eslestir.
  const consumed = new Set();
  const pendingLabels = [];
  for (let i = 0; i < lines.length; i++) {
    if (findAmountOnLine(lines[i]) !== null) continue;
    const upper = lines[i].toLocaleUpperCase('tr');
    if (kdv === null && KDV_RE.test(upper)) pendingLabels.push({ index: i, type: 'kdv' });
    else if (toplam === null && TOPLAM_RE.test(upper) && !ARA_TOPLAM_RE.test(upper)) pendingLabels.push({ index: i, type: 'toplam' });
  }

  for (const label of pendingLabels) {
    if ((label.type === 'toplam' && toplam !== null) || (label.type === 'kdv' && kdv !== null)) continue;
    for (let offset = 1; offset <= 6; offset++) {
      const idx = label.index + offset;
      if (consumed.has(idx) || !lines[idx]) continue;
      const m = lines[idx].match(BARE_AMOUNT_RE);
      if (m) {
        const amt = parseAmount(m[1]);
        if (label.type === 'toplam') toplam = amt; else kdv = amt;
        consumed.add(idx);
        break;
      }
    }
  }

  return { toplam, kdv };
}

function findFisNo(lines) {
  // Oncelik sirasi onemli: "FİŞ NO" her zaman en dogru kaynak, "EKÜ NO"/
  // "BELGE NO" gibi diger kasa numaralari fis no degildir. Metin sirasi
  // karisik gelebildigi icin (bazen EKÜ NO satiri once yakalanabiliyordu)
  // her deseni TUM satirlarda arayip, oncelikli desen bulunamazsa bir
  // sonrakine gecen bir siralama kullaniyoruz.
  const patternsInPriorityOrder = [
    /F[İI][SŞ]\s*NO\s*[:.]?\s*(\S+)/i,
    /F[İI][SŞ]\s*[:#]\s*(\S+)/i,
    /BELGE\s*NO\s*[:.]?\s*(\S+)/i,
    /EK[UÜ]\s*NO\s*[:.]?\s*(\S+)/i,
    // OCR "FİŞ NO" ifadesini bazen "TIS NO" olarak yanlis okuyor; son care
    // olarak bunu da deniyoruz.
    /T[İI]S\s*NO\s*[:.]?\s*(\S+)/i,
  ];
  for (const re of patternsInPriorityOrder) {
    for (const line of lines) {
      const m = line.match(re);
      if (m) return m[1];
    }
  }

  // Bazi fişlerde deger, "FİŞ NO" etiketinden once (ayri bir satirda) geliyor
  // (orn. "...0032\nFİŞ NO\n..."). Etiketi tek basina bulup bir onceki
  // satirda kisa bir sayisal kod ariyoruz.
  const bareLabelRe = /^(F[İI][SŞ]|T[İI]S)\s*NO\s*[:.]?\s*$/i;
  for (let i = 0; i < lines.length; i++) {
    if (bareLabelRe.test(lines[i]) && lines[i - 1] && /^\d{3,6}$/.test(lines[i - 1].trim())) {
      return lines[i - 1].trim();
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

  const { toplam, kdv } = findTotalAndKdv(lines);

  return {
    tarih: findDate(lines),
    saat: findTime(lines),
    firma: findFirma(lines),
    toplam,
    kdv,
    fisNo: findFisNo(lines),
    odemeYontemi: findPaymentMethod(lines),
    kalemler: findKalemler(lines),
    kdvDetay: findKdvDetay(lines),
    hamMetin: rawText,
  };
}

module.exports = { parseReceiptText, parseAmount };

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
  // OCR bazen "SAAT : 13 : 08" gibi ayraclarin etrafina bosluk koyabiliyor.
  const timeRe = /\b(\d{2})\s*:\s*(\d{2})\s*(?::\s*(\d{2}))?\b/;
  const format = (m) => `${m[1]}:${m[2]}:${m[3] || '00'}`;

  // Once "SAAT" etiketini tasiyan satiri tercih et; boylece fis uzerinde
  // baska bir yerde (orn. POS yazdirma zaman damgasi) gecen alakasiz bir
  // saat yanlislikla secilmesin.
  for (const line of lines) {
    if (/SAAT/i.test(line)) {
      const m = line.match(timeRe);
      if (m) return format(m);
    }
  }
  for (const line of lines) {
    const m = line.match(timeRe);
    if (m) return format(m);
  }
  return null;
}

const AMOUNT_RE = /(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+[.,]\d{2})\s*(?:TL|₺)?\s*$/i;
// Bir satirin tamamen (baslik/etiket olmadan) bir tutardan ibaret olup
// olmadigini kontrol eder - orn. "* 205,00", "#59,90", "+930,00".
const BARE_AMOUNT_RE = /^[*#$₺+\s]*(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+[.,]\d{2})\s*(?:TL|₺)?[*#+\s]*$/i;

// Etiketten en yakin (once daha kisa mesafeli, sonra ileri/geri sirayla)
// satirlara bakmak icin kullanilan ofset sirasi: +1,-1,+2,-2,...
function nearOffsets(maxDistance) {
  const offsets = [];
  for (let d = 1; d <= maxDistance; d++) {
    offsets.push(d, -d);
  }
  return offsets;
}

function findAmountOnLine(line) {
  const m = line.match(AMOUNT_RE);
  return m ? parseAmount(m[1]) : null;
}

const ARA_TOPLAM_RE = /ARA\s*TOPLAM/i;
const GENEL_TOPLAM_RE = /GENEL\s*TOPLAM|TOPLAM\s*TUTAR|ÖDENEN|ODENEN/i;
// Bazi fişlerde "TOPLAM" kisaltilarak sadece "TOP" yazilabiliyor. \b sinirlari
// sayesinde bu, "ARATOPLAM" veya "TOPKDV" gibi kelimelerin icini yakalamiyor.
const TOPLAM_RE = /\bTOPLAM\b|\bTOP\b/i;
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
    for (const offset of nearOffsets(6)) {
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

function parseBareAmount(text) {
  const m = text.trim().match(BARE_AMOUNT_RE);
  return m ? parseAmount(m[1]) : null;
}

/**
 * Vision bazen dikey olarak ust uste duran birden fazla tutari
 * ("* 68,18\n* 750,00" gibi) TEK bir paragrafta birlestiriyor. Boyle bir
 * paragraf BARE_AMOUNT_RE ile bir butun olarak eslesmedigi icin icindeki
 * degerler gorunmez oluyordu. Her paragrafi kendi alt satirlarina ayirip,
 * paragrafin topY-bottomY araligina orantili bir dikey konum tahmini
 * vererek her alt satiri ayri bir "tutar adayi" haline getiriyoruz.
 */
function buildAmountCandidates(paragraphs) {
  const candidates = [];
  for (const p of paragraphs) {
    const subLines = p.text.split('\n').filter((l) => l.trim());
    if (subLines.length <= 1) {
      candidates.push({ text: p.text, topY: p.topY, leftX: p.leftX, parent: p });
      continue;
    }
    const span = (p.bottomY ?? p.topY) - p.topY;
    subLines.forEach((line, i) => {
      const topY = p.topY + (span * i) / (subLines.length - 1);
      candidates.push({ text: line, topY, leftX: p.leftX, parent: p });
    });
  }
  return candidates;
}

/**
 * TOPLAM/KDV tutarlarini, paragraflarin fis uzerindeki gercek 2 boyutlu
 * konumuna (metin sirasina degil) bakarak bulur. Cok kalemli fişlerde
 * metin-sirasi tabanli tahmin, etikete metinde yakin ama fis uzerinde
 * alakasiz bir urun fiyatini yanlislikla secebiliyordu; gercek piksel
 * konumuna gore en yakin tutari secmek bu riski azaltir.
 */
function findTotalAndKdvSpatial(paragraphs) {
  let toplam = null;
  let kdv = null;
  const consumed = new Set();
  const amountCandidates = buildAmountCandidates(paragraphs);

  const labelParagraphs = [];
  for (const p of paragraphs) {
    const upper = p.text.toLocaleUpperCase('tr');
    if (GENEL_TOPLAM_RE.test(upper)) labelParagraphs.push({ p, type: 'toplam', priority: 0 });
    else if (TOPLAM_RE.test(upper) && !ARA_TOPLAM_RE.test(upper)) labelParagraphs.push({ p, type: 'toplam', priority: 1 });
    if (KDV_RE.test(upper)) labelParagraphs.push({ p, type: 'kdv', priority: 1 });
  }
  labelParagraphs.sort((a, b) => a.priority - b.priority);

  for (const label of labelParagraphs) {
    if ((label.type === 'toplam' && toplam !== null) || (label.type === 'kdv' && kdv !== null)) continue;

    const inline = findAmountOnLine(label.p.text);
    if (inline !== null && !consumed.has(label.p)) {
      if (label.type === 'toplam') toplam = inline; else kdv = inline;
      consumed.add(label.p);
      continue;
    }

    // Ayni paragrafta tutar yoksa en yakin "ciplak tutar" adayini ara:
    // once ayni satirdakileri (topY yakin) soldan-saga mesafeye gore,
    // yoksa dikey olarak en yakin satiri tercih ediyoruz.
    let best = null;
    let bestScore = Infinity;
    for (const cand of amountCandidates) {
      if (cand.parent === label.p || consumed.has(cand)) continue;
      const amt = parseBareAmount(cand.text);
      if (amt === null) continue;
      const dy = Math.abs(cand.topY - label.p.topY);
      const dx = cand.leftX - label.p.leftX;
      const sameRow = dy < 20;
      const score = sameRow ? Math.abs(dx) : 100000 + dy * 10 + Math.abs(dx);
      if (score < bestScore) {
        bestScore = score;
        best = { cand, amt };
      }
    }
    if (best) {
      if (label.type === 'toplam') toplam = best.amt; else kdv = best.amt;
      consumed.add(best.cand);
    }
  }

  return { toplam, kdv };
}

function findFisNo(lines) {
  // Oncelik sirasi onemli: "FİŞ NO" her zaman en dogru kaynak, "EKÜ NO"/
  // "BELGE NO" gibi diger kasa numaralari fis no degildir. Bu yuzden once
  // her turlu "FİŞ NO" varyasyonunu (ayni satirda, ayri satirda deger
  // once/sonra) TUM metinde deniyoruz; ancak hicbiri bulunamazsa "EKÜ NO"
  // gibi dusuk oncelikli alanlara dusuyoruz.
  const fisInlinePatterns = [/F[İI][SŞ]\s*NO\s*[:.]?\s*(\S+)/i, /F[İI][SŞ]\s*[:#]\s*(\S+)/i, /T[İI]S\s*NO\s*[:.]?\s*(\S+)/i];
  for (const re of fisInlinePatterns) {
    for (const line of lines) {
      const m = line.match(re);
      if (m) return m[1];
    }
  }

  // Deger, etiketten ayri bir satirda (once ya da sonra) gelebiliyor
  // (orn. "...0032\nFİŞ NO\n..." ya da "FİŞ NO\n0085"). Etiketi tek basina
  // bulup en yakin satirlarda kisa bir sayisal kod ariyoruz.
  const bareFisLabelRe = /^(F[İI][SŞ]|T[İI]S)\s*NO\s*[:.]?\s*$/i;
  for (let i = 0; i < lines.length; i++) {
    if (!bareFisLabelRe.test(lines[i])) continue;
    for (const offset of nearOffsets(3)) {
      const neighbor = lines[i + offset];
      if (!neighbor) continue;
      // Deger satiri bazen basinda ":" ile geliyor (orn. "FİŞ NO\n: 0198").
      const m = neighbor.trim().match(/^[:.]?\s*(\d{3,6})$/);
      if (m) return m[1];
    }
  }

  const fallbackPatterns = [/BELGE\s*NO\s*[:.]?\s*(\S+)/i, /EK[UÜ]\s*NO\s*[:.]?\s*(\S+)/i];
  for (const re of fallbackPatterns) {
    for (const line of lines) {
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

function parseReceiptText(rawText, paragraphs) {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Konum (bounding box) verisi varsa once onu dene - gorsel olarak dogru
  // sonuc verir. Eksik kalan alan olursa metin-sirasi tabanli yontemle
  // tamamlamaya calis.
  let toplam = null;
  let kdv = null;
  if (paragraphs && paragraphs.length) {
    ({ toplam, kdv } = findTotalAndKdvSpatial(paragraphs));
  }
  if (toplam === null || kdv === null) {
    const fallback = findTotalAndKdv(lines);
    if (toplam === null) toplam = fallback.toplam;
    if (kdv === null) kdv = fallback.kdv;
  }

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

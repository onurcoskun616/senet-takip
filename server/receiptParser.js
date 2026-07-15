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
  // "-164,99" -> -164.99 (indirim satirlari icin isaret korunur)
  // "1.099.95" -> 1099.95 (OCR bazen "1.099,95" icindeki "," isaretini de
  // "." olarak okuyor; boyle durumda son ayiraci ondalik, oncekileri
  // binlik kabul ediyoruz - hangi karakter oldugundan bagimsiz).
  const isNegative = /^\s*-/.test(raw);
  let s = raw.trim().replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (lastSep !== -1 && s.length - lastSep - 1 === 2) {
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, '');
    s = `${intPart}.${s.slice(lastSep + 1)}`;
  } else {
    s = s.replace(/,/g, '.');
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return isNegative ? -n : n;
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

// Bir tutar hangi ayiraci (nokta/virgul) kullanirsa kullansin, gruplama
// karakterinden bagimsiz olarak taniyoruz: "1.234,56" (nokta=binlik,
// virgul=ondalik), "1.234.56" ya da "1,234,56" (OCR iki ayiraci da ayni
// karakterle okumus olabiliyor - sonuncusu her zaman ondalik kabul
// edilir) ve duz "125,50"/"125.50"/"1234,56" (binlik ayiraci hic yok).
const AMOUNT_VALUE_RE = '(?:\\d{1,3}(?:[.,]\\d{3})*[.,]\\d{2}|\\d+[.,]\\d{2})';
const AMOUNT_RE = new RegExp(`(${AMOUNT_VALUE_RE})\\s*(?:TL|₺)?\\s*$`, 'i');
// Bir satirin tamamen (baslik/etiket olmadan) bir tutardan ibaret olup
// olmadigini kontrol eder - orn. "* 205,00", "#59,90", "+930,00".
const BARE_AMOUNT_RE = new RegExp(`^[*#$₺+\\s]*(-?${AMOUNT_VALUE_RE})\\s*(?:TL|₺)?[*#+\\s]*$`, 'i');

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
// "Genel toplam" turunden acik/kesin ifadeler - bunlar KDV kelimesi
// gecse bile (orn. "Ödenecek KDV Dahil Tutar") her zaman TOPLAM'dir.
const GENEL_TOPLAM_RE = /GENEL\s*TOPLAM|TOPLAM\s*TUTAR|ÖDENECEK|KDV\s*DAHİL\s*TUTAR|\bÖDENEN\b|\bODENEN\b/i;
const KDV_RE = /TOPKDV|KDV/i;
// Bazi fişlerde "TOPLAM" kisaltilarak sadece "TOP" yazilabiliyor. \b sinirlari
// sayesinde bu, "ARATOPLAM" veya "TOPKDV" gibi kelimelerin icini yakalamiyor.
const TOPLAM_RE = /\bTOPLAM\b|\bTOP\b/i;

/**
 * Bir satirin/paragrafin TOPLAM mi KDV mi yoksa hicbiri mi oldugunu tek
 * bir yerden, birbirini dislayan bir sirayla belirler. Bu onemli, cunku
 * "TOPLAM KDV" gibi ifadeler hem "TOPLAM" hem "KDV" kelimesini icerir -
 * boyle bir satir aslinda KDV tutaridir (Turkce'de "toplam KDV" = KDV
 * toplami), TOPLAM (genel toplam) degildir. Ayni satiri iki farkli
 * etikete birden atamak, tutarlarin yer degistirmesine yol aciyordu.
 */
function classifyTotalLabel(upper) {
  if (GENEL_TOPLAM_RE.test(upper)) return { type: 'toplam', priority: 0 };
  if (KDV_RE.test(upper)) return { type: 'kdv', priority: 1 };
  if (ARA_TOPLAM_RE.test(upper)) return null;
  if (TOPLAM_RE.test(upper)) return { type: 'toplam', priority: 1 };
  return null;
}

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
    const label = classifyTotalLabel(upper);
    if (!label) continue;
    if (label.type === 'toplam' && toplam === null) toplam = amt;
    else if (label.type === 'kdv' && kdv === null) kdv = amt;
  }
  if (toplam !== null && kdv !== null) return { toplam, kdv };

  // 2) Etiket ile tutarin ayri satirlara dustugu durum: etiketleri ve
  // "ciplak" tutar satirlarini kendi aralarinda sirali eslestir.
  const consumed = new Set();
  const pendingLabels = [];
  for (let i = 0; i < lines.length; i++) {
    if (findAmountOnLine(lines[i]) !== null) continue;
    const upper = lines[i].toLocaleUpperCase('tr');
    const label = classifyTotalLabel(upper);
    if (!label) continue;
    if (label.type === 'kdv' && kdv === null) pendingLabels.push({ index: i, type: 'kdv' });
    else if (label.type === 'toplam' && toplam === null) pendingLabels.push({ index: i, type: 'toplam' });
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
      candidates.push({ text: p.text, topY: p.topY, bottomY: p.bottomY ?? p.topY, leftX: p.leftX, parent: p });
      continue;
    }
    const span = (p.bottomY ?? p.topY) - p.topY;
    subLines.forEach((line, i) => {
      const topY = p.topY + (span * i) / (subLines.length - 1);
      const bottomY = p.topY + (span * (i + 1)) / (subLines.length - 1);
      candidates.push({ text: line, topY, bottomY, leftX: p.leftX, parent: p });
    });
  }
  return candidates;
}

// Bir paragraf/adayin topY-bottomY araliginin dikey orta noktasi. OCR
// bazen ayni satirdaki etiket ile tutarin bounding box'larini birbirine
// gore hafifce kaydirilmis (ust kenarlari farkli hizada) dondurebiliyor;
// sadece topY karsilastirmak boyle durumlarda yanlis eslesmeye yol
// acabiliyor. Orta nokta, glif yuksekligi farkliliklarina karsi daha
// dayanikli bir referans noktasidir.
function verticalMid(item) {
  const bottom = item.bottomY ?? item.topY;
  return (item.topY + bottom) / 2;
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
    const label = classifyTotalLabel(upper);
    if (label) labelParagraphs.push({ p, type: label.type, priority: label.priority });
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

    // Ayni paragrafta tutar yoksa en yakin "ciplak tutar" adayini ara.
    let best = null;
    let bestScore = Infinity;
    for (const cand of amountCandidates) {
      if (cand.parent === label.p || consumed.has(cand)) continue;
      const amt = parseBareAmount(cand.text);
      if (amt === null) continue;
      const dy = Math.abs(verticalMid(cand) - verticalMid(label.p));
      const dx = Math.abs(cand.leftX - label.p.leftX);
      // Dikey yakinlik (dy), yatay mesafeden (dx) cok daha guclu bir
      // isarettir: tum tutarlar zaten fişin ayni saga-hizali sutununda
      // basiliyor, dx farki sadece o sutun icinde hangi tutarin biraz
      // daha sola/saga oturdugunu gosterir - hangi ETIKETE ait oldugunu
      // degil.
      const score = dy * 50 + dx;
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

// OCR "E-Arşiv Fatura" ifadesini bazen "E - Arsiv Fatura" gibi
// tire/bosluk etrafinda fazladan bosluklarla okuyabiliyor.
const E_ARSIV_FATURA_RE = /E[-\s]*ARŞİV\s*FATURA|E[-\s]*ARSIV\s*FATURA/i;
const E_FATURA_RE = /\bE[-\s]*FATURA\b/i;
const GIDER_PUSULASI_RE = /G[İI]DER\s*PUSULASI/i;

/**
 * Fiş (yazar kasa fişi) ile e-Arşiv Fatura / e-Fatura / Gider Pusulası
 * hukuken ve bicimsel olarak farkli belgelerdir. Metinde bu ifadelerden
 * biri geciyorsa belge turunu buna gore isaretliyoruz; bu, "Fiş No"
 * yerine "Fatura No" kullanilmasi gerektigini belirlemek icin kullanilir.
 */
function findBelgeTuru(lines) {
  const text = lines.join(' ');
  if (E_ARSIV_FATURA_RE.test(text)) return 'E-Arşiv Fatura';
  if (E_FATURA_RE.test(text)) return 'E-Fatura';
  if (GIDER_PUSULASI_RE.test(text)) return 'Gider Pusulası';
  return 'Fiş';
}

const invoiceNoPatterns = [/FATURA\s*NO\s*[:.]?\s*(\S+)/i, /S[Iİ]RA\s*NO\s*[:.]?\s*(\S+)/i];
const fisInlinePatterns = [/F[İI][SŞ]\s*NO\s*[:.]?\s*(\S+)/i, /F[İI][SŞ]\s*[:#]\s*(\S+)/i, /T[İI]S\s*NO\s*[:.]?\s*(\S+)/i];
const fisFallbackPatterns = [/BELGE\s*NO\s*[:.]?\s*(\S+)/i, /EK[UÜ]\s*NO\s*[:.]?\s*(\S+)/i];

function matchFirst(lines, patterns) {
  for (const re of patterns) {
    for (const line of lines) {
      const m = line.match(re);
      if (m) return m[1];
    }
  }
  return null;
}

function findFisNo(lines) {
  // Belge turunden bagimsiz olarak once klasik "FİŞ NO" varyasyonlarina
  // bakilir - bu her zaman en guvenilir kaynaktir (e-Arşiv Fatura olarak
  // basilan bazi fişlerde bile hala ayrica bir "FİŞ NO" satiri bulunur).
  // Hicbiri yoksa (orn. salt e-Fatura formatinda "FİŞ NO" hic olmaz)
  // FATURA NO / Sıra No'ya son care olarak dusulur.
  return findFisNoClassic(lines) || matchFirst(lines, invoiceNoPatterns);
}

function findFisNoClassic(lines) {
  // Oncelik sirasi onemli: "FİŞ NO" her zaman en dogru kaynak, "EKÜ NO"/
  // "BELGE NO" gibi diger kasa numaralari fis no degildir. Bu yuzden once
  // her turlu "FİŞ NO" varyasyonunu (ayni satirda, ayri satirda deger
  // once/sonra) TUM metinde deniyoruz; ancak hicbiri bulunamazsa "EKÜ NO"
  // gibi dusuk oncelikli alanlara dusuyoruz.
  const inline = matchFirst(lines, fisInlinePatterns);
  if (inline) return inline;

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

  return matchFirst(lines, fisFallbackPatterns);
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

// Firma adindan once cikabilen, sirket ismi olmayan belge turu/kopya
// basliklari (orn. "E-Arşiv Fatura", "** İKİNCİ KOPYA **", "Gider Pusulası").
const DOCUMENT_HEADER_RE =
  /E[-\s]?ARŞİV|E[-\s]?ARSIV|FATURA|BİLGİ\s*FİŞİ|BILGI\s*FISI|İKİNCİ\s*KOPYA|IKINCI\s*KOPYA|N[UÜ]SHA|GİDER\s*PUSULASI|GIDER\s*PUSULASI|İRSALİYE|IRSALIYE/i;
// "Teşekkürler", "Hoş geldiniz" gibi karsilama/vedalasma ifadeleri firma
// adindan hemen once ya da sonra basilabiliyor; bunlar firma adinin
// parcasi degildir.
const GREETING_RE = /TE[ŞS]EKK[UÜ]RLER|TEŞEKKÜR\s*EDERİZ|TESEKKUR\s*EDERIZ|HOŞ\s*GELDİNİZ|HOS\s*GELDINIZ/i;
// Bazi zincirler (orn. A101) fisin basina firma adindan ONCE magaza
// adi/kodu ("Mgz Adi : Hazar Bingol / Mgz Kodu : 8990" gibi) basiyor;
// bu bir sube/personel bilgisi olup sirket unvaninin parcasi degildir.
const MAGAZA_KODU_RE = /MGZ\s*AD[Iİ]|MGZ\s*KOD/i;

// Gercek firma adlari (orn. "LC Waikiki Mağazacılık Hiz. Tic. A.Ş.") bazen
// karisik/kucuk harfle basiliyor, bu yuzden buyuk harf orani tek basina
// guvenilir bir gurultu belirteci degil. Ama bir imza/logo kalintisi ya da
// slogan ("Beli Carly", "Oyuncakçınız" gibi) genelde HEM kucuk harf
// agirlikli HEM cok kisa (1-2 kelime) olur; gercek firma adlari ise
// kucuk harfle basilsa bile birden fazla kelimeden olusur. Bu yuzden
// sadece "kucuk harf agirlikli VE cok kisa" olan satirlari eliyoruz.
function looksLikeNoise(text) {
  const upperCount = (text.match(/[A-ZÇĞİÖŞÜ]/g) || []).length;
  const lowerCount = (text.match(/[a-zçğıöşü]/g) || []).length;
  const total = upperCount + lowerCount;
  const mostlyLower = total > 0 && upperCount / total < 0.7;
  const wordCount = (text.match(/[A-Za-zÇĞİÖŞÜçğıöşü]+/g) || []).length;
  return mostlyLower && wordCount < 3;
}

function findFirma(lines) {
  // Fis basindaki ilk anlamli satir(lar) genelde magaza/firma adidir; isim
  // birden fazla satira yayilmis olabilir (orn. "FUNIDO" / "BİLİŞİM" /
  // "TEKNOLOJİLERİ A.Ş." ya da "LC Waikiki Mağazacılık Hiz. Tic. A.Ş." gibi
  // karisik harfle basilmis olabilir - bu yuzden buyuk/kucuk harf kontrolu
  // yapmiyoruz). Adres/vergi/tarih bilgisine varana kadar birbirini izleyen
  // bu satirlari tek bir firma adinda birlestiriyoruz.
  // VKN/VD (vergi dairesi) "V.D", "VD", "V.D." gibi farkli yazilabiliyor;
  // adres kisaltmalari da nokta olsun olmasin ("Mah."/"Mh.", "Cad."/"Cd.",
  // "Sok."/"Sk.") kisa yazilabiliyor.
  const stopRe =
    /(VKN|\bV\.?D\.?\b|VERG[İI]|ADRES|TEL\s*[:.]|\b(MAH|MH|CAD|CD|SOK|SK|BULV|BLV)\.?\b|NO\s*[:.]?\s*\d|\d{2}[.\/-]\d{2}[.\/-]\d{4}|\/[A-ZÇĞİÖŞÜ]+$)/i;
  const nameParts = [];
  for (const line of lines.slice(0, 8)) {
    const trimmed = line.trim();
    // Tek harf/kisa parcalar genelde logo/damga gibi seylerin yanlis
    // okunmasindan gelir (orn. yuvarlak bir mühür ikonu "G" gibi
    // okunabiliyor) - gercek bir firma adi bundan cok daha uzundur.
    if (!trimmed || trimmed.length < 3 || /^\d+$/.test(trimmed)) continue;
    // Adres/vergi/tarih iceren bir satirsa isim burada biter, arama durur.
    if (stopRe.test(trimmed)) break;
    // Belge basligi ("E-Arşiv Fatura", "İkinci Kopya" vb.), karsilama
    // ifadesi ("Teşekkürler" vb.) ya da magaza adi/kodu satiri ise firma
    // adinin parcasi degildir, atla.
    if (DOCUMENT_HEADER_RE.test(trimmed) || GREETING_RE.test(trimmed) || MAGAZA_KODU_RE.test(trimmed) || looksLikeNoise(trimmed)) continue;
    nameParts.push(trimmed);
    if (nameParts.length >= 3) break;
  }
  return nameParts.length ? nameParts.join(' ') : null;
}

// Bilinen firma adi kaliplarina gore Kategori alanini otomatik tahmin
// eder. Sadece cok yaygin/belirgin zincir adlarini kapsar; eslesme yoksa
// kullanicinin kendisi secer (null donup alani bos birakiyoruz).
const KATEGORI_RULES = [
  { re: /MIGROS|\bBIM\b|\bBİM\b|ŞOK\s*MARKET|\bA101\b|CARREFOUR|METRO\s*MARKET|MACROCENTER/i, kategori: 'Gıda' },
  { re: /RESTORAN|RESTAURANT|BURGER|CAFE|KAFE|LOKANTA|PIDE|KEBAP|PASTANE|FIRIN/i, kategori: 'Gıda' },
  { re: /\bSHELL\b|\bOPET\b|\bBP\b|PETROL\s*OFIS|PETROL\s*OFİS|\bTOTAL\b|\bAYGAZ\b|LUKOIL|PO\s*PETROL/i, kategori: 'Ulaşım' },
  { re: /LC\s*WAIKIKI|\bLCW\b|\bVICCO\b|KOŞ\s*AKSESUAR|\bTOYZZ\b|DEFACTO|\bZARA\b|\bH\s*&\s*M\b|\bMANGO\b|\bKOTON\b/i, kategori: 'Giyim' },
  { re: /OFIS\s*1|KIRTASIYE|KIRTASİYE|OFİS\s*1/i, kategori: 'Ofis Malzemesi' },
];

function guessKategori(firma) {
  if (!firma) return null;
  for (const rule of KATEGORI_RULES) {
    if (rule.re.test(firma)) return rule.kategori;
  }
  return null;
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

// Guncel KDV oranlari (Temmuz 2026 itibariyle): %1, %10, %20.
const KDV_RATES = ['1', '10', '20'];
const AMOUNT_TOKEN_RE = new RegExp(AMOUNT_VALUE_RE, 'g');

// OCR bazen "%" isaretini "2" rakamiyla karistirip yapistiriyor: "%20" ->
// "220", "%1." -> "21.", "%10" -> "210" gibi (gercek "%" karakteri hic
// gorunmuyor). Bazi fişlerde %1 orani "01" olarak (bastaki sifirla)
// basiliyor, bu da corrupted halde "201" oluyor. Bu, farkli taramalarda
// tekrarlayan, tahmin edilebilir bir OCR hatasi oldugu icin, gercek "%"
// bulunamazsa bu "cakisik" deseni son care olarak deniyoruz.
const CORRUPTED_PERCENT_LOOKUP = { 21: '1', 201: '1', 210: '10', 220: '20' };
const CORRUPTED_PERCENT_RE = /\b(21|201|210|220)\b/;
// OCR bazen "%" isaretini "X" ya da "Z" harfiyle de karistirabiliyor: "%20"
// -> "X20" (orn. "MIGROS PLASTIK POSET X20") ya da "%10" -> "Z10" (orn.
// "VICCO BAG 34*45 BÜYÜ Z10 *10,00") gibi, hatta "%1" -> "XI" gibi (rakam
// "1" de Romen rakami "I" ile karisiyor). Bunu miktar ifadelerinden
// ("2 x 20,00" gibi bosluklu carpimlardan) ayirt etmek icin harfin hemen
// ardindan bosluksuz oran rakami gelmesini sartkoşuyoruz - gercek carpim
// ifadelerinde X/Z ile sayi arasinda daima bosluk olur.
const CORRUPTED_X_PERCENT_RE = /\b[XZ](1|10|20|I)\b/i;
const CORRUPTED_X_LOOKUP = { 1: '1', 10: '10', 20: '20', i: '1' };

function matchKdvRate(line) {
  const real = line.match(/%\s*(\d{1,2})\b/);
  if (real) {
    // Bazi fişlerde oran bastaki sifirla basiliyor (orn. "%01"); KDV_RATES
    // listesiyle karsilastirmadan once bu sifiri temizliyoruz.
    const normalized = String(Number(real[1]));
    if (KDV_RATES.includes(normalized)) return normalized;
  }
  const corrupted = line.match(CORRUPTED_PERCENT_RE);
  if (corrupted && CORRUPTED_PERCENT_LOOKUP[corrupted[1]]) return CORRUPTED_PERCENT_LOOKUP[corrupted[1]];
  const xCorrupted = line.match(CORRUPTED_X_PERCENT_RE);
  if (xCorrupted) {
    const rate = CORRUPTED_X_LOOKUP[xCorrupted[1].toLowerCase()];
    if (rate) return rate;
  }
  return null;
}

// "% 15 % İndirim" gibi bir indirim satiri, kendi tutarini genelde eksi
// isaretiyle yazdirir (orn. "* -164,99"); ancak OCR bu eksi isaretini bazen
// tamamen kaybediyor ("* 164,99" gibi pozitif gorunuyor). Boyle bir tutarin
// hemen yakininda "İNDİRİM" ifadesi geciyorsa, isareti kaybolmus olsa bile
// bu tutarin aslinda bir indirim (eksi) oldugunu varsayiyoruz.
const INDIRIM_RE = /İ?NDİRİM|INDIRIM/i;
function hasDiscountLabelBetween(lines, indexA, indexB) {
  const from = Math.min(indexA, indexB);
  const to = Math.max(indexA, indexB);
  for (let i = from; i <= to; i++) {
    if (INDIRIM_RE.test(lines[i])) return true;
  }
  return false;
}

// Iki sayidan (buyugu "dahil" ya da "matrah" olabilir) hangisinin hangisi
// oldugunu, verilen KDV oranina gore hesaplanan beklenen KDV tutariyla
// karsilastirarak bulur; ne kadar iyi uydugunu (diff) da dondurur, boylece
// birden fazla aday cift arasinda en iyisi secilebilir.
function analyzeTwoNumbers(rate, a, b) {
  const big = Math.max(a, b);
  const small = Math.min(a, b);
  const kdvIfDahil = (big * rate) / (100 + rate);
  const kdvIfMatrah = (big * rate) / 100;
  const diffDahil = Math.abs(small - kdvIfDahil);
  const diffMatrah = Math.abs(small - kdvIfMatrah);
  if (diffMatrah <= diffDahil) {
    return { diff: diffMatrah, value: { matrah: big, kdv: small, dahil: big + small } };
  }
  return { diff: diffDahil, value: { dahil: big, kdv: small, matrah: big - small } };
}

/**
 * Bir KDV kirilim satirinda bulunan 2-3 sayidan (siralari fis formatina
 * gore degisebiliyor: bazen MATRAH-KDV-DAHIL, bazen DAHIL-KDV) hangisinin
 * "dahil tutar", "matrah" ve "KDV tutari" oldugunu, oran bilgisini
 * kullanarak (dahil = matrah + kdv oldugu icin) kendiliginden dogrular.
 */
function analyzeKdvRow(rate, numbers) {
  if (numbers.length >= 3) {
    // 1) Uc sayi da birbiriyle iliskiliyse (biri digerlerinin toplamina
    // esitse) bu en guvenilir tespittir.
    for (let i = 0; i < numbers.length; i++) {
      const others = numbers.filter((_, idx) => idx !== i);
      if (Math.abs(numbers[i] - (others[0] + others[1])) < 0.05) {
        const dahil = numbers[i];
        const kdv = Math.min(others[0], others[1]);
        const matrah = Math.max(others[0], others[1]);
        return { dahil, matrah, kdv };
      }
    }
    // 2) Uc sayi da iliskili degilse, muhtemelen komsu bir orana ait
    // yabanci bir sayi araya karismistir (orn. onceki satirdaki farkli bir
    // oranin degeri). Ikili kombinasyonlar icinde orana en iyi uyani
    // secip fazlaligi yok sayiyoruz.
    let best = null;
    for (let i = 0; i < numbers.length; i++) {
      for (let j = i + 1; j < numbers.length; j++) {
        const candidate = analyzeTwoNumbers(rate, numbers[i], numbers[j]);
        if (!best || candidate.diff < best.diff) best = candidate;
      }
    }
    return best ? best.value : null;
  }
  if (numbers.length === 2) {
    return analyzeTwoNumbers(rate, numbers[0], numbers[1]).value;
  }
  return null;
}

/**
 * Fişlerde sik gorulen "KDV MATRAH KDV TUTAR KDV DAHİL" ya da "KDV ORANI
 * KDV DAHİL TUTAR KDV" tarzi kirilim tablosunu satir satir tarayip, her
 * guncel KDV orani (%1, %10, %20) icin Matrah/KDV/Toplam(dahil) tutarini
 * cikarir. Bu, kullanicinin paylastigi ornek Excel tablosundaki
 * (TOPLAM TUTAR / MATRAH / KDV, oran bazinda) yapiyla eslesir.
 */
// KDV kirilim tablosunun basladigini gosteren baslik satiri (orn.
// "KDV MATRAH", "KDV Oranı KDV Dahil Tutar KDV", "KDV TUTARI KDV'Lİ TOPLAM").
// Urun satirlarindaki tek basina "% NN" ifadeleriyle karismamasi icin,
// kirilim aramasina bu baslik bulunana KADAR baslamiyoruz.
const KDV_BREAKDOWN_HEADER_RE = /KDV.*(ORANI|MATRAH|TUTAR|DAHİL|DAHIL)|(ORANI|MATRAH|TUTAR|DAHİL|DAHIL).*KDV/i;
const KDV_BREAKDOWN_STOP_RE = /KDV|TOPLAM|ORANI|MATRAH|DAHİL|DAHIL/i;

function findKdvBreakdown(lines) {
  let startIndex = lines.findIndex((l) => KDV_BREAKDOWN_HEADER_RE.test(l));
  if (startIndex === -1) return {};

  const result = {};
  const consumed = new Set();

  for (let i = startIndex; i < lines.length; i++) {
    const rate = matchKdvRate(lines[i]);
    if (!rate) continue;
    if (result[rate]) continue; // ayni oran icin ilk bulunani kullan

    // Ayni satirda tutar(lar) olabilir (orn. "% 20 132.50").
    const numbers = [];
    const sameLineTokens = lines[i].match(AMOUNT_TOKEN_RE);
    if (sameLineTokens) numbers.push(...sameLineTokens.map(parseAmount));

    // Kalan tutarlar (matrah/kdv/dahil) etiketten once ya da sonra, ayri
    // "ciplak" satirlar halinde gelebiliyor (orn. deger satiri oran
    // satirindan once cikabiliyor). En yakin satirdan baslayarak hem ileri
    // hem geri yonde arıyoruz.
    for (const offset of nearOffsets(4)) {
      if (numbers.length >= 3) break;
      const idx = i + offset;
      if (consumed.has(idx) || !lines[idx]) continue;
      if (KDV_BREAKDOWN_STOP_RE.test(lines[idx])) continue;
      const m = lines[idx].trim().match(BARE_AMOUNT_RE);
      if (m) {
        numbers.push(parseAmount(m[1]));
        consumed.add(idx);
      }
    }

    const cleaned = numbers.filter((n) => n !== null);
    if (cleaned.length < 2) continue;

    const analyzed = analyzeKdvRow(Number(rate), cleaned);
    if (analyzed) result[rate] = analyzed;
  }
  return result;
}

/**
 * Fişte ayrı bir KDV kırılım tablosu YOKSA (sadece tek bir TOPKDV varsa),
 * her ürün satırının yanındaki kendi KDV oranını (% 1, % 20 vb.) ve o
 * satırın tutarını kullanarak oran bazında toplam (dahil) tutarları
 * hesaplar. İndirim satırları da kendi oranıyla (genelde eksi işaretli)
 * dahil edilir. Bu, kullanıcının fişteki KDV toplamıyla (TOPKDV) örtüşen
 * bir kırılım üretir.
 */
function findItemLevelKdvSums(lines) {
  const sums = {};
  // Bir satir zaten baska bir oran etiketi tarafindan tutar olarak
  // kullanildiysa, ikinci kez (orn. hem kendi ayri etiketiyle hem de
  // komsu urunun "indirim de dahil et" taramasiyla) sayilmasin diye
  // fonksiyon boyunca paylasilan bir "tuketildi" kumesi tutuyoruz.
  const consumed = new Set();
  for (let i = 0; i < lines.length; i++) {
    const rate = matchKdvRate(lines[i]);
    if (!rate) continue;

    // Once ayni satirda bir tutar var mi bak (orn. "% 10 * 750,00" - oran
    // ve tutar tek satirda birlikte). Yoksa yakin satirlara bak.
    let amount = null;
    let priceIdx = i;
    const sameLineTokens = lines[i].match(AMOUNT_TOKEN_RE);
    if (sameLineTokens) {
      amount = parseAmount(sameLineTokens[sameLineTokens.length - 1]);
    }

    if (amount === null) {
      for (const offset of nearOffsets(2)) {
        const neighborIdx = i + offset;
        const neighbor = lines[neighborIdx];
        if (!neighbor || consumed.has(neighborIdx) || matchKdvRate(neighbor)) continue;
        const m = neighbor.trim().match(BARE_AMOUNT_RE);
        if (m) {
          amount = parseAmount(m[1]);
          priceIdx = neighborIdx;
          consumed.add(neighborIdx);
          // Sadece etiket (oran) satiri ile tutar satirinin ARASINDA (disinda
          // degil) bir İNDİRİM ifadesi varsa eksi kabul et; aksi halde komsu,
          // alakasiz bir urunun indirim etiketi yanlislikla bu tutari da
          // eksiye cevirebiliyordu.
          if (amount > 0 && hasDiscountLabelBetween(lines, i, neighborIdx)) amount = -amount;
          break;
        }
      }
    }
    if (amount === null) continue;
    sums[rate] = (sums[rate] || 0) + amount;

    // Urunun kendi fiyatindan hemen sonra, kendi ayri oran etiketi olmayan
    // bir indirim satiri gelebiliyor (orn. "% 10\nHILDA\n*1.599,90\n*-223,98\n
    // İNDİRİM" - indirimin kendi "% 10" etiketi yok, urununkini paylasiyor).
    // Boyle bir tutari kacirmamak icin fiyattan hemen sonraki 1-2 satira da
    // bakiyoruz; yalnizca aralarinda İNDİRİM ifadesi geciyorsa dahil ediyoruz.
    // "consumed" kontrolu, bu tutarin baska bir satirin KENDI ayri oran
    // etiketi tarafindan zaten sayilmis olmasini (cift sayilmayi) onler.
    for (let offset = 1; offset <= 2; offset++) {
      const discIdx = priceIdx + offset;
      const discLine = lines[discIdx];
      if (!discLine || matchKdvRate(discLine)) break;
      if (consumed.has(discIdx)) continue;
      const dm = discLine.trim().match(BARE_AMOUNT_RE);
      // İndirim etiketi tutarin KENDI satirinda degil, bir onceki ya da bir
      // sonraki satirda basiliyor olabilir (fis formatina gore "İNDİRİM"
      // once ya da sonra gelebiliyor).
      if (dm && hasDiscountLabelBetween(lines, discIdx - 1, discIdx + 1)) {
        const discAmount = parseAmount(dm[1]);
        sums[rate] += discAmount > 0 ? -discAmount : discAmount;
        consumed.add(discIdx);
      }
    }
  }
  return sums;
}

// dahil tutardan (KDV dahil), orani kullanarak matrah ve KDV tutarini turetir.
function deriveFromDahil(rate, dahil) {
  const matrah = dahil / (1 + rate / 100);
  const kdv = dahil - matrah;
  return {
    dahil: Math.round(dahil * 100) / 100,
    matrah: Math.round(matrah * 100) / 100,
    kdv: Math.round(kdv * 100) / 100,
  };
}

/**
 * Fişte hicbir KDV orani isareti (%1/%10/%20) metinde taninamadiginda
 * (orn. tek kalemli bir fişte "%" isareti tamamen kaybolup geriye
 * "20 * 205,00" gibi bir miktar ifadesinden ayirt edilemeyen ciplak bir
 * sayi kaliyorsa) son care olarak, zaten guvenilir sekilde okunan
 * TOPLAM/TOPKDV degerlerinin HANGI tek orana matematiksel olarak tam
 * uydugunu kontrol eder. Metni tahmin etmek yerine saf aritmetik
 * kullandigi icin (dahil = matrah + matrah*oran/100), bu digerlerinden
 * daha guvenilir bir son caredir; uyum cok siki (0.03 TL) tutuluyor ki
 * karisik/birden fazla oranli fişlerde yanlislikla bir oran secilmesin.
 */
function inferSingleRateFromTotals(toplam, kdv) {
  if (toplam === null || kdv === null || toplam <= 0) return null;
  for (const rate of KDV_RATES) {
    const expectedKdv = (toplam * Number(rate)) / (100 + Number(rate));
    if (Math.abs(kdv - expectedKdv) < 0.03) {
      return { [rate]: deriveFromDahil(Number(rate), toplam) };
    }
  }
  return null;
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

  const belgeTuru = findBelgeTuru(lines);
  let kdvKirilim = findKdvBreakdown(lines);

  // Fişte ayrı bir KDV kırılım tablosu yoksa, ürün satırlarındaki kendi
  // KDV oranlarını kullanarak oran bazında hesapla.
  if (Object.keys(kdvKirilim).length === 0) {
    const itemSums = findItemLevelKdvSums(lines);
    const derived = {};
    for (const [rate, dahil] of Object.entries(itemSums)) {
      derived[rate] = deriveFromDahil(Number(rate), dahil);
    }
    if (Object.keys(derived).length > 0) kdvKirilim = derived;
  }

  // Hicbir oran isareti metinde bulunamadiysa (orn. tek kalemli bir fişte
  // "%" isareti tamamen kaybolmussa), guvenilir TOPLAM/TOPKDV degerlerinin
  // hangi tek orana matematiksel olarak uydugunu kontrol et.
  if (Object.keys(kdvKirilim).length === 0) {
    const inferred = inferSingleRateFromTotals(toplam, kdv);
    if (inferred) kdvKirilim = inferred;
  }

  // Fiş tek bir oran iceriyorsa (kirilimda tek anahtar varsa) ve bu oran
  // guvenilir TOPLAM/TOPKDV ile matematiksel olarak tam uyuyorsa, o zaman
  // fişin TAMAMI bu tek orana tabidir - dahil tutar TOPLAM'in kendisi
  // olmali. Bu durumda kirilimi guvenilir toplam/kdv ile yeniden hesaplayip
  // ustune yaziyoruz; boylece urun satirindan (yanlis siralamadan dolayi)
  // kismen/yanlis okunmus bir dahil tutar (orn. TOPKDV'nin kendi tutarini
  // yanlislikla urune ait sanip) TOPLAM'i degil BASKA bir sayiyi yansitmis
  // olsa bile duzeltilmis olur.
  const kirilimKeys = Object.keys(kdvKirilim);
  if (kirilimKeys.length === 1 && toplam !== null && kdv !== null) {
    const rate = Number(kirilimKeys[0]);
    const expectedKdv = (toplam * rate) / (100 + rate);
    if (Math.abs(kdv - expectedKdv) < 0.03) {
      kdvKirilim = { [kirilimKeys[0]]: deriveFromDahil(rate, toplam) };
    }
  }

  const firma = findFirma(lines);

  return {
    belgeTuru,
    tarih: findDate(lines),
    saat: findTime(lines),
    firma,
    toplam,
    kdv,
    fisNo: findFisNo(lines),
    odemeYontemi: findPaymentMethod(lines),
    kalemler: findKalemler(lines),
    kdvDetay: findKdvDetay(lines),
    kategori: guessKategori(firma),
    toplam1: kdvKirilim['1']?.dahil ?? null,
    matrah1: kdvKirilim['1']?.matrah ?? null,
    kdv1: kdvKirilim['1']?.kdv ?? null,
    toplam10: kdvKirilim['10']?.dahil ?? null,
    matrah10: kdvKirilim['10']?.matrah ?? null,
    kdv10: kdvKirilim['10']?.kdv ?? null,
    toplam20: kdvKirilim['20']?.dahil ?? null,
    matrah20: kdvKirilim['20']?.matrah ?? null,
    kdv20: kdvKirilim['20']?.kdv ?? null,
    hamMetin: rawText,
  };
}

// Regex/spatial eslesme bir deger BULMUS olsa bile, o deger aritmetik
// olarak sacma/tutarsizsa (orn. TOPLAM/TOPKDV'nin yer degistirmis olmasi,
// kirilim toplaminin genel toplamla uyusmamasi) ilgili alani "supheli"
// isaretler. Bu, "regex hic bulamadi" durumunun aksine "regex bir sey
// buldu ama yanlis olabilir" durumunu yakalamak icin kullanilir - yedek
// yapay zeka katmani sadece eksik degil, supheli alanlar icin de devreye
// girsin diye. Donus degeri [{ field, reason }] - reason kullaniciya
// "neden supheli" gosterebilmek icin.
function findAmbiguousFields(fields) {
  const reasons = new Map();
  const flag = (field, reason) => {
    if (!reasons.has(field)) reasons.set(field, new Set());
    reasons.get(field).add(reason);
  };

  const { toplam, kdv } = fields;

  if (toplam !== null && toplam <= 0) flag('toplam', 'Toplam tutar sıfır veya negatif görünüyor');
  if (kdv !== null && kdv < 0) flag('kdv', 'KDV tutarı negatif görünüyor');

  if (toplam !== null && kdv !== null && toplam > 0) {
    if (kdv > toplam) {
      // KDV, toplamdan buyuk olamaz - TOPLAM/TOPKDV yer degistirmis olabilir.
      flag('toplam', 'KDV, toplamdan büyük çıktı (Toplam/KDV yer değiştirmiş olabilir)');
      flag('kdv', 'KDV, toplamdan büyük çıktı (Toplam/KDV yer değiştirmiş olabilir)');
    } else {
      const hasBreakdown = KDV_RATES.some((r) => fields[`kdv${r}`] !== null && fields[`kdv${r}`] !== undefined);
      if (!hasBreakdown && kdv > 0) {
        // Kirilim tablosu yoksa (tek bir toplam KDV varsa), KDV'nin toplam
        // icindeki orani bilinen oranlardan (%1/%10/%20) hicbirine
        // yakin degilse degerler supheli sayilir.
        const tolerance = Math.max(0.5, toplam * 0.02);
        const matchesAnyRate = KDV_RATES.some((rate) => {
          const expectedKdv = (toplam * Number(rate)) / (100 + Number(rate));
          return Math.abs(kdv - expectedKdv) < tolerance;
        });
        if (!matchesAnyRate) {
          const reason = 'KDV, toplamın yüzdesi olarak bilinen hiçbir orana (%1/%10/%20) uymuyor';
          flag('toplam', reason);
          flag('kdv', reason);
        }
      }
    }
  }

  const breakdownExists = KDV_RATES.some((r) => fields[`toplam${r}`] !== null && fields[`toplam${r}`] !== undefined);
  if (breakdownExists) {
    const breakdownToplam = KDV_RATES.reduce((sum, r) => sum + (fields[`toplam${r}`] || 0), 0);
    const breakdownKdv = KDV_RATES.reduce((sum, r) => sum + (fields[`kdv${r}`] || 0), 0);
    if (toplam !== null && Math.abs(breakdownToplam - toplam) > Math.max(0.5, toplam * 0.02)) {
      flag('toplam', 'Kırılım tablosundaki tutarların toplamı genel toplamla uyuşmuyor');
    }
    if (kdv !== null && Math.abs(breakdownKdv - kdv) > Math.max(0.1, kdv * 0.05)) {
      flag('kdv', 'Kırılım tablosundaki KDV tutarlarının toplamı genel KDV ile uyuşmuyor');
    }

    // Her oranin KENDI icinde tutarli olup olmadigini kontrol et: dahil
    // tutar = matrah + KDV olmali, ve KDV = matrah * oran/100 olmali.
    // Toplamlar tutsa bile tek tek satirlar (orn. yanlis urun esleme
    // yuzunden) hatali olabilir.
    for (const rate of KDV_RATES) {
      const dahil = fields[`toplam${rate}`];
      const matrah = fields[`matrah${rate}`];
      const rateKdv = fields[`kdv${rate}`];
      if (dahil === null || matrah === null || rateKdv === null) continue;
      if (Math.abs(dahil - (matrah + rateKdv)) > Math.max(0.5, dahil * 0.02)) {
        flag('kdv', `%${rate} satırında dahil tutar, matrah + KDV toplamıyla uyuşmuyor`);
      }
      const expectedRateKdv = (matrah * Number(rate)) / 100;
      if (Math.abs(rateKdv - expectedRateKdv) > Math.max(0.5, expectedRateKdv * 0.05)) {
        flag('kdv', `%${rate} satırındaki KDV tutarı, matrahın %${rate}'i ile uyuşmuyor`);
      }
    }
  }

  if (fields.tarih) {
    const m = fields.tarih.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) {
      flag('tarih', 'Tarih formatı tanınamadı');
    } else {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const year = Number(m[3]);
      if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) {
        flag('tarih', 'Tarih geçersiz görünüyor');
      } else {
        const date = new Date(year, month - 1, day);
        if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
          flag('tarih', 'Tarih gelecekte görünüyor');
        }
      }
    }
  }

  if (fields.firma) {
    const trimmed = fields.firma.trim();
    const letterCount = (trimmed.match(/\p{L}/gu) || []).length;
    if (trimmed.length < 3 || letterCount < 2) {
      flag('firma', 'Firma adı okunamamış veya anlamsız görünüyor');
    }
  }

  return Array.from(reasons.entries()).map(([field, reasonSet]) => ({
    field,
    reason: Array.from(reasonSet).join('; '),
  }));
}

module.exports = { parseReceiptText, parseAmount, findAmbiguousFields };

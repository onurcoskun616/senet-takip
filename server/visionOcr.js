const API_KEY = process.env.GOOGLE_VISION_API_KEY;
const ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

/**
 * Vision bazen fisin blok/paragraf sirasini gorsel (yukaridan asagiya)
 * siraya gore degil, kendi ic tespit sirasina gore dondurur - bu da
 * firma adi / adres gibi bilgilerin fis uzerindeki gercek sirasindan
 * farkli cikmasina yol acar. Paragraflari kendi bounding box konumlarina
 * (once yukaridan asagiya, sonra soldan saga) gore yeniden sirlayarak
 * fisin gercek gorsel okuma sirasini yeniden olusturuyoruz.
 */
function reconstructReadingOrder(page) {
  const paragraphs = [];

  for (const block of page.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      let text = '';
      for (const word of paragraph.words || []) {
        for (const symbol of word.symbols || []) {
          text += symbol.text;
          const breakType = symbol.property?.detectedBreak?.type;
          if (breakType === 'LINE_BREAK' || breakType === 'EOL_SURE_SPACE') {
            text += '\n';
          } else if (breakType === 'SPACE') {
            text += ' ';
          }
        }
        if (!text.endsWith('\n') && !text.endsWith(' ')) text += ' ';
      }

      const vertices = paragraph.boundingBox?.vertices || [];
      const ys = vertices.map((v) => v.y || 0);
      const xs = vertices.map((v) => v.x || 0);
      paragraphs.push({
        text: text.trim(),
        topY: ys.length ? Math.min(...ys) : 0,
        leftX: xs.length ? Math.min(...xs) : 0,
      });
    }
  }

  // Ayni satirdaki paragraflari (topY farki kucukse) soldan saga sirala,
  // farkli satirlardaki paragraflari yukaridan asagiya sirala.
  paragraphs.sort((a, b) => {
    if (Math.abs(a.topY - b.topY) > 15) return a.topY - b.topY;
    return a.leftX - b.leftX;
  });

  const nonEmpty = paragraphs.filter((p) => p.text);
  return { text: nonEmpty.map((p) => p.text).join('\n'), paragraphs: nonEmpty };
}

/**
 * Verilen resim buffer'ini Google Cloud Vision API'ye gonderip icindeki
 * tum metni ve (varsa) her paragrafin fis uzerindeki konumunu dondurur.
 * Konum bilgisi, "TOPLAM"/"KDV" gibi etiketlere metin sirasindan degil
 * gercek gorsel yakinliktan en dogru tutari eslestirmek icin kullanilir.
 */
async function extractText(imageBuffer) {
  if (!API_KEY) {
    throw new Error(
      'GOOGLE_VISION_API_KEY tanimli degil. .env dosyasina Google Vision API anahtarinizi ekleyin (bkz. README.md).'
    );
  }

  const body = {
    requests: [
      {
        image: { content: imageBuffer.toString('base64') },
        // DOCUMENT_TEXT_DETECTION, fis gibi yogun/dokuman metinlerinde
        // TEXT_DETECTION'a gore daha iyi blok/paragraf yapisi cikarir.
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['tr'] },
      },
    ],
  };

  const response = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || 'Google Vision API istegi basarisiz oldu.');
  }

  const result = data.responses?.[0];
  if (result?.error) {
    throw new Error(result.error.message);
  }

  const page = result?.fullTextAnnotation?.pages?.[0];
  if (page) {
    const reordered = reconstructReadingOrder(page);
    if (reordered.text) return reordered;
  }

  return { text: result?.fullTextAnnotation?.text || '', paragraphs: [] };
}

module.exports = { extractText };

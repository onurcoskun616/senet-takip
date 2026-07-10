const API_KEY = process.env.GOOGLE_VISION_API_KEY;
const ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

/**
 * Verilen resim buffer'ini Google Cloud Vision API'ye gonderip
 * icindeki tum metni (fis uzerindeki yazilar) dondurur.
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
        features: [{ type: 'TEXT_DETECTION' }],
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

  return result?.fullTextAnnotation?.text || '';
}

module.exports = { extractText };

const Anthropic = require('@anthropic-ai/sdk');
const { findAmbiguousFields } = require('./receiptParser');

// Regex tabanli ayiklama basarisiz/belirsiz kaldiginda devreye giren yedek
// katman: OCR ham metnini (ve varsa fisin kirpilmis fotografini) Claude
// Haiku 4.5'e gonderip iki durumda alan tamamlar/duzeltir:
//   1. Eksik (regex hic bulamadi)   -> AI'nin buldugu deger kabul edilir.
//   2. Supheli (regex bir sey buldu ama aritmetik olarak tutarsiz, orn.
//      TOPLAM/TOPKDV yer degistirmis olabilir) -> gorsel varsa AI, metin
//      ile fotografi karsilastirip gercek degeri belirlemeye calisir ve
//      onun sonucu regex'in supheli degerinin yerini alir.
// Regex'in supheli SAYILMAYAN (tutarli) degerlerine hicbir sekilde
// dokunulmaz.

const MODEL = 'claude-haiku-4-5';

const CORE_FIELDS = ['tarih', 'saat', 'firma', 'toplam', 'kdv', 'fisNo', 'odemeYontemi'];

const EXTRACT_TOOL = {
  name: 'fis_alanlarini_bildir',
  description:
    'Türk yazar kasa fişi/faturasının OCR ile okunmuş ham metninden (ve varsa fotoğrafından) çıkarılan alanları bildirir.',
  input_schema: {
    type: 'object',
    properties: {
      tarih: { type: 'string', description: 'Fiş tarihi, GG.AA.YYYY formatında.' },
      saat: { type: 'string', description: 'Fiş saati, SS:DD formatında.' },
      firma: { type: 'string', description: 'Fişi kesen mağaza/firma adı.' },
      toplam: { type: 'number', description: 'Fişin genel toplam tutarı (TL), ondalık nokta ile.' },
      kdv: { type: 'number', description: 'Fişin toplam KDV tutarı (TL), ondalık nokta ile. KDV, toplamdan asla büyük olamaz.' },
      fisNo: { type: 'string', description: 'Fiş/fatura/sıra numarası.' },
      odemeYontemi: {
        type: 'string',
        enum: ['Nakit', 'Kredi Kartı', 'Temassız Kart', 'Diğer'],
        description: 'Ödeme yöntemi.',
      },
    },
  },
};

function buildSystemPrompt(hasImage) {
  const base =
    'Sen bir Türk yazar kasa fişi/faturası OCR alan çıkarım asistanısın. ' +
    'fis_alanlarini_bildir aracıyla bildir. ' +
    'Açıkça yer almayan veya emin olamadığın bir alanı response içine hiç ekleme; tahmin uydurma.';
  if (!hasImage) return base;
  return (
    base +
    ' Sana hem OCR ham metni hem de fişin fotoğrafı verilecek. OCR metninin satır sırası veya ' +
    'etiket/değer eşleşmesi (örn. TOPLAM ve KDV tutarlarının yerinin karışması) hatalı olabilir; ' +
    'bu yüzden görseldeki gerçek fiziksel yerleşimi esas al, OCR metnini sadece yardımcı ipucu olarak kullan.'
  );
}

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

function isMissing(value) {
  return value === null || value === undefined || value === '';
}

async function extractFieldsWithAI(rawText, imageBuffer) {
  const anthropic = getClient();
  if (!anthropic) return null;

  const content = [];
  if (imageBuffer) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: imageBuffer.toString('base64') },
    });
  }
  content.push({
    type: 'text',
    text: imageBuffer
      ? `Yukarıdaki görsel bu fişin fotoğrafıdır. Aşağıda ise aynı fişin Google Vision OCR ile okunmuş ham metni var:\n\n${rawText}`
      : `Fiş OCR metni:\n\n${rawText}`,
  });

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: buildSystemPrompt(Boolean(imageBuffer)),
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
      messages: [{ role: 'user', content }],
    });
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    return toolUse ? toolUse.input : null;
  } catch (err) {
    console.error('AI yedek ayrıştırma hatası:', err.message);
    return null;
  }
}

// Regex sonuclarinda eksik kalan veya supheli (aritmetik olarak tutarsiz)
// CORE_FIELDS alanlarini, gerekirse AI yedegiyle (goruntu varsa gorsel
// karsilastirmayla) tamamlar/duzeltir. Regex'in tutarli buldugu alanlara
// dokunmaz.
async function applyAiFallback(fields, rawText, imageBuffer) {
  const missingFields = CORE_FIELDS.filter((key) => isMissing(fields[key]));
  const suspiciousFields = findAmbiguousFields(fields).filter((key) => CORE_FIELDS.includes(key));

  if (missingFields.length === 0 && suspiciousFields.length === 0) {
    return { fields, aiDestekli: false, aiAlanlar: [] };
  }

  const aiFields = await extractFieldsWithAI(rawText, imageBuffer);
  if (!aiFields) {
    return { fields, aiDestekli: false, aiAlanlar: [] };
  }

  const merged = { ...fields };
  const touched = [];
  for (const key of new Set([...missingFields, ...suspiciousFields])) {
    if (!isMissing(aiFields[key]) && aiFields[key] !== merged[key]) {
      merged[key] = aiFields[key];
      touched.push(key);
    }
  }
  return { fields: merged, aiDestekli: touched.length > 0, aiAlanlar: touched };
}

module.exports = { applyAiFallback };

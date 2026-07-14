const Anthropic = require('@anthropic-ai/sdk');

// Regex tabanli ayiklama basarisiz/belirsiz kaldiginda devreye giren yedek
// katman: OCR ham metnini Claude Haiku 4.5'e gonderip eksik kalan temel
// alanlari tamamlatir. Sadece regex'in bulamadigi alanlari doldurur -
// regex zaten bir deger bulmussa (spatial eslesme dahil) o degere dokunmaz.

const MODEL = 'claude-haiku-4-5';

const CORE_FIELDS = ['tarih', 'saat', 'firma', 'toplam', 'kdv', 'fisNo', 'odemeYontemi'];

const EXTRACT_TOOL = {
  name: 'fis_alanlarini_bildir',
  description:
    'Türk yazar kasa fişi/faturasının OCR ile okunmuş ham metninden çıkarılan alanları bildirir.',
  input_schema: {
    type: 'object',
    properties: {
      tarih: { type: 'string', description: 'Fiş tarihi, GG.AA.YYYY formatında.' },
      saat: { type: 'string', description: 'Fiş saati, SS:DD formatında.' },
      firma: { type: 'string', description: 'Fişi kesen mağaza/firma adı.' },
      toplam: { type: 'number', description: 'Fişin genel toplam tutarı (TL), ondalık nokta ile.' },
      kdv: { type: 'number', description: 'Fişin toplam KDV tutarı (TL), ondalık nokta ile.' },
      fisNo: { type: 'string', description: 'Fiş/fatura/sıra numarası.' },
      odemeYontemi: {
        type: 'string',
        enum: ['Nakit', 'Kredi Kartı', 'Temassız Kart', 'Diğer'],
        description: 'Ödeme yöntemi.',
      },
    },
  },
};

const SYSTEM_PROMPT =
  'Sen bir Türk yazar kasa fişi/faturası OCR alan çıkarım asistanısın. ' +
  'Sana verilen ham OCR metnini oku ve fis_alanlarini_bildir aracıyla bildir. ' +
  'Metinde açıkça yer almayan veya emin olamadığın bir alanı response içine hiç ekleme; tahmin uydurma.';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

function isMissing(value) {
  return value === null || value === undefined || value === '';
}

function needsAiFallback(fields) {
  return CORE_FIELDS.some((key) => isMissing(fields[key]));
}

async function extractFieldsWithAI(rawText) {
  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
      messages: [{ role: 'user', content: `Fiş OCR metni:\n\n${rawText}` }],
    });
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    return toolUse ? toolUse.input : null;
  } catch (err) {
    console.error('AI yedek ayrıştırma hatası:', err.message);
    return null;
  }
}

// Regex sonuclarinda eksik kalan CORE_FIELDS alanlarini, gerekirse AI
// yedegiyle tamamlar. Regex'in zaten doldurdugu alanlara dokunmaz.
async function applyAiFallback(fields, rawText) {
  if (!needsAiFallback(fields)) {
    return { fields, aiDestekli: false };
  }

  const aiFields = await extractFieldsWithAI(rawText);
  if (!aiFields) {
    return { fields, aiDestekli: false };
  }

  const merged = { ...fields };
  let usedAi = false;
  for (const key of CORE_FIELDS) {
    if (isMissing(merged[key]) && !isMissing(aiFields[key])) {
      merged[key] = aiFields[key];
      usedAi = true;
    }
  }
  return { fields: merged, aiDestekli: usedAi };
}

module.exports = { applyAiFallback };

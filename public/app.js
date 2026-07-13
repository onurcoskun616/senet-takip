const fileInput = document.getElementById('fileInput');
const statusSection = document.getElementById('statusSection');
const statusText = document.getElementById('statusText');
const formSection = document.getElementById('formSection');
const formTitle = document.getElementById('formTitle');
const formHint = document.getElementById('formHint');
const submitBtn = document.getElementById('submitBtn');
const receiptForm = document.getElementById('receiptForm');
const rawTextEl = document.getElementById('rawText');
const cancelBtn = document.getElementById('cancelBtn');
const exportBtn = document.getElementById('exportBtn');
const receiptsBody = document.getElementById('receiptsBody');
const totalSummary = document.getElementById('totalSummary');
const photoPreview = document.getElementById('photoPreview');
const photoLink = document.getElementById('photoLink');

let currentRawText = '';
let currentFotoDosya = '';
let editingId = null;
let receiptsCache = [];

// Kaydedilmis bir fis (DB'den, snake_case alan adlariyla) ile OCR
// tarama sonucu (camelCase) ayni forma doldurulabilsin diye ceviri yapar.
function dbRowToFields(r) {
  const fields = {
    tarih: r.tarih,
    saat: r.saat,
    firma: r.firma,
    toplam: r.toplam,
    kdv: r.kdv,
    odemeYontemi: r.odeme_yontemi,
    belgeTuru: r.belge_turu,
    fisNo: r.fis_no,
    kalemler: r.kalemler,
    kdvDetay: r.kdv_detay,
    kategori: r.kategori,
    notlar: r.notlar,
    hamMetin: r.ham_metin,
    fotoDosya: r.foto_dosya,
  };
  for (const rate of ['1', '10', '20']) {
    fields[`toplam${rate}`] = r[`toplam_${rate}`];
    fields[`matrah${rate}`] = r[`matrah_${rate}`];
    fields[`kdv${rate}`] = r[`kdv_${rate}`];
  }
  return fields;
}

function resetFormMode() {
  editingId = null;
  formTitle.textContent = 'Fiş Bilgilerini Kontrol Edin';
  formHint.textContent = 'OCR ile okunan bilgileri kontrol edip gerekirse düzeltin, sonra kaydedin.';
  submitBtn.textContent = 'Kaydet';
}

function startEdit(r) {
  resetFormMode();
  fillForm(dbRowToFields(r));
  editingId = r.id;
  formTitle.textContent = 'Fişi Düzenle';
  formHint.textContent = 'Bilgileri düzenleyip güncelleyin.';
  submitBtn.textContent = 'Güncelle';
  formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const belgeTuruSelect = document.getElementById('belgeTuruSelect');
const fisNoLabel = document.getElementById('fisNoLabel');

function updateFisNoLabel() {
  const isFatura = belgeTuruSelect.value !== 'Fiş';
  fisNoLabel.firstChild.textContent = isFatura ? 'Fatura No' : 'Fiş No';
}

belgeTuruSelect.addEventListener('change', updateFisNoLabel);

function showStatus(text) {
  statusText.textContent = text;
  statusSection.classList.remove('hidden');
  formSection.classList.add('hidden');
}

function hideStatus() {
  statusSection.classList.add('hidden');
}

function fillForm(fields) {
  receiptForm.tarih.value = fields.tarih || '';
  receiptForm.saat.value = fields.saat || '';
  receiptForm.firma.value = fields.firma || '';
  receiptForm.toplam.value = fields.toplam ?? '';
  receiptForm.kdv.value = fields.kdv ?? '';
  receiptForm.odemeYontemi.value = fields.odemeYontemi || '';
  receiptForm.belgeTuru.value = fields.belgeTuru || 'Fiş';
  receiptForm.fisNo.value = fields.fisNo || '';
  receiptForm.kalemler.value = fields.kalemler || '';
  receiptForm.kdvDetay.value = fields.kdvDetay || '';
  for (const rate of ['1', '10', '20']) {
    receiptForm[`toplam${rate}`].value = fields[`toplam${rate}`] ?? '';
    receiptForm[`matrah${rate}`].value = fields[`matrah${rate}`] ?? '';
    receiptForm[`kdv${rate}`].value = fields[`kdv${rate}`] ?? '';
  }
  receiptForm.kategori.value = fields.kategori || '';
  receiptForm.notlar.value = fields.notlar || '';
  currentRawText = fields.hamMetin || '';
  rawTextEl.textContent = currentRawText;
  currentFotoDosya = fields.fotoDosya || '';
  if (currentFotoDosya) {
    photoLink.href = `/api/receipts/photos/${currentFotoDosya}`;
    photoPreview.classList.remove('hidden');
  } else {
    photoPreview.classList.add('hidden');
  }
  updateFisNoLabel();
  formSection.classList.remove('hidden');
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  resetFormMode();
  showStatus('Fiş okunuyor, lütfen bekleyin...');

  const formData = new FormData();
  formData.append('fis', file);

  try {
    const res = await fetch('/api/receipts/scan', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fiş okunamadı.');

    hideStatus();
    fillForm(data.fields);
  } catch (err) {
    hideStatus();
    alert('Hata: ' + err.message);
  } finally {
    fileInput.value = '';
  }
});

cancelBtn.addEventListener('click', () => {
  formSection.classList.add('hidden');
  receiptForm.reset();
  resetFormMode();
  updateFisNoLabel();
  currentFotoDosya = '';
  photoPreview.classList.add('hidden');
});

receiptForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(receiptForm);
  const payload = Object.fromEntries(formData.entries());
  payload.hamMetin = currentRawText;
  payload.fotoDosya = currentFotoDosya;

  const url = editingId ? `/api/receipts/${editingId}` : '/api/receipts';
  const method = editingId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Kaydedilemedi.');
    }
    receiptForm.reset();
    resetFormMode();
    updateFisNoLabel();
    formSection.classList.add('hidden');
    await loadReceipts();
  } catch (err) {
    alert('Hata: ' + err.message);
  }
});

exportBtn.addEventListener('click', () => {
  window.location.href = '/api/receipts/export/excel';
});

function formatMoney(n) {
  if (n === null || n === undefined) return '-';
  return Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

async function loadReceipts() {
  const res = await fetch('/api/receipts');
  const rows = await res.json();
  receiptsCache = rows;

  receiptsBody.innerHTML = '';
  let total = 0;

  for (const r of rows) {
    total += Number(r.toplam) || 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.tarih) || '-'}</td>
      <td>${escapeHtml(r.firma) || '-'}</td>
      <td>${formatMoney(r.toplam)}</td>
      <td>${formatMoney(r.kdv)}</td>
      <td>${escapeHtml(r.belge_turu) || 'Fiş'}</td>
      <td>${escapeHtml(r.fis_no) || '-'}</td>
      <td>${escapeHtml(r.kategori) || '-'}</td>
      <td>${r.foto_dosya ? `<a href="/api/receipts/photos/${encodeURIComponent(r.foto_dosya)}" target="_blank" rel="noopener" title="Fotoğrafı Gör">📷</a>` : ''}</td>
      <td><button class="btn-edit" data-id="${r.id}" title="Düzenle">✏️</button></td>
      <td><button class="btn-delete" data-id="${r.id}" title="Sil">🗑</button></td>
    `;
    receiptsBody.appendChild(tr);
  }

  totalSummary.textContent = rows.length ? `${rows.length} fiş · Toplam: ${formatMoney(total)}` : '';

  document.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = receiptsCache.find((r) => r.id === Number(btn.dataset.id));
      if (row) startEdit(row);
    });
  });

  document.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Bu fişi silmek istediğinize emin misiniz?')) return;
      await fetch(`/api/receipts/${btn.dataset.id}`, { method: 'DELETE' });
      if (editingId === Number(btn.dataset.id)) {
        formSection.classList.add('hidden');
        receiptForm.reset();
        resetFormMode();
      }
      await loadReceipts();
    });
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

loadReceipts();

const fileInput = document.getElementById('fileInput');
const statusSection = document.getElementById('statusSection');
const statusText = document.getElementById('statusText');
const formSection = document.getElementById('formSection');
const receiptForm = document.getElementById('receiptForm');
const rawTextEl = document.getElementById('rawText');
const cancelBtn = document.getElementById('cancelBtn');
const exportBtn = document.getElementById('exportBtn');
const receiptsBody = document.getElementById('receiptsBody');
const totalSummary = document.getElementById('totalSummary');

let currentRawText = '';

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
  currentRawText = fields.hamMetin || '';
  rawTextEl.textContent = currentRawText;
  updateFisNoLabel();
  formSection.classList.remove('hidden');
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;

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
  updateFisNoLabel();
});

receiptForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(receiptForm);
  const payload = Object.fromEntries(formData.entries());
  payload.hamMetin = currentRawText;

  try {
    const res = await fetch('/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Kaydedilemedi.');
    }
    receiptForm.reset();
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
      <td><button class="btn-delete" data-id="${r.id}" title="Sil">🗑</button></td>
    `;
    receiptsBody.appendChild(tr);
  }

  totalSummary.textContent = rows.length ? `${rows.length} fiş · Toplam: ${formatMoney(total)}` : '';

  document.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Bu fişi silmek istediğinize emin misiniz?')) return;
      await fetch(`/api/receipts/${btn.dataset.id}`, { method: 'DELETE' });
      await loadReceipts();
    });
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

loadReceipts();

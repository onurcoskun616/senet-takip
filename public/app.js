const fileInput = document.getElementById('fileInput');
const batchFileInput = document.getElementById('batchFileInput');
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
const aiFallbackNote = document.getElementById('aiFallbackNote');

let currentRawText = '';
let currentFotoDosya = '';
let editingId = null;
let receiptsCache = [];
let scanQueue = [];
let scanQueueIndex = 0;

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
  if (fields.aiDestekli && fields.aiAlanlar && fields.aiAlanlar.length) {
    const labels = { tarih: 'Tarih', saat: 'Saat', firma: 'Firma', toplam: 'Toplam', kdv: 'KDV', fisNo: 'Fiş No', odemeYontemi: 'Ödeme Yöntemi' };
    const alanlar = fields.aiAlanlar.map((k) => labels[k] || k).join(', ');
    aiFallbackNote.textContent = `🤖 Şu alanlar OCR yerine yedek yapay zeka modeliyle tamamlandı/düzeltildi, lütfen kontrol edin: ${alanlar}`;
    aiFallbackNote.classList.remove('hidden');
  } else {
    aiFallbackNote.classList.add('hidden');
  }
  updateFisNoLabel();
  formSection.classList.remove('hidden');
}

// Kuyruktaki fotograflar bittiginde form baslik/ipucunu normale dondurur.
function updateBatchProgress() {
  if (scanQueue.length > 1) {
    formHint.textContent = `OCR ile okunan bilgileri kontrol edip gerekirse düzeltin, sonra kaydedin. (Fiş ${scanQueueIndex + 1} / ${scanQueue.length})`;
  }
}

// Kuyrukta sirada bekleyen bir sonraki fotografi tarar; hicbir sey
// kalmadiysa kuyrugu temizler ve formu kapatir.
async function scanNextInQueue() {
  if (scanQueueIndex >= scanQueue.length) {
    scanQueue = [];
    scanQueueIndex = 0;
    formSection.classList.add('hidden');
    return;
  }

  const file = scanQueue[scanQueueIndex];
  resetFormMode();
  showStatus(`Fiş okunuyor, lütfen bekleyin... (${scanQueueIndex + 1}/${scanQueue.length})`);

  const formData = new FormData();
  formData.append('fis', file);

  try {
    const res = await fetch('/api/receipts/scan', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fiş okunamadı.');

    hideStatus();
    fillForm(data.fields);
    updateBatchProgress();
  } catch (err) {
    hideStatus();
    alert(`Hata (${scanQueueIndex + 1}/${scanQueue.length}): ${err.message}`);
    scanQueueIndex += 1;
    await scanNextInQueue();
  }
}

function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  scanQueue = files;
  scanQueueIndex = 0;
  scanNextInQueue();
}

fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
  fileInput.value = '';
});

batchFileInput.addEventListener('change', () => {
  handleFiles(batchFileInput.files);
  batchFileInput.value = '';
});

cancelBtn.addEventListener('click', async () => {
  receiptForm.reset();
  resetFormMode();
  updateFisNoLabel();
  currentFotoDosya = '';
  photoPreview.classList.add('hidden');
  aiFallbackNote.classList.add('hidden');

  if (scanQueue.length > 0) {
    scanQueueIndex += 1;
    await scanNextInQueue();
    return;
  }
  formSection.classList.add('hidden');
});

// Ayni Fiş No + Firma + Tarih ile zaten kayitli bir fis olup olmadigini
// kontrol eder (duzenlenmekte olan kaydin kendisi haric). Yalnizca
// ucunun de dolu oldugu durumlarda kontrol eder, aksi halde bos
// alanlar rastgele eslesip yanlis uyari verebilir.
function findDuplicate(payload) {
  if (!payload.fisNo || !payload.firma || !payload.tarih) return null;
  return receiptsCache.find((r) =>
    r.id !== editingId &&
    (r.fis_no || '') === payload.fisNo &&
    (r.firma || '').trim() === payload.firma.trim() &&
    (r.tarih || '') === payload.tarih
  ) || null;
}

receiptForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(receiptForm);
  const payload = Object.fromEntries(formData.entries());
  payload.hamMetin = currentRawText;
  payload.fotoDosya = currentFotoDosya;

  const duplicate = findDuplicate(payload);
  if (duplicate) {
    const proceed = confirm(
      `Bu fiş zaten kayıtlı görünüyor:\n${duplicate.tarih} · ${duplicate.firma} · Fiş No: ${duplicate.fis_no}\n\nYine de kaydetmek istiyor musunuz?`
    );
    if (!proceed) return;
  }

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
    await loadReceipts();

    if (scanQueue.length > 0) {
      scanQueueIndex += 1;
      await scanNextInQueue();
      return;
    }
    formSection.classList.add('hidden');
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

const filterStart = document.getElementById('filterStart');
const filterEnd = document.getElementById('filterEnd');
const filterFirma = document.getElementById('filterFirma');
const filterKategori = document.getElementById('filterKategori');
const filterClear = document.getElementById('filterClear');

// "GG.AA.YYYY" formatindaki tarih metnini karsilastirilabilir bir Date'e cevirir.
function parseTarihToDate(tarih) {
  if (!tarih) return null;
  const m = tarih.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function passesFilters(r) {
  const firmaQuery = filterFirma.value.trim().toLocaleLowerCase('tr');
  if (firmaQuery && !(r.firma || '').toLocaleLowerCase('tr').includes(firmaQuery)) return false;
  if (filterKategori.value && r.kategori !== filterKategori.value) return false;

  const tarih = parseTarihToDate(r.tarih);
  if (filterStart.value) {
    if (!tarih || tarih < new Date(filterStart.value)) return false;
  }
  if (filterEnd.value) {
    if (!tarih || tarih > new Date(filterEnd.value)) return false;
  }
  return true;
}

const categorySummaryEl = document.getElementById('categorySummary');
const monthlySummaryEl = document.getElementById('monthlySummary');
const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

function renderBarList(container, entries) {
  container.innerHTML = '';
  if (!entries.length) {
    container.innerHTML = '<p class="summary-empty">Gösterilecek veri yok.</p>';
    return;
  }
  const max = Math.max(...entries.map((e) => e.value));
  for (const { label, value } of entries) {
    const row = document.createElement('div');
    row.className = 'summary-bar-row';
    row.innerHTML = `
      <span class="summary-bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <span class="summary-bar-track"><span class="summary-bar-fill" style="width:${max ? (value / max) * 100 : 0}%"></span></span>
      <span class="summary-bar-value">${formatMoney(value)}</span>
    `;
    container.appendChild(row);
  }
}

// Gosterilen (filtrelenmis) fis kumesine gore kategori ve ay bazinda
// harcama ozetini hesaplayip basit bar listeleri olarak cizer.
function renderSummary(rows) {
  const byKategori = {};
  const byMonth = {};

  for (const r of rows) {
    const kategori = r.kategori || 'Belirtilmemiş';
    byKategori[kategori] = (byKategori[kategori] || 0) + (Number(r.toplam) || 0);

    const tarih = parseTarihToDate(r.tarih);
    if (tarih) {
      const key = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = (byMonth[key] || 0) + (Number(r.toplam) || 0);
    }
  }

  const kategoriEntries = Object.entries(byKategori)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  renderBarList(categorySummaryEl, kategoriEntries);

  const monthEntries = Object.entries(byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .map(([key, value]) => {
      const [year, month] = key.split('-');
      return { label: `${MONTH_NAMES[Number(month) - 1]} ${year}`, value };
    });
  renderBarList(monthlySummaryEl, monthEntries);
}

function renderReceipts(rows) {
  renderSummary(rows);
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
      <td>${r.foto_dosya ? `<a href="/api/receipts/photos/${encodeURIComponent(r.foto_dosya)}" target="_blank" rel="noopener" title="Belgeyi Gör (PDF)">📄</a>` : ''}</td>
      <td><button class="btn-edit" data-id="${r.id}" title="Düzenle">✏️</button></td>
      <td><button class="btn-delete" data-id="${r.id}" title="Sil">🗑</button></td>
    `;
    receiptsBody.appendChild(tr);
  }

  const suffix = rows.length !== receiptsCache.length ? ` (${receiptsCache.length} kayıttan filtrelendi)` : '';
  totalSummary.textContent = rows.length ? `${rows.length} fiş · Toplam: ${formatMoney(total)}${suffix}` : (receiptsCache.length ? 'Filtreyle eşleşen fiş yok' : '');

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

function applyFilters() {
  renderReceipts(receiptsCache.filter(passesFilters));
}

[filterStart, filterEnd, filterKategori].forEach((el) => el.addEventListener('change', applyFilters));
filterFirma.addEventListener('input', applyFilters);
filterClear.addEventListener('click', () => {
  filterStart.value = '';
  filterEnd.value = '';
  filterFirma.value = '';
  filterKategori.value = '';
  applyFilters();
});

async function loadReceipts() {
  const res = await fetch('/api/receipts');
  receiptsCache = await res.json();
  applyFilters();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

loadReceipts();

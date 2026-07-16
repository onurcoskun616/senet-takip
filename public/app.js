// --- Karanlik mod ---
// Varsayilan olarak sistem tercihine (prefers-color-scheme) uyulur (CSS
// tarafinda @media ile); kullanici manuel bir tercih yaparsa (localStorage)
// bu tercih sistem ayarinin onune gecer ve <html data-theme="..."> ile
// uygulanir.
const THEME_STORAGE_KEY = 'senetTakipTema';
const themeToggleBtn = document.getElementById('themeToggleBtn');

function applyTheme(theme) {
  if (theme) {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveDark = theme ? theme === 'dark' : systemDark;
  themeToggleBtn.textContent = effectiveDark ? '☀️' : '🌙';
}

applyTheme(localStorage.getItem(THEME_STORAGE_KEY));

themeToggleBtn.addEventListener('click', () => {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = localStorage.getItem(THEME_STORAGE_KEY) || (systemDark ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

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
const offlineIndicator = document.getElementById('offlineIndicator');

let currentRawText = '';
let currentFotoDosya = '';
let editingId = null;
let receiptsCache = [];
let scanQueue = [];
let scanQueueIndex = 0;

// --- Cevrimdisi kuyruk ---
// Sayfa acikken kisa sureli baglanti kesintilerinde (orn. magazada zayif
// sinyal) bir kayit kaybolmasin diye, ag hatasi (sunucuya hic ulasamama -
// sunucunun hata donmesinden farkli) durumunda kaydetme islemi kuyruga
// alinip baglanti geri gelince otomatik tekrar denenir. Kuyruk yalnizca bu
// sekme acikken hafizada tutulur; sayfa kapatilir/yenilenirse kaybolur -
// gunler sonrasina kalici kuyruklama icin IndexedDB + Background Sync API
// gerekir ki iOS Safari bunu desteklemiyor, bu yuzden bilincli olarak bu
// daha basit (ama daha genis tarayici destegine sahip) yaklasim secildi.
const offlineQueue = [];

function isNetworkError(err) {
  return err instanceof TypeError;
}

function updateOfflineIndicator() {
  if (offlineQueue.length > 0) {
    const cokluEk = offlineQueue.length > 1 ? ` (+${offlineQueue.length - 1} tane daha)` : '';
    offlineIndicator.textContent = `🔌 Bağlantı sorunu: "${offlineQueue[0].description}" kaydı bekliyor${cokluEk}. Bağlantı gelince otomatik gönderilecek.`;
    offlineIndicator.classList.remove('hidden');
  } else {
    offlineIndicator.classList.add('hidden');
  }
}

function queueOfflineTask(description, task) {
  offlineQueue.push({ description, task });
  updateOfflineIndicator();
}

async function drainOfflineQueue() {
  while (offlineQueue.length > 0 && navigator.onLine) {
    const item = offlineQueue[0];
    try {
      await item.task();
      offlineQueue.shift();
      updateOfflineIndicator();
    } catch (err) {
      if (isNetworkError(err)) break; // hala baglanti yok, daha sonra tekrar denenecek
      offlineQueue.shift();
      updateOfflineIndicator();
      alert(`Kuyruktaki işlem başarısız oldu (${item.description}): ${err.message}`);
    }
  }
}

window.addEventListener('online', drainOfflineQueue);

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
    garantiBitis: r.garanti_bitis,
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
  receiptForm.garantiBitis.value = fields.garantiBitis || '';
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
    const sebepler = fields.aiSebepler || {};
    const satirlar = fields.aiAlanlar.map((k) => {
      const sebep = sebepler[k];
      return sebep ? `${labels[k] || k} (${sebep})` : (labels[k] || k);
    }).join(', ');
    aiFallbackNote.textContent = `🤖 Şu alanlar OCR yerine yedek yapay zeka modeliyle tamamlandı/düzeltildi, lütfen kontrol edin: ${satirlar}`;
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

  const performSave = async () => {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Kaydedilemedi.');
    }
  };

  const resetAndAdvance = async () => {
    receiptForm.reset();
    resetFormMode();
    updateFisNoLabel();
    if (scanQueue.length > 0) {
      scanQueueIndex += 1;
      await scanNextInQueue();
      return;
    }
    formSection.classList.add('hidden');
  };

  try {
    await performSave();
    await loadReceipts();
    await resetAndAdvance();
  } catch (err) {
    if (isNetworkError(err)) {
      queueOfflineTask(`${payload.firma || 'İsimsiz'} - ${payload.tarih || 'tarihsiz'}`, async () => {
        await performSave();
        await loadReceipts();
      });
      alert('Bağlantı sorunu tespit edildi. Bu kayıt, bağlantı geri geldiğinde otomatik olarak gönderilecek.');
      await resetAndAdvance();
    } else {
      alert('Hata: ' + err.message);
    }
  }
});

exportBtn.addEventListener('click', () => {
  window.location.href = '/api/receipts/export/excel';
});

// --- Yedekleme / Ice aktarma ---
const backupExportBtn = document.getElementById('backupExportBtn');
const backupImportInput = document.getElementById('backupImportInput');

backupExportBtn.addEventListener('click', () => {
  window.location.href = '/api/receipts/export/json';
});

backupImportInput.addEventListener('change', async () => {
  const file = backupImportInput.files[0];
  backupImportInput.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const count = Array.isArray(data.receipts) ? data.receipts.length : 0;
    if (!count) {
      alert('Bu dosyada geri yüklenecek bir fiş bulunamadı.');
      return;
    }
    const proceed = confirm(
      `Bu yedek dosyasında ${count} fiş var. Bunlar mevcut kayıtlarınıza EKLENECEK (üzerine yazılmaz). Devam edilsin mi?`
    );
    if (!proceed) return;

    const res = await fetch('/api/receipts/import/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text,
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Geri yükleme başarısız oldu.');
    alert(`${result.inserted} fiş başarıyla geri yüklendi.`);
    await loadReceipts();
  } catch (err) {
    alert('Hata: ' + err.message);
  }
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

// Garanti bitis tarihi <input type="date"> formatinda (YYYY-MM-DD)
// saklanir; bugune gore gecmis/yaklasan/uzak durumuna gore rozet basar.
const GARANTI_YAKLASIYOR_GUN = 30;
function formatGarantiBadge(garantiBitis) {
  if (!garantiBitis) return '-';
  const bitisTarihi = new Date(`${garantiBitis}T00:00:00`);
  if (Number.isNaN(bitisTarihi.getTime())) return '-';

  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);
  const gunFarki = Math.round((bitisTarihi - bugun) / (24 * 60 * 60 * 1000));
  const tarihMetni = bitisTarihi.toLocaleDateString('tr-TR');

  if (gunFarki < 0) {
    return `<span class="garanti-badge garanti-badge--bitti" title="Garanti ${tarihMetni} tarihinde bitti">⏰ Bitti</span>`;
  }
  if (gunFarki <= GARANTI_YAKLASIYOR_GUN) {
    return `<span class="garanti-badge garanti-badge--yaklasiyor" title="Garanti ${tarihMetni} tarihinde bitiyor (${gunFarki} gün kaldı)">⏰ ${gunFarki} gün</span>`;
  }
  return `<span title="Garanti ${tarihMetni} tarihinde bitiyor">${tarihMetni}</span>`;
}

const filterStart = document.getElementById('filterStart');
const filterEnd = document.getElementById('filterEnd');
const filterFirma = document.getElementById('filterFirma');
const filterText = document.getElementById('filterText');
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

  const textQuery = filterText.value.trim().toLocaleLowerCase('tr');
  if (textQuery) {
    const haystack = `${r.kalemler || ''} ${r.ham_metin || ''}`.toLocaleLowerCase('tr');
    if (!haystack.includes(textQuery)) return false;
  }

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

// --- Butce/limit uyarisi ---
// Butceler tarayicida (localStorage) tutulur; sunucu tarafinda bir
// degisiklik gerektirmez, kullaniciya ozel bir ayar oldugu icin bu yeterli.
const BUDGET_STORAGE_KEY = 'senetTakipButceler';
const BUDGET_KATEGORILERI = ['Gıda', 'Giyim', 'Ulaşım', 'Ofis Malzemesi', 'Fatura', 'Diğer'];

function loadBudgets() {
  try {
    return JSON.parse(localStorage.getItem(BUDGET_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveBudgets(budgets) {
  localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(budgets));
}

const budgetStatusEl = document.getElementById('budgetStatus');
const budgetInputsEl = document.getElementById('budgetInputs');
const saveBudgetsBtn = document.getElementById('saveBudgetsBtn');

function populateBudgetInputs() {
  const budgets = loadBudgets();
  budgetInputsEl.innerHTML = '';
  for (const kategori of BUDGET_KATEGORILERI) {
    const label = document.createElement('label');
    label.innerHTML = `${escapeHtml(kategori)}<input type="number" step="0.01" min="0" data-kategori="${escapeHtml(kategori)}" placeholder="Sınırsız" />`;
    label.querySelector('input').value = budgets[kategori] ?? '';
    budgetInputsEl.appendChild(label);
  }
}

saveBudgetsBtn.addEventListener('click', () => {
  const budgets = {};
  budgetInputsEl.querySelectorAll('input[data-kategori]').forEach((input) => {
    const value = Number(input.value);
    if (input.value !== '' && value > 0) budgets[input.dataset.kategori] = value;
  });
  saveBudgets(budgets);
  renderBudgetStatus();
});

// Aktif filtrelerden bagimsiz olarak, HER ZAMAN icinde bulunulan ayin
// kategori bazinda harcamasini hesaplar - butce, "bu ay ne kadar
// harcadim" sorusuna cevap verdigi icin liste filtresine bagli olmamali.
function computeCurrentMonthByKategori() {
  const now = new Date();
  const byKategori = {};
  for (const r of receiptsCache) {
    const tarih = parseTarihToDate(r.tarih);
    if (!tarih || tarih.getFullYear() !== now.getFullYear() || tarih.getMonth() !== now.getMonth()) continue;
    const kategori = r.kategori || 'Belirtilmemiş';
    byKategori[kategori] = (byKategori[kategori] || 0) + (Number(r.toplam) || 0);
  }
  return byKategori;
}

function renderBudgetStatus() {
  const budgets = loadBudgets();
  const spendByKategori = computeCurrentMonthByKategori();
  const kategoriler = Object.keys(budgets).filter((k) => budgets[k] > 0);

  budgetStatusEl.innerHTML = '';
  if (!kategoriler.length) {
    budgetStatusEl.innerHTML = '<p class="summary-empty">Henüz bütçe belirlenmemiş. Aşağıdan "Bütçe Ayarlarını Düzenle" ile ekleyebilirsiniz.</p>';
    return;
  }

  for (const kategori of kategoriler) {
    const spent = spendByKategori[kategori] || 0;
    const limit = budgets[kategori];
    const pct = Math.min(100, (spent / limit) * 100);
    const over = spent > limit;
    const row = document.createElement('div');
    row.className = 'summary-bar-row';
    row.innerHTML = `
      <span class="summary-bar-label" title="${escapeHtml(kategori)}">${escapeHtml(kategori)}${over ? ' ⚠️' : ''}</span>
      <span class="summary-bar-track"><span class="summary-bar-fill${over ? ' summary-bar-fill--over' : ''}" style="width:${pct}%"></span></span>
      <span class="summary-bar-value">${formatMoney(spent)} / ${formatMoney(limit)}</span>
    `;
    budgetStatusEl.appendChild(row);
  }
}

populateBudgetInputs();

// --- Sayfalama ---
// Fis sayisi arttikca tum listeyi tek seferde DOM'a basmak yavaslar; bu
// yuzden filtrelenmis sonuc sayfalara bolunup sadece aktif sayfa render edilir.
const PAGE_SIZE = 25;
let currentPage = 1;
const pager = document.getElementById('pager');
const pagerInfo = document.getElementById('pagerInfo');
const pagerPrev = document.getElementById('pagerPrev');
const pagerNext = document.getElementById('pagerNext');

function renderReceipts(rows) {
  renderSummary(rows);
  renderBudgetStatus();
  receiptsBody.innerHTML = '';
  let total = 0;
  for (const r of rows) {
    total += Number(r.toplam) || 0;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  for (const r of pageRows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.tarih) || '-'}</td>
      <td>${escapeHtml(r.firma) || '-'}</td>
      <td>${formatMoney(r.toplam)}</td>
      <td>${formatMoney(r.kdv)}</td>
      <td>${escapeHtml(r.belge_turu) || 'Fiş'}</td>
      <td>${escapeHtml(r.fis_no) || '-'}</td>
      <td>${escapeHtml(r.kategori) || '-'}</td>
      <td>${formatGarantiBadge(r.garanti_bitis)}</td>
      <td>${r.foto_dosya ? `<a href="/api/receipts/photos/${encodeURIComponent(r.foto_dosya)}" target="_blank" rel="noopener" title="Belgeyi Gör (PDF)">📄</a>` : ''}</td>
      <td><button class="btn-edit" data-id="${r.id}" title="Düzenle">✏️</button></td>
      <td><button class="btn-delete" data-id="${r.id}" title="Sil">🗑</button></td>
    `;
    receiptsBody.appendChild(tr);
  }

  const suffix = rows.length !== receiptsCache.length ? ` (${receiptsCache.length} kayıttan filtrelendi)` : '';
  totalSummary.textContent = rows.length ? `${rows.length} fiş · Toplam: ${formatMoney(total)}${suffix}` : (receiptsCache.length ? 'Filtreyle eşleşen fiş yok' : '');

  pager.classList.toggle('hidden', totalPages <= 1);
  pagerInfo.textContent = `Sayfa ${currentPage} / ${totalPages}`;
  pagerPrev.disabled = currentPage <= 1;
  pagerNext.disabled = currentPage >= totalPages;

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
  currentPage = 1;
  renderReceipts(receiptsCache.filter(passesFilters));
}

[filterStart, filterEnd, filterKategori].forEach((el) => el.addEventListener('change', applyFilters));
[filterFirma, filterText].forEach((el) => el.addEventListener('input', applyFilters));
filterClear.addEventListener('click', () => {
  filterStart.value = '';
  filterEnd.value = '';
  filterFirma.value = '';
  filterText.value = '';
  filterKategori.value = '';
  applyFilters();
});

pagerPrev.addEventListener('click', () => {
  currentPage -= 1;
  renderReceipts(receiptsCache.filter(passesFilters));
});
pagerNext.addEventListener('click', () => {
  currentPage += 1;
  renderReceipts(receiptsCache.filter(passesFilters));
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

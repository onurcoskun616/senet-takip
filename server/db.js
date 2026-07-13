const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'fisler.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tarih TEXT,
    saat TEXT,
    firma TEXT,
    toplam REAL,
    kdv REAL,
    odeme_yontemi TEXT,
    fis_no TEXT,
    belge_turu TEXT,
    kategori TEXT,
    notlar TEXT,
    kalemler TEXT,
    kdv_detay TEXT,
    toplam_1 REAL,
    matrah_1 REAL,
    kdv_1 REAL,
    toplam_10 REAL,
    matrah_10 REAL,
    kdv_10 REAL,
    toplam_20 REAL,
    matrah_20 REAL,
    kdv_20 REAL,
    ham_metin TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`);

// Var olan (eski semali) bir data/fisler.db dosyasi ile calisiliyorsa
// eksik kolonlari sonradan ekle.
const existingColumns = db.prepare("PRAGMA table_info(receipts)").all().map((c) => c.name);
for (const [column, definition] of [
  ['kalemler', 'TEXT'],
  ['kdv_detay', 'TEXT'],
  ['belge_turu', 'TEXT'],
  ['toplam_1', 'REAL'],
  ['matrah_1', 'REAL'],
  ['kdv_1', 'REAL'],
  ['toplam_10', 'REAL'],
  ['matrah_10', 'REAL'],
  ['kdv_10', 'REAL'],
  ['toplam_20', 'REAL'],
  ['matrah_20', 'REAL'],
  ['kdv_20', 'REAL'],
]) {
  if (!existingColumns.includes(column)) {
    db.exec(`ALTER TABLE receipts ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = db;

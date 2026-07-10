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
    kategori TEXT,
    notlar TEXT,
    ham_metin TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`);

module.exports = db;

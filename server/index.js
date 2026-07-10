require('dotenv').config();
const path = require('path');
const express = require('express');
const receiptsRouter = require('./routes/receipts');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/receipts', receiptsRouter);

// Multer/JSON hatalarini duzgun bir JSON yaniti olarak dondur.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Beklenmeyen bir hata oluştu.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Fiş Tarama Sistemi http://0.0.0.0:${PORT} adresinde çalışıyor`);
  console.log('Telefonunuzdan erişmek için: aynı Wi-Fi ağındaysanız bilgisayarınızın yerel IP adresini kullanın (örn. http://192.168.1.5:3000)');
});

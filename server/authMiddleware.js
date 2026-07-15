const crypto = require('crypto');

// Uygulama public bir linkte calisabildigi icin (orn. Render), APP_PASSWORD
// ortam degiskeni ayarlandiysa basit bir HTTP Basic Auth korumasi uygular.
// Tek kullanicilik kisisel bir uygulama oldugu icin kullanici adi onemsenmez,
// sadece sifre kontrol edilir. APP_PASSWORD bos birakilirsa (varsayilan)
// korumasiz calisir - yerel gelistirme icin ekstra adim gerekmez.
function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function basicAuthMiddleware(req, res, next) {
  const password = process.env.APP_PASSWORD;
  if (!password) return next();

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const suppliedPassword = decoded.slice(decoded.indexOf(':') + 1);
    if (timingSafeEqualStr(suppliedPassword, password)) {
      return next();
    }
  }

  // Realm ASCII olmak zorunda (HTTP header degerleri Turkce ozel karakter kabul etmiyor).
  res.set('WWW-Authenticate', 'Basic realm="Fis Tarama Sistemi"');
  res.status(401).send('Yetkisiz erişim. Şifrenizi girin.');
}

module.exports = { basicAuthMiddleware };

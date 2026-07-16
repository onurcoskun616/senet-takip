const CACHE_NAME = 'fis-tara-v2';
const SHELL_FILES = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// API isteklerini asla cache'leme; sadece uygulama kabugunu (shell) offline acilabilsin diye cache'le.
// Onceden cache-first bir strateji kullaniliyordu: bu, telefonda bir kez
// yuklenen eski app.js/index.html'in, sunucu tarafinda yapilan HER
// duzeltmeden (orn. KDV kirilim alanlarinin eklenmesi) sonra bile
// guncellenmemesine yol aciyordu (kullanici hep eski, kirilim alanlarini
// bile gondermeyen bir arayuz kullanmis oluyordu). Bunun yerine
// network-first uyguluyoruz: once agdan taze surumu almayi dene, basarili
// olursa cache'i guncelle; sadece ag basarisiz olursa (cevrimdisi)
// cache'e dus.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

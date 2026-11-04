const CACHE = "tag-impianto-shell-v14";
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./js/viewer.js",
  "./js/db.js",
  "./js/ocr.js",
  "./js/plant-nav.js",
  "./js/firebase-config.js",
  "./data/manifest.json",
  "./data/actiflo.json",
  "./data/assetto-200.json",
  "./data/biologico-mbbr-123.json",
  "./data/chimico-fisico.json",
  "./data/filtrazione-carboni.json",
  "./data/holdup-area-nord.json",
  "./data/holdup-pgs-ovest.json",
  "./data/interconnecting.json",
  "./data/osmosi-1a.json",
  "./data/osmosi-1b.json",
  "./data/osmosi-1c.json",
  "./data/osmosi-2a.json",
  "./data/osmosi-2b.json",
  "./data/osmosi-2c.json",
  "./data/reattivi-actiflo.json",
  "./data/sediflottatore-b.json",
  "./data/sediflottazione-a.json",
  "./data/trattamento-fanghi.json",
  "./data/ultrafiltrazione-a.json",
  "./data/ultrafiltrazione-b.json",
  "./data/ultrafiltrazione-c.json",
  "./data/ultrafiltrazione-mbr-ad.json",
  "./data/ultrafiltrazione-mbr-eh.json",
  "./data/ultrafiltrazione.json",
  "./data/uscita-actiflo.json",
  "./data/vasche-api-s851.json",
  "./assets/maps/_inspect-current-fanghi.png",
  "./assets/maps/_inspect-wa-fanghi.png",
  "./assets/maps/actiflo.png",
  "./assets/maps/assetto-200.png",
  "./assets/maps/biologico-mbbr-123.png",
  "./assets/maps/chimico-fisico.png",
  "./assets/maps/filtrazione-carboni.png",
  "./assets/maps/holdup-area-nord.png",
  "./assets/maps/holdup-pgs-ovest.png",
  "./assets/maps/interconnecting.png",
  "./assets/maps/osmosi-1a.png",
  "./assets/maps/osmosi-1b.png",
  "./assets/maps/osmosi-1c.png",
  "./assets/maps/osmosi-2a.png",
  "./assets/maps/osmosi-2b.png",
  "./assets/maps/osmosi-2c.png",
  "./assets/maps/reattivi-actiflo.png",
  "./assets/maps/sediflottatore-b.png",
  "./assets/maps/sediflottazione-a.png",
  "./assets/maps/trattamento-fanghi.png",
  "./assets/maps/ultrafiltrazione-a.png",
  "./assets/maps/ultrafiltrazione-b.png",
  "./assets/maps/ultrafiltrazione-c.png",
  "./assets/maps/ultrafiltrazione-mbr-ad.png",
  "./assets/maps/ultrafiltrazione-mbr-eh.png",
  "./assets/maps/ultrafiltrazione.png",
  "./assets/maps/uscita-actiflo.png",
  "./assets/maps/vasche-api-s851.png",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

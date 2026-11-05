const CACHE = "tag-impianto-shell-v30";
const MAP_CACHE = "tag-impianto-maps-v30";
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
  "./js/version.js",
  "./js/image-cache.js",
  "./data/manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            await cache.add(url);
          } catch (err) {
            console.warn("SW cache skip", url, err);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([CACHE, MAP_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isMapAsset(url) {
  return url.pathname.includes("/assets/maps/") && /\.(png|jpe?g|webp)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Mappe: cache-first (dopo la 1ª volta lo switch e' immediato)
  if (isMapAsset(url)) {
    event.respondWith(
      caches.open(MAP_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && res.ok) {
          try {
            await cache.put(req, res.clone());
          } catch (_) {
            /* quota piena: ignora */
          }
        }
        return res;
      })
    );
    return;
  }

  // Resto: rete, fallback cache shell
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".html") || url.pathname.endsWith("/"))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

const CACHE = "tag-impianto-shell-v51";
const MAP_CACHE = "tag-impianto-maps-v51";
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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            // bypass cache HTTP di GitHub Pages (max-age 600)
            await cache.add(new Request(url, { cache: "reload" }));
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

  // Mappe: rete fresca se online (evita PNG vecchie), fallback cache offline
  if (isMapAsset(url)) {
    event.respondWith(
      caches.open(MAP_CACHE).then(async (cache) => {
        try {
          const res = await fetch(req, { cache: "no-store" });
          if (res && res.ok) {
            try {
              await cache.put(req, res.clone());
            } catch (_) {
              /* quota */
            }
            return res;
          }
        } catch (_) {
          /* offline */
        }
        const hit = await cache.match(req);
        if (hit) return hit;
        // fallback: stessa PNG senza querystring (revisioni)
        const bare = new Request(url.pathname + url.hash, { method: "GET" });
        return (await cache.match(bare)) || Response.error();
      })
    );
    return;
  }

  // Shell/app: rete fresca (niente cache HTTP CDN), fallback cache offline
  const isShell =
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".webmanifest") ||
    url.pathname.endsWith("/") ||
    /\/sw\.js$/i.test(url.pathname);

  event.respondWith(
    fetch(req, isShell ? { cache: "no-store" } : undefined)
      .then((res) => {
        if (res && res.ok && isShell) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

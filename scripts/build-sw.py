from pathlib import Path

root = Path(__file__).resolve().parents[1]

# Solo shell leggera: niente PNG enormi in precache (su telefono riempie la quota e rompe l'app).
install_block = '''self.addEventListener("install", (event) => {
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
'''

activate_block = '''
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
'''

# Rete prima per tutto ciò che serve all'app; cache solo come fallback offline.
fetch_block = '''
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".html") || url.pathname.endsWith("/"))) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
'''

lines = [
    'const CACHE = "tag-impianto-shell-v20";',
    "const SHELL = [",
    '  "./",',
    '  "./index.html",',
    '  "./css/app.css",',
    '  "./js/app.js",',
    '  "./js/viewer.js",',
    '  "./js/db.js",',
    '  "./js/ocr.js",',
    '  "./js/plant-nav.js",',
    '  "./js/firebase-config.js",',
    '  "./js/version.js",',
    '  "./data/manifest.json",',
    '  "./icons/icon-192.png",',
    '  "./icons/icon-512.png",',
    "];",
    "",
]

(root / "sw.js").write_text(
    "\n".join(lines) + "\n" + install_block + activate_block + fetch_block,
    encoding="utf-8",
)
print("ok shell-only sw")

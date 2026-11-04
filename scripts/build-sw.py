from pathlib import Path

root = Path(__file__).resolve().parents[1]
maps = sorted(
    p
    for p in (root / "assets" / "maps").glob("*.png")
    if not p.name.startswith("_")
)
datas = sorted(
    p for p in (root / "data").glob("*.json") if p.name != "manifest.json"
)

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

fetch_block = '''
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  const isHtml = req.mode === "navigate" || path.endsWith(".html") || path.endsWith("/");
  const isManifest = path.endsWith("manifest.webmanifest") || path.endsWith("version.js");

  if (isHtml || isManifest) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

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
'''

lines = [
    'const CACHE = "tag-impianto-shell-v18";',
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
]
for p in datas:
    lines.append(f'  "./data/{p.name}",')
for p in maps:
    lines.append(f'  "./assets/maps/{p.name}",')
lines += [
    '  "./icons/icon-192.png",',
    '  "./icons/icon-512.png",',
    "];",
    "",
]

(root / "sw.js").write_text(
    "\n".join(lines) + "\n" + install_block + activate_block + fetch_block,
    encoding="utf-8",
)
print("ok", len(datas), "json", len(maps), "png")

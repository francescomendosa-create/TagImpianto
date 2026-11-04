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
old = (root / "sw.js").read_text(encoding="utf-8")
idx = old.find('self.addEventListener("install"')
rest = old[idx:] if idx >= 0 else ""

# install resiliente: un file mancante non deve far fallire tutta la PWA
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

# sostituisci solo dalla install in poi se c'e gia activate
act = old.find('self.addEventListener("activate"')
if act >= 0:
    rest = install_block + "\n" + old[act:]
else:
    rest = install_block

lines = [
    'const CACHE = "tag-impianto-shell-v15";',
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
    '  "./data/manifest.json",',
]
for p in datas:
    lines.append(f'  "./data/{p.name}",')
for p in maps:
    lines.append(f'  "./assets/maps/{p.name}",')
lines += [
    '  "./manifest.webmanifest",',
    '  "./icons/icon-192.png",',
    '  "./icons/icon-512.png",',
    "];",
    "",
]
(root / "sw.js").write_text("\n".join(lines) + "\n" + rest, encoding="utf-8")
print("ok", len(datas), "json", len(maps), "png")

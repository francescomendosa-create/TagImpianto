from pathlib import Path

root = Path(__file__).resolve().parents[1]
maps = sorted((root / "assets" / "maps").glob("*.png"))
datas = sorted(
    p for p in (root / "data").glob("*.json") if p.name != "manifest.json"
)
old = (root / "sw.js").read_text(encoding="utf-8")
idx = old.find('self.addEventListener("install"')
rest = old[idx:] if idx >= 0 else ""

lines = [
    'const CACHE = "tag-impianto-shell-v14";',
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

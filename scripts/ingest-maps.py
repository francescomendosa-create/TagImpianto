# -*- coding: utf-8 -*-
"""Ritaglia colonna sinistra e genera seed JSON per tutte le schermate WhatsApp."""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    import subprocess
    import sys

    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "-q"])
    from PIL import Image

ROOT = Path(r"C:\Users\franc\Documents\GitHub\TagImpianto")
SRC_DIR = Path(
    r"C:\Users\franc\.cursor\projects\c-Users-franc-Documents-GitHub-TagImpianto\assets"
)
MAPS = ROOT / "assets" / "maps"
FULL = MAPS / "full"
DATA = ROOT / "data"
CROP = 108

# n WhatsApp → (mapId, name, area)
# n=0 = file senza __N_
CATALOG = {
    0: ("chimico-fisico", "Chimico fisico", "wwt"),
    1: ("assetto-200", "Assetto a 200 m³/h", "assetto"),
    2: ("vasche-api-s851", "S-851 Vasche API", "vasche-api"),
    3: ("holdup-area-nord", "HOLD-UP Area Nord A-10605", "holdup"),
    4: ("holdup-pgs-ovest", "HOLD-UP PGS Ovest", "holdup"),
    5: ("interconnecting", "Interconnecting", "interconnecting"),
    6: ("uscita-actiflo", "Uscita Actiflo", "sf3"),
    7: ("reattivi-actiflo", "Reattivi Actiflo", "sf3"),
    8: ("actiflo", "Actiflo", "sf3"),
    9: ("trattamento-fanghi", "Trattamento fanghi", "wwt"),
    10: ("sediflottazione-a", "Sediflottazione A", "wwt"),
    11: ("osmosi-2c", "Osmosi 2° passo C", "wwt"),
    12: ("osmosi-2a", "Osmosi 2° passo A", "wwt"),
    13: ("osmosi-1c", "Osmosi 1° passo C", "wwt"),
    14: ("osmosi-2b", "Osmosi 2° passo B", "wwt"),
    15: ("osmosi-1a", "Osmosi 1° passo A", "wwt"),
    16: ("osmosi-1b", "Osmosi 1° passo B", "wwt"),
    17: ("ultrafiltrazione", "Ultrafiltrazione", "wwt"),
    18: ("ultrafiltrazione-c", "Ultrafiltrazione C", "wwt"),
    19: ("ultrafiltrazione-b", "Ultrafiltrazione B", "wwt"),
    20: ("filtrazione-carboni", "Filtrazione a carboni", "wwt"),
    21: ("ultrafiltrazione-a", "Ultrafiltrazione A", "wwt"),
    22: ("ultrafiltrazione-mbr-eh", "Ultrafiltrazione MBR E-H", "wwt"),
}

# Tag seed minimi per pagina (id, label, kind, x,y,w,h) già su immagine RITAGLIATA
SEED_TAGS = {
    "chimico-fisico": [
        ("TK-11000", "TK-11000 SODA", "serbatoio", 0.28, 0.22, 0.07, 0.22),
        ("TK-11001", "TK-11001 ACIDO SOLF.", "serbatoio", 0.36, 0.22, 0.07, 0.22),
        ("TK-11002", "TK-11002 COAGULANTE", "serbatoio", 0.44, 0.22, 0.07, 0.22),
        ("A-11005", "A-11005 SEDI-FLOTTATORE", "apparecchio", 0.42, 0.55, 0.22, 0.22),
    ],
    "sediflottazione-a": [
        ("TK-11100A", "TK-11100A COAGULAZIONE", "serbatoio", 0.30, 0.28, 0.12, 0.28),
        ("A-11005A", "A-11005A SEDI-FLOTTATORE", "apparecchio", 0.50, 0.35, 0.22, 0.28),
        ("TK-11000", "TK-11000 SODA", "serbatoio", 0.08, 0.25, 0.07, 0.20),
    ],
    "trattamento-fanghi": [
        ("TK-11016", "TK-11016", "serbatoio", 0.18, 0.20, 0.08, 0.25),
        ("TK-11017", "TK-11017", "serbatoio", 0.32, 0.25, 0.14, 0.28),
        ("V-1010", "V-1010 OMOGENEIZZAZ. FANGHI", "apparecchio", 0.52, 0.30, 0.16, 0.30),
    ],
    "filtrazione-carboni": [
        ("TK-11007", "TK-11007 PERMEATI MBR", "serbatoio", 0.08, 0.25, 0.12, 0.30),
        ("FIL-11002A", "FIL-11002A", "apparecchio", 0.35, 0.22, 0.10, 0.22),
        ("FIL-11003A", "FIL-11003A", "apparecchio", 0.50, 0.22, 0.10, 0.22),
        ("TK-11021", "TK-11021 PERMEATO UF", "serbatoio", 0.78, 0.30, 0.12, 0.28),
    ],
    "ultrafiltrazione": [
        ("TK-11020", "TK-11020 LAVAGGIO CIP", "serbatoio", 0.12, 0.20, 0.10, 0.22),
        ("TK-11021", "TK-11021", "serbatoio", 0.72, 0.28, 0.12, 0.30),
        ("FIL-11011", "FIL-11011", "apparecchio", 0.40, 0.30, 0.14, 0.28),
    ],
    "ultrafiltrazione-a": [
        ("FIL-11011A", "FIL-11011A", "apparecchio", 0.40, 0.28, 0.14, 0.28),
        ("TK-11021", "TK-11021", "serbatoio", 0.72, 0.30, 0.12, 0.28),
    ],
    "ultrafiltrazione-b": [
        ("FIL-11011B", "FIL-11011B", "apparecchio", 0.40, 0.28, 0.14, 0.28),
        ("TK-11021", "TK-11021", "serbatoio", 0.72, 0.30, 0.12, 0.28),
    ],
    "ultrafiltrazione-c": [
        ("FIL-11011C", "FIL-11011C", "apparecchio", 0.40, 0.28, 0.14, 0.28),
        ("TK-11021", "TK-11021", "serbatoio", 0.72, 0.30, 0.12, 0.28),
    ],
    "ultrafiltrazione-mbr-eh": [
        ("TK-11007", "TK-11007 PERMEATO MBR", "serbatoio", 0.40, 0.28, 0.14, 0.30),
        ("FIL-11007E", "FIL-11007E", "apparecchio", 0.20, 0.62, 0.08, 0.12),
        ("FIL-11007H", "FIL-11007H", "apparecchio", 0.55, 0.62, 0.08, 0.12),
    ],
    "osmosi-1a": [
        ("TK-11021", "TK-11021", "serbatoio", 0.08, 0.25, 0.12, 0.30),
        ("FIL-11009A", "FIL-11009A", "apparecchio", 0.45, 0.35, 0.20, 0.22),
        ("TK-11011A", "TK-11011A PERMEATO R.O.", "serbatoio", 0.75, 0.50, 0.12, 0.25),
    ],
    "osmosi-1b": [
        ("TK-11021", "TK-11021", "serbatoio", 0.08, 0.25, 0.12, 0.30),
        ("FIL-11009B", "FIL-11009B", "apparecchio", 0.45, 0.35, 0.20, 0.22),
        ("TK-11011B", "TK-11011B PERMEATO R.O.", "serbatoio", 0.75, 0.50, 0.12, 0.25),
    ],
    "osmosi-1c": [
        ("TK-11021", "TK-11021", "serbatoio", 0.08, 0.25, 0.12, 0.30),
        ("FIL-11009C", "FIL-11009C", "apparecchio", 0.45, 0.35, 0.20, 0.22),
        ("TK-11011C", "TK-11011C PERMEATO R.O.", "serbatoio", 0.75, 0.50, 0.12, 0.25),
    ],
    "osmosi-2a": [
        ("TK-11011A", "TK-11011A PERMEATO R.O.", "serbatoio", 0.20, 0.45, 0.14, 0.28),
        ("TK-11013", "TK-11013 PERMEATO R.O. 2° PASSO", "serbatoio", 0.75, 0.40, 0.14, 0.30),
    ],
    "osmosi-2b": [
        ("TK-11011B", "TK-11011B PERMEATO R.O.", "serbatoio", 0.20, 0.45, 0.14, 0.28),
        ("TK-11013", "TK-11013 PERMEATO R.O. 2° PASSO", "serbatoio", 0.75, 0.40, 0.14, 0.30),
    ],
    "osmosi-2c": [
        ("TK-11011C", "TK-11011C PERMEATO R.O.", "serbatoio", 0.20, 0.45, 0.14, 0.28),
        ("TK-11013", "TK-11013 PERMEATO R.O. 2° PASSO", "serbatoio", 0.75, 0.40, 0.14, 0.30),
    ],
    "actiflo": [
        ("TK107", "TK107", "serbatoio", 0.25, 0.30, 0.12, 0.28),
        ("DEP108", "DEP108", "apparecchio", 0.50, 0.28, 0.22, 0.32),
        ("P108A", "P108A", "pompa", 0.70, 0.55, 0.04, 0.07),
    ],
    "reattivi-actiflo": [
        ("TK104", "TK104 COAGULANTE", "serbatoio", 0.25, 0.30, 0.08, 0.22),
        ("TK101", "TK101 SODA", "serbatoio", 0.40, 0.30, 0.08, 0.22),
        ("TK103", "TK103 ACIDO", "serbatoio", 0.55, 0.30, 0.08, 0.22),
    ],
    "uscita-actiflo": [
        ("TK110", "TK110", "serbatoio", 0.55, 0.25, 0.12, 0.28),
        ("TK109", "TK109", "serbatoio", 0.20, 0.55, 0.10, 0.22),
        ("P110A", "P110A", "pompa", 0.70, 0.50, 0.04, 0.07),
    ],
    "interconnecting": [
        ("S-829", "S-829", "serbatoio", 0.78, 0.70, 0.10, 0.18),
        ("FCV_1000", "FCV_1000", "valvola", 0.40, 0.40, 0.06, 0.08),
    ],
    "vasche-api-s851": [
        ("S-851", "S-851", "serbatoio", 0.25, 0.25, 0.18, 0.40),
        ("P-13007A", "P-13007A", "pompa", 0.30, 0.70, 0.05, 0.08),
        ("P-13007B", "P-13007B", "pompa", 0.38, 0.70, 0.05, 0.08),
    ],
    "holdup-area-nord": [
        ("S-817", "S-817", "serbatoio", 0.20, 0.20, 0.10, 0.25),
        ("S-818", "S-818", "serbatoio", 0.35, 0.20, 0.10, 0.25),
        ("A-10605", "A-10605", "apparecchio", 0.30, 0.55, 0.25, 0.20),
    ],
    "holdup-pgs-ovest": [
        ("TK8066", "TK8066", "serbatoio", 0.55, 0.25, 0.12, 0.30),
        ("TK8063", "TK8063", "serbatoio", 0.72, 0.25, 0.12, 0.30),
        ("P-13000A", "P-13000A", "pompa", 0.22, 0.40, 0.05, 0.08),
    ],
    "assetto-200": [
        ("P11040A", "P11040A", "pompa", 0.15, 0.35, 0.05, 0.08),
        ("P11040B", "P11040B", "pompa", 0.22, 0.35, 0.05, 0.08),
        ("P11040C", "P11040C", "pompa", 0.29, 0.35, 0.05, 0.08),
        ("S-837", "S-837", "serbatoio", 0.75, 0.65, 0.10, 0.18),
    ],
}


def index_sources() -> dict[int, Path]:
    out: dict[int, Path] = {}
    for p in SRC_DIR.iterdir():
        if "WhatsApp_Image_2026-10-31_at_04.14.04" not in p.name:
            continue
        m = re.search(r"__(\d+)_", p.name)
        n = int(m.group(1)) if m else 0
        out[n] = p
    return out


def crop_left(src: Path, dst: Path, crop: int = CROP) -> tuple[int, int]:
    FULL.mkdir(parents=True, exist_ok=True)
    full_dst = FULL / dst.name
    shutil.copy2(src, full_dst)
    im = Image.open(src).convert("RGB")
    w, h = im.size
    crop = min(crop, max(40, w // 8))
    cropped = im.crop((crop, 0, w, h))
    dst.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(dst, "PNG", optimize=True)
    return cropped.size


def make_tags(map_id: str) -> list[dict]:
    rows = SEED_TAGS.get(map_id, [])
    tags = []
    for tid, label, kind, x, y, w, h in rows:
        tags.append(
            {
                "id": tid,
                "label": label,
                "kind": kind,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "source": "seed",
            }
        )
    return tags


def main() -> None:
    sources = index_sources()
    print("sources:", sorted(sources))
    created = []
    for n, (map_id, name, area) in sorted(CATALOG.items()):
        src = sources.get(n)
        if not src:
            print("MISSING", n, map_id)
            continue
        out_img = MAPS / f"{map_id}.png"
        # non sovrascrivere mappe già curate se diverse sorgenti
        skip_overwrite = map_id in {
            "sediflottatore-b",
            "biologico-mbbr-123",
            "ultrafiltrazione-mbr-ad",
        }
        if skip_overwrite and out_img.exists():
            print("keep existing", map_id)
            # comunque aggiorna/crea json se manca
        else:
            nw, nh = crop_left(src, out_img)
            print(f"cropped {n} -> {map_id} {nw}x{nh}")

        im = Image.open(out_img)
        nw, nh = im.size
        seed = {
            "id": map_id,
            "name": name,
            "image": f"assets/maps/{map_id}.png",
            "width": nw,
            "height": nh,
            "cropLeft": CROP,
            "area": area,
            "notes": "Seed automatico. Affina con OCR + Riposiziona.",
            "tags": make_tags(map_id),
        }
        (DATA / f"{map_id}.json").write_text(
            json.dumps(seed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        created.append(map_id)

    # elenco seed per db.js
    all_ids = sorted({*created, "sediflottatore-b", "biologico-mbbr-123", "ultrafiltrazione-mbr-ad"})
    manifest = {
        "cropLeft": CROP,
        "maps": [f"./data/{i}.json" for i in all_ids if (DATA / f"{i}.json").exists()],
    }
    (DATA / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("manifest maps:", len(manifest["maps"]))


if __name__ == "__main__":
    main()

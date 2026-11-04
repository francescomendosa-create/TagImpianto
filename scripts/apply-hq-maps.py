# -*- coding: utf-8 -*-
"""Applica foto HQ da Documents/dcs: ritaglio menu sx + aggiorna PNG/JSON."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"C:\Users\franc\Documents\dcs")
MAPS = ROOT / "assets" / "maps"
FULL = MAPS / "full-hq"
DATA = ROOT / "data"
SEED_REV = 4

# Identificazione manuale (menu sinistro selezionato / contenuto)
MANUAL = {
    "IMG_5978.jpg": ("ultrafiltrazione-mbr-eh", "Ultrafiltrazione MBR E-H"),
    "IMG_5979.jpg": ("filtrazione-carboni", "Filtrazione a carboni"),
    "IMG_5980.jpg": ("ultrafiltrazione-a", "Ultrafiltrazione A"),
    "IMG_5981.jpg": ("ultrafiltrazione-b", "Ultrafiltrazione B"),
    "IMG_5982.jpg": ("ultrafiltrazione-c", "Ultrafiltrazione C"),
    "IMG_5983.jpg": ("ultrafiltrazione", "Ultrafiltrazione"),
    "IMG_5984.jpg": ("osmosi-1a", "Osmosi 1° passo A"),
    "IMG_5985.jpg": ("osmosi-1b", "Osmosi 1° passo B"),
    "IMG_5986.jpg": ("osmosi-1c", "Osmosi 1° passo C"),
    "IMG_5987.jpg": ("osmosi-2a", "Osmosi 2° passo A"),
    "IMG_5988.jpg": ("osmosi-2b", "Osmosi 2° passo B"),
    "IMG_5989.jpg": ("osmosi-2c", "Osmosi 2° passo C"),
    "IMG_5990.jpg": ("sediflottazione-a", "Sediflottazione A"),
    "IMG_5991.jpg": ("trattamento-fanghi", "Trattamento fanghi"),
    "IMG_5992.jpg": ("actiflo", "Actiflo"),
    "IMG_5993.jpg": ("reattivi-actiflo", "Reattivi Actiflo"),
    "IMG_5994.jpg": ("uscita-actiflo", "Uscita Actiflo"),
    "IMG_5995.jpg": ("interconnecting", "Interconnecting"),
    "IMG_5996.jpg": ("holdup-pgs-ovest", "HOLD-UP PGS Ovest"),
    "IMG_5997.jpg": ("holdup-area-nord", "HOLD-UP Area Nord A-10605"),
    "IMG_5998.jpg": ("vasche-api-s851", "S-851 Vasche API"),
    "IMG_5999.jpg": ("assetto-200", "Assetto a 200 m³/h"),
    "IMG_6001.jpg": ("chimico-fisico", "Chimico fisico"),
    "IMG_6002.jpg": ("ultrafiltrazione-mbr-ad", "Ultrafiltrazione MBR A-D"),
}


def detect_sidebar_width(im: Image.Image) -> int:
    g = im.convert("L")
    w, h = g.size
    y0, y1 = int(h * 0.16), int(h * 0.78)
    # media colonna
    avgs = []
    limit = min(int(w * 0.25), w - 1)
    for x in range(limit):
        col = g.crop((x, y0, x + 1, y1))
        avgs.append(ImageStat.Stat(col).mean[0])

    crop_x = int(w * 0.115)
    for x in range(int(w * 0.07), limit - 12):
        nxt = sum(avgs[x : x + 10]) / 10
        prev = sum(avgs[max(0, x - 10) : x]) / max(1, min(10, x))
        # processo HMI chiaro
        if nxt >= 168 and prev <= 150 and (nxt - prev) >= 18:
            crop_x = x + 2
            break

    # menu WWT tipico ~10-13%; Actiflo/HOLDUP a volte più stretto
    crop_x = max(int(w * 0.085), min(int(w * 0.155), crop_x))
    return crop_x


def main() -> None:
    FULL.mkdir(parents=True, exist_ok=True)
    applied = []
    for fname, (map_id, name) in MANUAL.items():
        src = SRC / fname
        if not src.exists():
            print("MISSING", fname)
            continue
        im = Image.open(src).convert("RGB")
        crop_x = detect_sidebar_width(im)
        shutil.copy2(src, FULL / f"{map_id}.jpg")
        cropped = im.crop((crop_x, 0, im.width, im.height))
        im.close()
        out = MAPS / f"{map_id}.png"
        tmp = MAPS / f"_{map_id}.tmp.png"
        cropped.save(tmp, "PNG", optimize=True)
        cropped.close()
        # replace atomico (evita lock Windows su file aperti dal browser)
        for attempt in range(5):
            try:
                if out.exists():
                    out.unlink()
                tmp.replace(out)
                break
            except OSError as err:
                import time

                print(f"  retry save {map_id}: {err}")
                time.sleep(0.6)
        else:
            raise RuntimeError(f"cannot write {out}")

        jp = DATA / f"{map_id}.json"
        if jp.exists():
            data = json.loads(jp.read_text(encoding="utf-8"))
        else:
            data = {"id": map_id, "tags": [], "area": "wwt"}
        data["id"] = map_id
        data["name"] = name
        data["image"] = f"assets/maps/{map_id}.png"
        data["width"], data["height"] = cropped.size
        data["cropLeft"] = crop_x
        data["seedRev"] = SEED_REV
        data["notes"] = "Immagine HQ ritagliata + OCR. Affina con Riposiziona."
        # reset tags non-manuali: verranno rifatti da OCR
        data["tags"] = [
            t for t in (data.get("tags") or []) if t.get("locked") or t.get("source") == "manual"
        ]
        jp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        applied.append((map_id, fname, crop_x, cropped.size))
        print(f"{fname} -> {map_id:28} crop={crop_x:4} size={cropped.size[0]}x{cropped.size[1]}")

    print("applied", len(applied))


if __name__ == "__main__":
    main()

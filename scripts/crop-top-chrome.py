# -*- coding: utf-8 -*-
"""Ritaglia la barra superiore DCS (SF3 / Interconnecting / HOLD-UP / …) da tutte le mappe."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MAPS = ROOT / "assets" / "maps"
DATA = ROOT / "data"

# Frazione altezza: titolo + tabs fino sotto la riga di separazione
TOP_FRAC = 0.158
# Mappe piccole (legacy) senza barra HQ: ritaglio più leggero
TOP_FRAC_SMALL = 0.10
MIN_H_HQ = 900


def crop_top_for(h: int) -> int:
    frac = TOP_FRAC if h >= MIN_H_HQ else TOP_FRAC_SMALL
    cut = int(round(h * frac))
    return max(24, min(int(h * 0.22), cut))


def remap_tags(tags: list, crop_top: int, old_h: int, new_h: int) -> list:
    out = []
    for t in tags or []:
        y = float(t.get("y") or 0) * old_h
        hh = float(t.get("h") or 0.05) * old_h
        y2 = y - crop_top
        # scarta box completamente nella zona tagliata
        if y2 + hh <= 2:
            continue
        if y2 < 0:
            hh = hh + y2
            y2 = 0
        nt = dict(t)
        nt["y"] = max(0.0, min(1.0, y2 / new_h))
        nt["h"] = max(0.012, min(1.0 - nt["y"], hh / new_h))
        out.append(nt)
    return out


def main() -> None:
    # pulizia probe
    for p in MAPS.glob("_*.png"):
        try:
            p.unlink()
        except OSError:
            pass

    done = []
    for png in sorted(MAPS.glob("*.png")):
        if png.name.startswith("_"):
            continue
        map_id = png.stem
        jp = DATA / f"{map_id}.json"
        im = Image.open(png).convert("RGB")
        old_w, old_h = im.size
        crop_top = crop_top_for(old_h)
        if crop_top < 8 or crop_top >= old_h - 80:
            print("SKIP", map_id, "bad crop", crop_top)
            im.close()
            continue
        cropped = im.crop((0, crop_top, old_w, old_h))
        new_w, new_h = cropped.size
        tmp = MAPS / f"_{map_id}.tmp.png"
        cropped.save(tmp, "PNG", optimize=True)
        im.close()
        cropped.close()
        for attempt in range(6):
            try:
                if png.exists():
                    png.unlink()
                tmp.replace(png)
                break
            except OSError as err:
                import time

                print(" retry", map_id, err)
                time.sleep(0.5)
        else:
            raise RuntimeError(f"cannot write {png}")

        if jp.exists():
            data = json.loads(jp.read_text(encoding="utf-8"))
        else:
            data = {"id": map_id, "tags": [], "area": "wwt"}
        data["id"] = map_id
        data["image"] = f"assets/maps/{map_id}.png"
        data["width"] = new_w
        data["height"] = new_h
        data["cropTop"] = crop_top
        data["tags"] = remap_tags(data.get("tags") or [], crop_top, old_h, new_h)
        data["seedRev"] = max(int(data.get("seedRev") or 0), 1) + 1
        jp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        done.append((map_id, crop_top, f"{old_w}x{old_h}", f"{new_w}x{new_h}"))
        print(f"{map_id:28} -{crop_top:3}px  {old_w}x{old_h} -> {new_w}x{new_h}  tags={len(data['tags'])}")

    print("done", len(done))


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""Ingest HQ DCS photos: identify page from left menu, crop sidebar, replace maps, OCR."""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

import pytesseract
from PIL import Image, ImageEnhance, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"C:\Users\franc\Documents\dcs")
MAPS = ROOT / "assets" / "maps"
FULL = MAPS / "full-hq"
DATA = ROOT / "data"
TESS = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
if TESS.exists():
    pytesseract.pytesseract.tesseract_cmd = str(TESS)

SEED_REV = 4

# label fragments (OCR-normalized) -> mapId
LABEL_TO_MAP = [
    (r"CHIMICO\s*FISICO", "chimico-fisico"),
    (r"BIOLOGICO\s*MBBR", "biologico-mbbr-123"),
    (r"ULTRAFILTRAZIONE\s*MBR\s*A", "ultrafiltrazione-mbr-ad"),
    (r"ULTRAFILTRAZIONE\s*MBR\s*E", "ultrafiltrazione-mbr-eh"),
    (r"FILTRAZIONE\s*A?\s*CARBONI", "filtrazione-carboni"),
    (r"ULTRAFILTRAZIONE\s*[ABC]\b", None),  # handled below A/B/C
    (r"ULTRAFILTRAZIONE\b", "ultrafiltrazione"),
    (r"OSMOSI\s*1.*\bA\b|OSMOSI\s*1.?°?\s*PASSO\s*A", "osmosi-1a"),
    (r"OSMOSI\s*1.*\bB\b|OSMOSI\s*1.?°?\s*PASSO\s*B", "osmosi-1b"),
    (r"OSMOSI\s*1.*\bC\b|OSMOSI\s*1.?°?\s*PASSO\s*C", "osmosi-1c"),
    (r"OSMOSI\s*2.*\bA\b|OSMOSI\s*2.?°?\s*PASSO\s*A", "osmosi-2a"),
    (r"OSMOSI\s*2.*\bB\b|OSMOSI\s*2.?°?\s*PASSO\s*B", "osmosi-2b"),
    (r"OSMOSI\s*2.*\bC\b|OSMOSI\s*2.?°?\s*PASSO\s*C", "osmosi-2c"),
    (r"MISURE\s*MOTORI|MISURA\s*MOTORI", "misure-motori"),
    (r"SEDIFLOTTAZIONE\s*A|SEDIFLOTAZIONE\s*A|SEDI.?FLOTTAZIONE\s*A", "sediflottazione-a"),
    (r"SEDIFLOTTAZIONE\s*B|SEDIFLOTAZIONE\s*B|SEDI.?FLOTTAZIONE\s*B|SEDIFLOTTATORE\s*B", "sediflottatore-b"),
    (r"TRATTAMENTO\s*FANGHI", "trattamento-fanghi"),
    (r"ALLARMI\s*WWT", "allarmi-wwt"),
    (r"\bACTIFLO\b", "actiflo"),
    (r"\bREATTIVI\b", "reattivi-actiflo"),
    (r"USCITA\s*ACTIFLO", "uscita-actiflo"),
    (r"IMPOSTAZIONI", "impostazioni-actiflo"),
    (r"AREA\s*NORD|A-?10605", "holdup-area-nord"),
    (r"PGS\s*OVEST|TK\s*8056|TK8066", "holdup-pgs-ovest"),
    (r"INTERCONNECTING|INTERCONN", "interconnecting"),
    (r"\bS-?851\b|VASCHE\s*API", "vasche-api-s851"),
    (r"ASSETTO|200\s*M", "assetto-200"),
    (r"SERVIZI\s*LURGI", "servizi-lurgi"),
    (r"ACCUMULO\s*VASCHE", "accumulo-vasche"),
]


def norm(s: str) -> str:
    s = s.upper()
    s = s.replace("°", " ")
    s = re.sub(r"[^A-Z0-9\s\-_/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def detect_sidebar_width(im: Image.Image) -> int:
    """Find where light process area starts after dark/grey sidebar."""
    g = im.convert("L")
    w, h = g.size
    y0, y1 = int(h * 0.18), int(h * 0.75)
    avgs = []
    for x in range(min(int(w * 0.28), w)):
        crop = g.crop((x, y0, x + 1, y1))
        avgs.append(ImageStat.Stat(crop).mean[0])
    # look for jump to bright process background
    crop_x = int(w * 0.12)
    for x in range(int(w * 0.06), min(int(w * 0.22), len(avgs) - 10)):
        nxt = sum(avgs[x : x + 8]) / 8
        prev = sum(avgs[max(0, x - 8) : x]) / max(1, min(8, x))
        if nxt > 165 and prev < 155:
            crop_x = x
            break
    # clamp sensible range (~8-18% of width for these HMIs)
    crop_x = max(int(w * 0.08), min(int(w * 0.18), crop_x))
    return crop_x


def ocr_sidebar(im: Image.Image, crop_x: int) -> str:
    side = im.crop((0, int(im.height * 0.12), crop_x, int(im.height * 0.92)))
    side = ImageOps.autocontrast(side.convert("L"))
    side = ImageEnhance.Contrast(side).enhance(1.8)
    # upscale for OCR
    side = side.resize((side.width * 2, side.height * 2), Image.Resampling.LANCZOS)
    cfg = r"--oem 3 --psm 6"
    return norm(pytesseract.image_to_string(side, lang="eng", config=cfg))


def darkest_menu_band(im: Image.Image, crop_x: int) -> tuple[float, str]:
    """Return relative y of darkest horizontal band in sidebar (selected pill)."""
    side = im.convert("L").crop((2, int(im.height * 0.14), max(3, crop_x - 4), int(im.height * 0.90)))
    w, h = side.size
    bands = 40
    scores = []
    for i in range(bands):
        y0 = int(i * h / bands)
        y1 = int((i + 1) * h / bands)
        strip = side.crop((0, y0, w, y1))
        scores.append((ImageStat.Stat(strip).mean[0], (y0 + y1) / 2 / h))
    scores.sort(key=lambda t: t[0])
    return scores[0][1], "dark"


def map_from_sidebar_text(text: str, dark_rel_y: float | None = None) -> str | None:
    # Ultrafiltrazione A/B/C special
    if re.search(r"ULTRAFILTRAZIONE\s*A\b", text) and "MBR" not in text.split("ULTRAFILTRAZIONE A")[0][-20:]:
        # weak
        pass
    # Prefer explicit matches
    # Order matters: more specific first (already ordered)
    # For UF A/B/C detect from content OCR later if needed
    hits = []
    for pat, mid in LABEL_TO_MAP:
        if mid is None:
            continue
        if re.search(pat, text, re.I):
            hits.append((pat, mid))
    # If multiple WWT labels present (whole menu OCR), pick by dark band position heuristics
    if len(hits) >= 3 and dark_rel_y is not None:
        # approximate WWT menu order
        order = [
            "chimico-fisico",
            "biologico-mbbr-123",
            "ultrafiltrazione-mbr-ad",
            "ultrafiltrazione-mbr-eh",
            "filtrazione-carboni",
            "ultrafiltrazione",
            "osmosi-1a",
            "osmosi-1b",
            "osmosi-1c",
            "osmosi-2a",
            "osmosi-2b",
            "osmosi-2c",
            "misure-motori",
            "sediflottazione-a",
            "sediflottatore-b",
            "trattamento-fanghi",
            "allarmi-wwt",
        ]
        present = [m for m in order if any(h[1] == m for h in hits)]
        if present:
            idx = int(round(dark_rel_y * (len(present) - 1)))
            idx = max(0, min(len(present) - 1, idx))
            return present[idx]
    # else first specific hit preferring longer patterns — take last matched in priority list order
    for pat, mid in LABEL_TO_MAP:
        if mid and re.search(pat, text, re.I):
            # skip ultrafiltrazione generic if MBR also present without disambiguation
            if mid == "ultrafiltrazione" and re.search(r"MBR", text):
                continue
            if mid == "actiflo" and re.search(r"USCITA\s*ACTIFLO", text):
                continue
            return mid
    return None


def ocr_content_hint(im: Image.Image, crop_x: int) -> str:
    # sample center strip for unique titles
    w, h = im.size
    box = (crop_x + int(w * 0.05), int(h * 0.12), int(w * 0.75), int(h * 0.35))
    region = im.crop(box)
    region = ImageOps.autocontrast(region.convert("L"))
    region = region.resize((region.width // 2 * 2, region.height // 2 * 2), Image.Resampling.LANCZOS)
    return norm(pytesseract.image_to_string(region, lang="eng", config="--oem 3 --psm 6"))


def refine_map_id(mid: str | None, side: str, content: str) -> str | None:
    t = side + " " + content
    # UF A/B/C lines
    if re.search(r"FIL-?11011A|SETTAGGI\s*UF\s*A|ULTRAFILTRAZIONE\s*A\b", t) and not re.search(r"MBR\s*A", t):
        if "MBR" not in content[:80]:
            return "ultrafiltrazione-a"
    if re.search(r"FIL-?11011B|SETTAGGI\s*UF\s*B", t):
        return "ultrafiltrazione-b"
    if re.search(r"FIL-?11011C|SETTAGGI\s*UF\s*C", t):
        return "ultrafiltrazione-c"
    if re.search(r"FIL-?11011D|SETTAGGI\s*UF\s*D", t):
        return "ultrafiltrazione"  # D -> main UF if no dedicated
    if re.search(r"MBR\s*A.?D|FIL-?11007A|PERMEATO\s*MBR", t) and mid in (None, "ultrafiltrazione"):
        if re.search(r"FIL-?11007E|MBR\s*E", t):
            return "ultrafiltrazione-mbr-eh"
        return "ultrafiltrazione-mbr-ad"
    if re.search(r"MBR\s*E.?H|FIL-?11007E", t):
        return "ultrafiltrazione-mbr-eh"
    if re.search(r"1.?°?\s*PASSO\s*A|LINEA\s*A\s*ABILITATO|FIL-?11009A", t) and "2" not in (content[:40] if "PASSO" in content else ""):
        if re.search(r"2.?°?\s*PASSO", t):
            pass
        elif re.search(r"FIL-?11009A|OSMOSI\s*1", t):
            return "osmosi-1a"
    if re.search(r"FIL-?11009B|LINEA\s*B\s*ABILITATO", t) and re.search(r"OSMOSI\s*1|1.?°?\s*PASSO", t):
        return "osmosi-1b"
    if re.search(r"FIL-?11009C|LINEA\s*C\s*ABILITATO", t) and re.search(r"OSMOSI\s*1|1.?°?\s*PASSO", t):
        return "osmosi-1c"
    if re.search(r"2.?°?\s*PASSO.*A|PERMEATO\s*R\.?O\.?\s*2", t) and re.search(r"LINEA\s*A|TK-?11012A|TK-?11011A", t):
        return "osmosi-2a"
    if re.search(r"TK-?11012B|LINEA\s*B", t) and re.search(r"2.?°?\s*PASSO|PERMEATO\s*R\.?O\.?\s*2", t):
        return "osmosi-2b"
    if re.search(r"TK-?11012C|LINEA\s*C", t) and re.search(r"2.?°?\s*PASSO|PERMEATO\s*R\.?O\.?\s*2", t):
        return "osmosi-2c"
    if re.search(r"USCITA\s*ACTIFLO|DA\s*ACTIFLO|TK110\b|FILTRO\s*A\s*DISCHI", t):
        return "uscita-actiflo"
    if re.search(r"REATTIVI|POLIPREPARATORE|TK104|TK101\s*SODA", t) and re.search(r"ACTIFLO|SF3|REATTIVI", t):
        return "reattivi-actiflo"
    if re.search(r"\bDEP108\b|\bTK107\b|SEQUENZA\s*DI\s*AVVIO", t):
        return "actiflo"
    if re.search(r"S-?851|P-?13007", t):
        return "vasche-api-s851"
    if re.search(r"A-?10605|S-?817|S-?818", t):
        return "holdup-area-nord"
    if re.search(r"TK8066|TK8063|P-?13000|POZZETTO\s*H", t):
        return "holdup-pgs-ovest"
    if re.search(r"DEFLUORINATORE|CABINA\s*ANALISI|ALIM\s*WWT", t) and re.search(r"INTERCONN|INTERCONNECT", side + content):
        return "interconnecting"
    if re.search(r"DEFLUORINATORE\s*IN\s*MARCIA|P11040A.*P11040B.*P11040C|ASSETTO", t):
        if re.search(r"LOGICA\s*I-?1001|1.?°?\s*PASSO\s*[ABC]", t):
            return "assetto-200"
    if re.search(r"MBBR|A-?10620|TK-?11005\s*UREA", t):
        return "biologico-mbbr-123"
    if re.search(r"TRATTAMENTO\s*FANGHI|OMOGENEIZZ|CENTRIFUGA|V-?1010", t):
        return "trattamento-fanghi"
    if re.search(r"FIL-?11002|CARBONI|PERMEATI\s*MBR", t):
        return "filtrazione-carboni"
    if re.search(r"SEDI-?FLOTTATORE\s*B|TK-?11100B|SEDIFLOTTAZIONE\s*B", t):
        return "sediflottatore-b"
    if re.search(r"SEDI-?FLOTTATORE\s*A|TK-?11100A|SEDIFLOTTAZIONE\s*A", t):
        return "sediflottazione-a"
    if re.search(r"COAGULAZIONE|FLOCCULAZIONE|TK-?11000\s*SODA.*TK-?11001\s*ACIDO", t) and re.search(
        r"CHIMICO|A-?11005\b", t
    ):
        return "chimico-fisico"
    return mid


def crop_and_save(src: Path, map_id: str, crop_x: int) -> Path:
    FULL.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert("RGB")
    # backup full hq
    shutil.copy2(src, FULL / f"{map_id}{src.suffix.lower()}")
    cropped = im.crop((crop_x, 0, im.width, im.height))
    out = MAPS / f"{map_id}.png"
    cropped.save(out, "PNG", optimize=True)
    return out


def main() -> None:
    files = sorted(SRC.glob("IMG_*.jpg")) + sorted(SRC.glob("IMG_*.jpeg")) + sorted(SRC.glob("IMG_*.png"))
    if not files:
        print("No images in", SRC)
        sys.exit(1)

    mapping: dict[str, Path] = {}
    report = []
    for src in files:
        im = Image.open(src)
        crop_x = detect_sidebar_width(im)
        side = ocr_sidebar(im, crop_x)
        dark_y, _ = darkest_menu_band(im, crop_x)
        content = ocr_content_hint(im, crop_x)
        mid = map_from_sidebar_text(side, dark_y)
        mid = refine_map_id(mid, side, content)
        report.append((src.name, crop_x, mid, dark_y, side[:120].replace("\n", " "), content[:80].replace("\n", " ")))
        print(f"{src.name}: crop={crop_x} -> {mid}")
        print(f"  side: {side[:160]}")
        print(f"  content: {content[:120]}")
        if mid:
            # if duplicate, keep higher file size / later
            prev = mapping.get(mid)
            if prev is None or src.stat().st_size >= prev.stat().st_size:
                mapping[mid] = src
                # store crop for that file
                mapping[f"__crop__{mid}"] = crop_x  # type: ignore

    print("\n=== MAPPING ===")
    for mid, src in sorted((k, v) for k, v in mapping.items() if not str(k).startswith("__")):
        crop_x = mapping.get(f"__crop__{mid}", 0)
        print(f"{mid:28} <= {src.name} crop={crop_x}")

    # write identify report
    rep_path = ROOT / "assets" / "maps" / "_preview" / "hq-identify.json"
    rep_path.parent.mkdir(parents=True, exist_ok=True)
    rep_path.write_text(
        json.dumps(
            [{"file": a, "crop": b, "mapId": c, "darkY": d, "side": e, "content": f} for a, b, c, d, e, f in report],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # apply crops
    for mid, src in list(mapping.items()):
        if str(mid).startswith("__"):
            continue
        crop_x = int(mapping.get(f"__crop__{mid}", detect_sidebar_width(Image.open(src))))
        out = crop_and_save(src, mid, crop_x)
        # update json dimensions
        jp = DATA / f"{mid}.json"
        if jp.exists():
            data = json.loads(jp.read_text(encoding="utf-8"))
        else:
            data = {
                "id": mid,
                "name": mid,
                "image": f"assets/maps/{mid}.png",
                "tags": [],
                "area": "wwt",
            }
        with Image.open(out) as cim:
            data["width"], data["height"] = cim.size
        data["image"] = f"assets/maps/{mid}.png"
        data["cropLeft"] = crop_x
        data["seedRev"] = SEED_REV
        jp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("saved", out.name, data["width"], "x", data["height"])

    print("done maps", len([k for k in mapping if not str(k).startswith('__')]))


if __name__ == "__main__":
    main()

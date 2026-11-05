# -*- coding: utf-8 -*-
"""OCR + cataloghi noti: riempie i JSON seed cosi la ricerca trova i tag."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytesseract
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
MAPS = ROOT / "assets" / "maps"
TESS = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
if TESS.exists():
    pytesseract.pytesseract.tesseract_cmd = str(TESS)

SEED_REV = 5

# Pattern rigorosi impianto SASOL / WWT
STRICT = re.compile(
    r"^(?:"
    r"TK-?\d{3,5}[A-Z]?"
    r"|FIL-?\d{4,5}[A-Z]?"
    r"|P-?\d{4,5}[A-Z]"
    r"|P-?\d{5}"
    r"|XV-?\d{4,5}[A-Z]?"
    r"|HV-?\d{4,5}[A-Z]?"
    r"|V206X\d{2}"
    r"|FCV-?\d{3,5}"
    r"|LCV-?\d{3,5}"
    r"|MX-?\d{4,5}[A-Z]?"
    r"|K-?\d{4,5}[A-Z]"
    r"|A-?\d{4,5}[A-Z]?"
    r"|DEP-?\d{3}"
    r"|S-?\d{3,4}"
    r"|66-ST\d+[A-Z]?"
    r"|(?:PG|VP|TT)\d+_B"
    r"|\d{1,3}(?:AIT|FIT|LIT|LT|TT|PT|PDT|PIT)\d{2,3}[A-Z]?"
    r"|(?:AIT|FIT|LIT|LT|TT|PT|PDT|PIT)\d{2,5}[A-Z]?"
    r")$",
    re.I,
)

TAG_FIND = re.compile(
    r"(?:"
    r"TK[- ]?\d{3,5}[A-Z]?"
    r"|FIL[- ]?\d{4,5}[A-Z]?"
    r"|P[- ]?\d{4,5}[A-Z]?"
    r"|XV[- ]?\d{4,5}[A-Z]?"
    r"|HV[- ]?\d{4,5}[A-Z]?"
    r"|V206X\d{2}"
    r"|FCV[- ]?\d{3,5}"
    r"|LCV[- ]?\d{3,5}"
    r"|MX[- ]?\d{4,5}[A-Z]?"
    r"|K[- ]?\d{4,5}[A-Z]"
    r"|A[- ]?\d{4,5}[A-Z]?"
    r"|DEP[- ]?\d{3}"
    r"|S[- ]?\d{3,4}"
    r"|66-ST\d+[A-Z]?"
    r"|(?:PG|VP|TT)\d+_B"
    r"|\d{1,3}(?:AIT|FIT|LIT|LT|TT|PT|PDT|PIT)\d{2,3}[A-Z]?"
    r")",
    re.I,
)

# OCR spazzatura tipica da scartare
OCR_NOISE = re.compile(
    r"^(?:"
    r"FIL-?1100$"
    r"|FIL-?11002$"
    r"|FIL-?11003$"
    r"|TK-?\d{5}[A-Z]$"  # TK-11018K / TK-11021P da testo attaccato
    r"|XV\d+[A-Z]$"  # XV11074E spezzati
    r"|P1101I.*"
    r"|10AITO.*"
    r"|110FITO$"
    r"|AIT200$"
    r"|7AIT200$"
    r")$",
    re.I,
)

# Cataloghi noti per mappa (id) — da schermate DCS. Coordinate grezze 0-1.
CATALOGS: dict[str, list[tuple[str, str, str]]] = {
    # id, label, kind
    "osmosi-1a": [
        ("TK-11021", "TK-11021", "serbatoio"),
        ("TK-11001", "TK-11001 ACIDO SOLF.", "serbatoio"),
        ("TK-11019", "TK-11019 BISOLFITO", "serbatoio"),
        ("TK-11010A", "TK-11010A ANTINCROSTANTE", "serbatoio"),
        ("TK-11000", "TK-11000 SODA", "serbatoio"),
        ("TK-11011A", "TK-11011A PERMEATO R.O.", "serbatoio"),
        ("FIL-11004A", "FIL-11004A", "apparecchio"),
        ("FIL-11005A", "FIL-11005A", "apparecchio"),
        ("FIL-11009A", "FIL-11009A", "apparecchio"),
        ("P11020A", "P11020A", "pompa"),
        ("P11020C", "P11020C", "pompa"),
        ("P11021A", "P11021A", "pompa"),
        ("P11024A", "P11024A", "pompa"),
        ("P11024C", "P11024C", "pompa"),
        ("P11040A", "P11040A", "pompa"),
        ("P11040B", "P11040B", "pompa"),
        ("P11040C", "P11040C", "pompa"),
        ("P11040D", "P11040D", "pompa"),
        ("P11032A", "P11032A", "pompa"),
        ("P11032B", "P11032B", "pompa"),
        ("P11032C", "P11032C", "pompa"),
        ("110PT03A", "110PT03A", "strumento"),
        ("110PDT01A", "110PDT01A", "strumento"),
        ("110PT04A", "110PT04A", "strumento"),
        ("110AIT08A", "110AIT08A", "strumento"),
        ("110AIT09A", "110AIT09A", "strumento"),
        ("110PT06A", "110PT06A", "strumento"),
    ],
    "osmosi-1b": [
        ("TK-11021", "TK-11021", "serbatoio"),
        ("TK-11001", "TK-11001 ACIDO SOLF.", "serbatoio"),
        ("TK-11019", "TK-11019 BISOLFITO", "serbatoio"),
        ("TK-11010B", "TK-11010B ANTINCROSTANTE", "serbatoio"),
        ("TK-11000", "TK-11000 SODA", "serbatoio"),
        ("TK-11011B", "TK-11011B PERMEATO R.O.", "serbatoio"),
        ("FIL-11004B", "FIL-11004B", "apparecchio"),
        ("FIL-11005B", "FIL-11005B", "apparecchio"),
        ("FIL-11009B", "FIL-11009B", "apparecchio"),
        ("P11020B", "P11020B", "pompa"),
        ("P11040A", "P11040A", "pompa"),
        ("P11040B", "P11040B", "pompa"),
        ("P11040C", "P11040C", "pompa"),
        ("P11040D", "P11040D", "pompa"),
        ("P11032A", "P11032A", "pompa"),
        ("P11032B", "P11032B", "pompa"),
        ("P11032C", "P11032C", "pompa"),
    ],
    "osmosi-1c": [
        ("TK-11021", "TK-11021", "serbatoio"),
        ("TK-11001", "TK-11001 ACIDO SOLF.", "serbatoio"),
        ("TK-11010C", "TK-11010C ANTINCROSTANTE", "serbatoio"),
        ("TK-11000", "TK-11000 SODA", "serbatoio"),
        ("TK-11011C", "TK-11011C PERMEATO R.O.", "serbatoio"),
        ("FIL-11004C", "FIL-11004C", "apparecchio"),
        ("FIL-11005C", "FIL-11005C", "apparecchio"),
        ("FIL-11009C", "FIL-11009C", "apparecchio"),
        ("P11020C", "P11020C", "pompa"),
        ("P11040A", "P11040A", "pompa"),
        ("P11040B", "P11040B", "pompa"),
        ("P11040C", "P11040C", "pompa"),
        ("P11040D", "P11040D", "pompa"),
        ("P11032A", "P11032A", "pompa"),
        ("P11032B", "P11032B", "pompa"),
        ("P11032C", "P11032C", "pompa"),
    ],
    "osmosi-2a": [
        ("TK-11000", "TK-11000 SODA", "serbatoio"),
        ("TK-11012A", "TK-11012A ANTINCROSTANTE", "serbatoio"),
        ("TK-11011A", "TK-11011A PERMEATO R.O.", "serbatoio"),
        ("TK-11040", "TK-11040 BIOCIDA", "serbatoio"),
        ("TK-11013", "TK-11013 PERMEATO R.O. 2° PASSO", "serbatoio"),
        ("P11024A", "P11024A", "pompa"),
        ("P11024C", "P11024C", "pompa"),
        ("P11026A", "P11026A", "pompa"),
        ("P11041A", "P11041A", "pompa"),
        ("P11027A", "P11027A", "pompa"),
        ("P11027B", "P11027B", "pompa"),
        ("P11027C", "P11027C", "pompa"),
        ("XV13200", "XV13200", "valvola"),
        ("09AIT200", "09AIT200", "strumento"),
        ("110TT11A", "110TT11A", "strumento"),
        ("110TT11", "110TT11", "strumento"),
    ],
    "osmosi-2b": [
        ("TK-11000", "TK-11000 SODA", "serbatoio"),
        ("TK-11012B", "TK-11012B ANTINCROSTANTE", "serbatoio"),
        ("TK-11011B", "TK-11011B PERMEATO R.O.", "serbatoio"),
        ("TK-11040", "TK-11040 BIOCIDA", "serbatoio"),
        ("TK-11013", "TK-11013 PERMEATO R.O. 2° PASSO", "serbatoio"),
        ("P11024B", "P11024B", "pompa"),
        ("P11024C", "P11024C", "pompa"),
        ("P11025B", "P11025B", "pompa"),
        ("P11026B", "P11026B", "pompa"),
        ("P11041A", "P11041A", "pompa"),
        ("P11041B", "P11041B", "pompa"),
        ("P11027A", "P11027A", "pompa"),
        ("P11027B", "P11027B", "pompa"),
        ("P11027C", "P11027C", "pompa"),
    ],
    "osmosi-2c": [
        ("TK-11000", "TK-11000 SODA", "serbatoio"),
        ("TK-11012C", "TK-11012C ANTINCROSTANTE", "serbatoio"),
        ("TK-11011C", "TK-11011C PERMEATO R.O.", "serbatoio"),
        ("TK-11040", "TK-11040 BIOCIDA", "serbatoio"),
        ("TK-11013", "TK-11013 PERMEATO R.O. 2° PASSO", "serbatoio"),
        ("P11024D", "P11024D", "pompa"),
        ("P11026C", "P11026C", "pompa"),
        ("P11041A", "P11041A", "pompa"),
        ("RT11001C", "RT11001C", "mixer"),
        ("XV13200", "XV13200", "valvola"),
    ],
    "ultrafiltrazione": [
        ("TK-11020", "TK-11020 LAVAGGIO CIP", "serbatoio"),
        ("TK-11021", "TK-11021", "serbatoio"),
        ("TK-11018", "TK-11018 BIOCIDA", "serbatoio"),
        ("TK-11039", "TK-11039 IPOCLORITO", "serbatoio"),
        ("TK-11038", "TK-11038 SODA", "serbatoio"),
        ("TK-11037", "TK-11037 ACIDO CLOR.", "serbatoio"),
        ("TK-11019", "TK-11019 BISOLFITO", "serbatoio"),
        ("FIL-11011", "FIL-11011", "apparecchio"),
        ("P11033A", "P11033A", "pompa"),
        ("P11033B", "P11033B", "pompa"),
        ("P11035A", "P11035A", "pompa"),
        ("P11035B", "P11035B", "pompa"),
        ("P11039A", "P11039A", "pompa"),
        ("P11039B", "P11039B", "pompa"),
    ],
    "ultrafiltrazione-a": [
        ("FIL-11011A", "FIL-11011A", "apparecchio"),
        ("TK-11020", "TK-11020 LAVAGGIO CIP", "serbatoio"),
        ("TK-11021", "TK-11021", "serbatoio"),
        ("TK-11018", "TK-11018 BIOCIDA", "serbatoio"),
        ("TK-11039", "TK-11039 IPOCLORITO", "serbatoio"),
        ("TK-11038", "TK-11038 SODA", "serbatoio"),
        ("TK-11037", "TK-11037 ACIDO CLOR.", "serbatoio"),
        ("TK-11019", "TK-11019 BISOLFITO", "serbatoio"),
        ("P11033A", "P11033A", "pompa"),
        ("P11040D", "P11040D", "pompa"),
    ],
    "ultrafiltrazione-b": [
        ("FIL-11011B", "FIL-11011B", "apparecchio"),
        ("TK-11020", "TK-11020", "serbatoio"),
        ("TK-11021", "TK-11021", "serbatoio"),
        ("TK-11018", "TK-11018 BIOCIDA", "serbatoio"),
        ("TK-11039", "TK-11039 IPOCLORITO", "serbatoio"),
        ("TK-11038", "TK-11038 SODA", "serbatoio"),
        ("TK-11037", "TK-11037 ACIDO CLOR.", "serbatoio"),
        ("TK-11019", "TK-11019 BISOLFITO", "serbatoio"),
        ("P11033A", "P11033A", "pompa"),
        ("P11040D", "P11040D", "pompa"),
    ],
    "ultrafiltrazione-c": [
        ("FIL-11011C", "FIL-11011C", "apparecchio"),
        ("TK-11020", "TK-11020", "serbatoio"),
        ("TK-11021", "TK-11021", "serbatoio"),
        ("TK-11018", "TK-11018 BIOCIDA", "serbatoio"),
        ("TK-11039", "TK-11039 IPOCLORITO", "serbatoio"),
        ("TK-11038", "TK-11038 SODA", "serbatoio"),
        ("TK-11037", "TK-11037 ACIDO CLOR.", "serbatoio"),
        ("TK-11019", "TK-11019 BISOLFITO", "serbatoio"),
        ("P11033A", "P11033A", "pompa"),
    ],
    "ultrafiltrazione-mbr-ad": [
        ("TK-11007", "TK-11007 PERMEATO MBR", "serbatoio"),
        ("TK-11008", "TK-11008 IPOCLORITO DI SODIO", "serbatoio"),
        ("TK-11009", "TK-11009 ACIDO CITRICO", "serbatoio"),
        ("FIL-11007A", "FIL-11007A", "apparecchio"),
        ("FIL-11007B", "FIL-11007B", "apparecchio"),
        ("FIL-11007C", "FIL-11007C", "apparecchio"),
        ("FIL-11007D", "FIL-11007D", "apparecchio"),
        ("P11012A", "P11012A", "pompa"),
        ("P11012B", "P11012B", "pompa"),
        ("P11012C", "P11012C", "pompa"),
        ("P11012D", "P11012D", "pompa"),
        ("P11013A", "P11013A", "pompa"),
        ("P11013B", "P11013B", "pompa"),
        ("P11013C", "P11013C", "pompa"),
        ("P11013D", "P11013D", "pompa"),
        ("XV11006", "XV11006", "valvola"),
        ("XV11007", "XV11007", "valvola"),
        ("XV11008", "XV11008", "valvola"),
        ("XV11009", "XV11009", "valvola"),
    ],
    "ultrafiltrazione-mbr-eh": [
        ("TK-11007", "TK-11007 PERMEATO MBR", "serbatoio"),
        ("TK-11008", "TK-11008 IPOCLORITO DI SODIO", "serbatoio"),
        ("TK-11009", "TK-11009 ACIDO CITRICO", "serbatoio"),
        ("FIL-11007E", "FIL-11007E", "apparecchio"),
        ("FIL-11007F", "FIL-11007F", "apparecchio"),
        ("FIL-11007G", "FIL-11007G", "apparecchio"),
        ("FIL-11007H", "FIL-11007H", "apparecchio"),
        ("P11012E", "P11012E", "pompa"),
        ("P11012F", "P11012F", "pompa"),
        ("P11012G", "P11012G", "pompa"),
        ("P11012H", "P11012H", "pompa"),
        ("110LT07", "110LT07", "strumento"),
    ],
    # Filtri a carboni: catalogo completo (OCR fallisce sulle XV piccole).
    # Tuple: id, label, kind[, x, y]
    "filtrazione-carboni": [
        ("TK-11007", "TK-11007 PERMEATI MBR", "serbatoio", 0.06, 0.28),
        ("110LT07", "110LT07", "strumento", 0.10, 0.42),
        ("TK-11021", "TK-11021 PERMEATO UF", "serbatoio", 0.82, 0.72),
        ("TK-11018", "TK-11018 BIOCIDA", "serbatoio", 0.74, 0.48),
        ("FIL-11002A", "FIL-11002A", "apparecchio", 0.28, 0.30),
        ("FIL-11003A", "FIL-11003A", "apparecchio", 0.48, 0.30),
        ("FIL-11002B", "FIL-11002B", "apparecchio", 0.28, 0.68),
        ("FIL-11003B", "FIL-11003B", "apparecchio", 0.48, 0.68),
        ("P11019A", "P11019A", "pompa", 0.10, 0.55),
        ("P11019B", "P11019B", "pompa", 0.16, 0.55),
        ("P11019C", "P11019C", "pompa", 0.22, 0.55),
        ("P11035A", "P11035A", "pompa", 0.72, 0.62),
        ("P11035B", "P11035B", "pompa", 0.78, 0.62),
        # Linea A — FIL-11002A
        ("XV11040", "XV11040", "valvola", 0.24, 0.22),
        ("XV11041", "XV11041", "valvola", 0.30, 0.20),
        ("XV11042", "XV11042", "valvola", 0.36, 0.22),
        ("XV11043", "XV11043", "valvola", 0.24, 0.40),
        ("XV11044", "XV11044", "valvola", 0.30, 0.42),
        ("XV11045", "XV11045", "valvola", 0.36, 0.40),
        # Linea A — FIL-11003A
        ("XV11046", "XV11046", "valvola", 0.44, 0.22),
        ("XV11047", "XV11047", "valvola", 0.50, 0.20),
        ("XV11048", "XV11048", "valvola", 0.56, 0.22),
        ("XV11049", "XV11049", "valvola", 0.44, 0.40),
        ("XV11050", "XV11050", "valvola", 0.50, 0.42),
        ("XV11051", "XV11051", "valvola", 0.56, 0.40),
        # Linea B — FIL-11002B
        ("XV11052", "XV11052", "valvola", 0.24, 0.60),
        ("XV11053", "XV11053", "valvola", 0.30, 0.58),
        ("XV11054", "XV11054", "valvola", 0.36, 0.60),
        ("XV11055", "XV11055", "valvola", 0.24, 0.78),
        ("XV11056", "XV11056", "valvola", 0.30, 0.80),
        ("XV11057", "XV11057", "valvola", 0.36, 0.78),
        # Linea B — FIL-11003B
        ("XV11058", "XV11058", "valvola", 0.44, 0.60),
        ("XV11059", "XV11059", "valvola", 0.50, 0.58),
        ("XV11060", "XV11060", "valvola", 0.56, 0.60),
        ("XV11061", "XV11061", "valvola", 0.44, 0.78),
        ("XV11062", "XV11062", "valvola", 0.50, 0.80),
        ("XV11063", "XV11063", "valvola", 0.56, 0.78),
        # Strumenti / altri
        ("110FIT04", "110FIT04", "strumento", 0.18, 0.38),
        ("110FIT05", "110FIT05", "strumento", 0.18, 0.72),
        ("110AIT06", "110AIT06", "strumento", 0.62, 0.18),
        ("110AIT07", "110AIT07", "strumento", 0.62, 0.24),
        ("07AIT200", "07AIT200", "strumento", 0.90, 0.42),
        ("HV11006", "HV11006 SCARICO I.A.S.", "valvola", 0.40, 0.88),
        ("V206X00", "V206X00", "valvola", 0.60, 0.50),
        ("V206X01", "V206X01", "valvola", 0.66, 0.50),
        ("V206X02", "V206X02", "valvola", 0.66, 0.24),
        ("XV11074", "XV11074", "valvola", 0.02, 0.28),
        ("XV11085", "XV11085", "valvola", 0.04, 0.22),
        ("XV11095", "XV11095", "valvola", 0.12, 0.18),
    ],
    "biologico-mbbr-123": [
        ("TK-11005", "TK-11005 UREA", "serbatoio"),
        ("TK-11014", "TK-11014 ACIDO FOSF.", "serbatoio"),
        ("TK-11006", "TK-11006 CARBONE", "serbatoio"),
        ("TK-11090", "TK-11090 GLICOLE", "serbatoio"),
        ("A-10620", "A-10620 BIOLOGICO MBBR-1", "apparecchio"),
        ("TK-10608", "TK-10608 BIOLOGICO MBBR-2", "apparecchio"),
        ("A-10611", "A-10611 BIOLOGICO MBBR-3", "apparecchio"),
        ("A-10607", "A-10607 MBBR-3", "apparecchio"),
        ("FIL-11001A", "FIL-11001A", "apparecchio"),
        ("FIL-11001B", "FIL-11001B", "apparecchio"),
        ("P11008A", "P11008A", "pompa"),
        ("P11008B", "P11008B", "pompa"),
        ("P11007A", "P11007A", "pompa"),
        ("P11007B", "P11007B", "pompa"),
        ("P11010A", "P11010A", "pompa"),
        ("P11010B", "P11010B", "pompa"),
        ("P11011A", "P11011A", "pompa"),
        ("P11011B", "P11011B", "pompa"),
        ("P11036A", "P11036A", "pompa"),
        ("P11036B", "P11036B", "pompa"),
        ("P11031A", "P11031A", "pompa"),
        ("P11031B", "P11031B", "pompa"),
        ("P11090A", "P11090A", "pompa"),
        ("P11090B", "P11090B", "pompa"),
        ("P11090C", "P11090C", "pompa"),
        ("K11000A", "K11000A", "compressor"),
        ("K11000B", "K11000B", "compressor"),
        ("K11001A", "K11001A", "compressor"),
        ("K11001B", "K11001B", "compressor"),
        ("K11003A", "K11003A", "compressor"),
        ("K11003B", "K11003B", "compressor"),
        ("XV11030", "XV11030", "valvola"),
        ("XV11032", "XV11032", "valvola"),
        ("XV11076", "XV11076", "valvola"),
        ("XV11077", "XV11077", "valvola"),
        ("110LT01", "110LT01", "strumento"),
        ("110LIT02", "110LIT02", "strumento"),
        ("03-LT200", "03-LT200", "strumento"),
        ("02AIT201", "02AIT201", "strumento"),
        ("02AIT202", "02AIT202", "strumento"),
        ("110AIT03", "110AIT03", "strumento"),
        ("110AIT04", "110AIT04", "strumento"),
        ("03AIT200", "03AIT200", "strumento"),
    ],
    "chimico-fisico": [
        ("TK-11000", "TK-11000 SODA", "serbatoio"),
        ("TK-11001", "TK-11001 ACIDO SOLF.", "serbatoio"),
        ("TK-11002", "TK-11002 COAGULANTE", "serbatoio"),
        ("TK-11000C", "TK-11000 COAGULAZIONE", "serbatoio"),
        ("TK-11001F", "TK-11001 FLOCCULAZIONE", "serbatoio"),
        ("A-11005", "A-11005 SEDI-FLOTTATORE", "apparecchio"),
        ("MX11000", "MX11000", "mixer"),
        ("MX11001", "MX11001", "mixer"),
        ("P11000A", "P11000A", "pompa"),
        ("P11000B", "P11000B", "pompa"),
        ("P11001A", "P11001A", "pompa"),
        ("P11001B", "P11001B", "pompa"),
        ("P11002A", "P11002A", "pompa"),
        ("P11002B", "P11002B", "pompa"),
        ("110AIT01", "110AIT01", "strumento"),
        ("110FIT01", "110FIT01", "strumento"),
    ],
    "sediflottazione-a": [
        ("TK-11000", "TK-11000 SODA", "serbatoio"),
        ("TK-11001", "TK-11001 ACIDO SOLF.", "serbatoio"),
        ("TK-11002", "TK-11002 COAGULANTE", "serbatoio"),
        ("TK-11100A", "TK-11100A COAGULAZIONE", "serbatoio"),
        ("TK-11104", "TK-11104 POLIELETTROLITA", "serbatoio"),
        ("A-11005A", "A-11005A SEDI-FLOTTATORE", "apparecchio"),
        ("A-11120", "A-11120 CHIARIFICATO", "apparecchio"),
        ("A-11121", "A-11121 FANGHI", "apparecchio"),
        ("MX11107A", "MX11107A", "mixer"),
        ("MX11107B", "MX11107B", "mixer"),
        ("MX11107C", "MX11107C", "mixer"),
    ],
    "trattamento-fanghi": [
        ("TK-11016", "TK-11016", "serbatoio"),
        ("TK-11017", "TK-11017", "serbatoio"),
        ("V-1010", "V-1010 OMOGENEIZZAZ. FANGHI", "apparecchio"),
        ("MX11009A", "MX11009A", "mixer"),
        ("MX11009B", "MX11009B", "mixer"),
        ("MX11009C", "MX11009C", "mixer"),
        ("EM10103", "EM10103", "mixer"),
        ("P11005A", "P11005A", "pompa"),
        ("P11005B", "P11005B", "pompa"),
        ("P11030A", "P11030A", "pompa"),
        ("P11030B", "P11030B", "pompa"),
        ("P10102A", "P10102A", "pompa"),
        ("P10102B", "P10102B", "pompa"),
        ("XV11069", "XV11069", "valvola"),
        ("XV11034", "XV11034", "valvola"),
        ("110LIT05", "110LIT05", "strumento"),
        ("110LIT06", "110LIT06", "strumento"),
        ("110LIT12", "110LIT12", "strumento"),
        ("110FIT15", "110FIT15", "strumento"),
    ],
    "actiflo": [
        ("TK107", "TK107", "serbatoio"),
        ("TK108", "TK108", "serbatoio"),
        ("DEP108", "DEP108", "apparecchio"),
        ("MX107", "MX107", "mixer"),
        ("MX108A", "MX108A", "mixer"),
        ("MX108B", "MX108B", "mixer"),
        ("MX108C", "MX108C", "mixer"),
        ("MX108D", "MX108D", "mixer"),
        ("P108A", "P108A", "pompa"),
        ("P108B", "P108B", "pompa"),
        ("FIT101", "FIT101", "strumento"),
        ("AIT107C", "AIT107C", "strumento"),
        ("PIT108A", "PIT108A", "strumento"),
        ("LSH107", "LSH107", "strumento"),
        ("XV103A", "XV103A", "valvola"),
        ("XV106B", "XV106B", "valvola"),
    ],
    "reattivi-actiflo": [
        ("TK104", "TK104 COAGULANTE", "serbatoio"),
        ("TK101", "TK101 SODA", "serbatoio"),
        ("TK102", "TK102 CLORURO DI CALCIO", "serbatoio"),
        ("TK103", "TK103 ACIDO", "serbatoio"),
        ("TK111", "TK111 ANTISCHIUMA", "serbatoio"),
        ("PK106", "PK106 POLIPREPARATORE", "apparecchio"),
        ("P106A", "P106A", "pompa"),
        ("P106B", "P106B", "pompa"),
        ("P104A", "P104A", "pompa"),
        ("P104B", "P104B", "pompa"),
        ("P104C", "P104C", "pompa"),
        ("P101A", "P101A", "pompa"),
        ("P101B", "P101B", "pompa"),
        ("P102A", "P102A", "pompa"),
        ("P102B", "P102B", "pompa"),
        ("P103A", "P103A", "pompa"),
        ("P103B", "P103B", "pompa"),
        ("P111A", "P111A", "pompa"),
        ("P111B", "P111B", "pompa"),
    ],
    "uscita-actiflo": [
        ("TK110", "TK110", "serbatoio"),
        ("TK109", "TK109", "serbatoio"),
        ("MX109", "MX109", "mixer"),
        ("P110A", "P110A", "pompa"),
        ("P110B", "P110B", "pompa"),
        ("LIT110B", "LIT110B", "strumento"),
        ("LIT109", "LIT109", "strumento"),
    ],
    "holdup-area-nord": [
        ("S-817", "S-817", "serbatoio"),
        ("S-818", "S-818", "serbatoio"),
        ("S-813", "S-813", "serbatoio"),
        ("A-10605", "A-10605", "apparecchio"),
        ("P-13001A", "P-13001A", "pompa"),
        ("P-13001B", "P-13001B", "pompa"),
        ("P-13005A", "P-13005A", "pompa"),
        ("P-13005B", "P-13005B", "pompa"),
    ],
    "holdup-pgs-ovest": [
        ("TK8066", "TK8066", "serbatoio"),
        ("TK8063", "TK8063", "serbatoio"),
        ("P-13000A", "P-13000A", "pompa"),
        ("P-13000B", "P-13000B", "pompa"),
        ("XV8066_1HU", "XV8066_1HU", "valvola"),
        ("XV001HN_HU", "XV001HN_HU", "valvola"),
    ],
    "vasche-api-s851": [
        ("S-851", "S-851", "serbatoio"),
        ("P-13007A", "P-13007A", "pompa"),
        ("P-13007B", "P-13007B", "pompa"),
        ("AI_001", "AI_001", "strumento"),
        ("LT_851", "LT_851", "strumento"),
        ("LI_851_A", "LI_851_A", "strumento"),
        ("LSH-851A", "LSH-851A", "strumento"),
        ("LCV_31A", "LCV_31A", "valvola"),
        ("XV001HU", "XV001HU", "valvola"),
    ],
    "assetto-200": [
        ("P11040A", "P11040A", "pompa"),
        ("P11040B", "P11040B", "pompa"),
        ("P11040C", "P11040C", "pompa"),
        ("XV11093", "XV11093", "valvola"),
        ("XV11094", "XV11094", "valvola"),
        ("XV11201", "XV11201", "valvola"),
        ("FCV_1000", "FCV_1000", "valvola"),
        ("TT_1000", "TT_1000", "strumento"),
        ("AIT_1000", "AIT_1000", "strumento"),
        ("S-837", "S-837", "serbatoio"),
        ("111_LI_837", "111_LI_837", "strumento"),
    ],
    "interconnecting": [
        ("S-829", "S-829", "serbatoio"),
        ("AIT107A", "AIT107A", "strumento"),
        ("AIT107C", "AIT107C", "strumento"),
        ("FCV_1000", "FCV_1000", "valvola"),
    ],
}


def guess_kind(tid: str) -> str:
    u = tid.upper().replace("-", "")
    if re.match(r"^(P|PG|VP)\d", u):
        return "pompa"
    if re.match(r"^(XV|HV|FCV|LCV|V206X)", u):
        return "valvola"
    if u.startswith("TK") or re.match(r"^S\d", u):
        return "serbatoio"
    if u.startswith("FIL") or u.startswith("DEP") or re.match(r"^A\d", u):
        return "apparecchio"
    if re.match(r"^(FIT|AIT|TIT|LIT|LT|TT|PDT|PT|PIT|\d{2,3}(AIT|FIT|LIT|LT|TT|PT))", u):
        return "strumento"
    if u.startswith("MX") or u.startswith("EM") or u.startswith("RT"):
        return "mixer"
    if re.match(r"^K\d", u):
        return "compressor"
    return "altro"


def normalize_tag(raw: str) -> str | None:
    s = re.sub(r"\s+", "", str(raw or "").upper())
    s = s.replace("|", "I")
    # OCR classici
    s = re.sub(r"[^A-Z0-9_-]", "", s)
    if not s:
        return None
    # O confuso con 0 nei numeri strumentazione
    s = re.sub(r"^O(?=\d*(?:AIT|FIT|LIT|LT))", "0", s)
    s = re.sub(r"^O7AIT", "07AIT", s)
    # Canonizza prefissi comuni
    s = s.replace("TK", "TK-") if s.startswith("TK") and not s.startswith("TK-") and s[2:3].isdigit() else s
    s = re.sub(r"^TK-+", "TK-", s)
    s = re.sub(r"^FIL(?=\d)", "FIL-", s)
    s = re.sub(r"^HV(?=\d)", "HV", s)
    if OCR_NOISE.match(s):
        return None
    if not STRICT.match(s):
        return None
    # Scarta rumore corto numerico
    if re.fullmatch(r"\d{1,4}", s):
        return None
    return s


def catalog_tags(map_id: str) -> list[dict]:
    rows = CATALOGS.get(map_id, [])
    out = []
    cols = 6
    for i, row in enumerate(rows):
        if len(row) >= 5:
            tid, label, kind, x, y = row[0], row[1], row[2], float(row[3]), float(row[4])
            w, h = 0.045, 0.04
        else:
            tid, label, kind = row[0], row[1], row[2]
            r, c = divmod(i, cols)
            x = round(0.08 + c * 0.14, 4)
            y = round(0.16 + r * 0.12, 4)
            w, h = 0.06, 0.06
        out.append(
            {
                "id": tid,
                "label": label,
                "kind": kind,
                "x": round(x, 4),
                "y": round(y, 4),
                "w": w,
                "h": h,
                "source": "catalog",
            }
        )
    return out


def prepare_image(path: Path, scale: float = 2.2) -> Image.Image:
    im = Image.open(path).convert("L")
    im = ImageOps.autocontrast(im, cutoff=2)
    im = ImageEnhance.Contrast(im).enhance(1.5)
    im = ImageEnhance.Sharpness(im).enhance(2.0)
    im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=140, threshold=2))
    if scale != 1:
        w, h = im.size
        im = im.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    return im


def ocr_image(path: Path) -> list[dict]:
    # HQ ~3500px: upscale leggero; vecchie ~900px: upscale piu forte
    with Image.open(path) as probe:
        base_w = probe.size[0]
    scale = 1.35 if base_w >= 2000 else 2.2
    im = prepare_image(path, scale=scale)
    iw, ih = Image.open(path).size
    by_id: dict[str, dict] = {}

    for psm in (11, 6):
        cfg = (
            f"--oem 3 --psm {psm} "
            r"-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_ "
            r"-c preserve_interword_spaces=1"
        )
        data = pytesseract.image_to_data(
            im, lang="eng", config=cfg, output_type=pytesseract.Output.DICT
        )
        n = len(data["text"])
        for i in range(n):
            try:
                conf = float(data["conf"][i])
            except Exception:
                conf = -1
            if conf < 45:
                continue
            text = (data["text"][i] or "").strip()
            if not text:
                continue
            # unisci con successiva se sembra spezzato (P110 + 24A)
            joined = text
            if i + 1 < n:
                nxt = (data["text"][i + 1] or "").strip()
                if nxt:
                    joined = f"{text}{nxt}"

            cands = set()
            for piece in (text, joined):
                for m in TAG_FIND.finditer(piece):
                    tid = normalize_tag(m.group(0))
                    if tid:
                        cands.add(tid)
                tid2 = normalize_tag(piece)
                if tid2:
                    cands.add(tid2)
            if not cands:
                continue

            x = data["left"][i] / scale
            y = data["top"][i] / scale
            w = max(8, data["width"][i] / scale)
            h = max(8, data["height"][i] / scale)
            pad = 3
            x0 = max(0, x - pad)
            y0 = max(0, y - pad)
            x1 = min(iw, x + w + pad)
            y1 = min(ih, y + h + pad)
            box = {
                "x": round(x0 / iw, 4),
                "y": round(y0 / ih, 4),
                "w": round(max(0.02, (x1 - x0) / iw), 4),
                "h": round(max(0.03, (y1 - y0) / ih), 4),
            }
            for tid in cands:
                if OCR_NOISE.match(tid):
                    continue
                prev = by_id.get(tid)
                if not prev or conf > prev["confidence"]:
                    by_id[tid] = {
                        "id": tid,
                        "label": tid,
                        "kind": guess_kind(tid),
                        **box,
                        "confidence": round(conf, 1),
                        "source": "ocr",
                    }

    return sorted(by_id.values(), key=lambda t: t["id"])


def merge_tags(existing: list[dict], *extras: list[dict]) -> list[dict]:
    index = {str(t.get("id", "")).upper(): i for i, t in enumerate(existing)}
    out = list(existing)
    for group in extras:
        for o in group:
            key = str(o["id"]).upper()
            i = index.get(key)
            if i is None:
                out.append(dict(o))
                index[key] = len(out) - 1
                continue
            cur = out[i]
            if cur.get("locked") or cur.get("source") == "manual":
                continue
            # OCR con box reale batte catalogo grid
            prefer_ocr = o.get("source") == "ocr" and o.get("confidence", 0) >= 45
            prefer_existing_ocr = cur.get("source") == "ocr" and cur.get("confidence", 0) >= 45
            if prefer_ocr and not prefer_existing_ocr:
                out[i] = {
                    **cur,
                    "x": o["x"],
                    "y": o["y"],
                    "w": o["w"],
                    "h": o["h"],
                    "kind": cur.get("kind") or o.get("kind"),
                    "label": cur.get("label") or o.get("label"),
                    "confidence": o.get("confidence"),
                    "source": "ocr",
                }
            elif cur.get("source") == "seed" and o.get("source") in ("catalog", "ocr"):
                # aggiorna metadata ma tieni box seed se presente e sensato
                out[i] = {
                    **cur,
                    "label": cur.get("label") or o.get("label"),
                    "kind": cur.get("kind") or o.get("kind"),
                    "source": o.get("source") or cur.get("source"),
                }
    return out


def process_one(json_path: Path) -> tuple[str, int, int]:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    map_id = data["id"]
    img_rel = data.get("image") or f"assets/maps/{map_id}.png"
    img_path = ROOT / img_rel
    if not img_path.exists():
        img_path = MAPS / f"{map_id}.png"
    if not img_path.exists():
        print("SKIP missing image", map_id)
        return map_id, len(data.get("tags") or []), 0

    with Image.open(img_path) as im:
        data["width"], data["height"] = im.size

    before = len(data.get("tags") or [])
    # riparti da catalogo + OCR (mantieni solo manual/locked)
    kept = [
        t
        for t in (data.get("tags") or [])
        if t.get("locked") or t.get("source") == "manual"
    ]
    cat = catalog_tags(map_id)
    ocr = ocr_image(img_path)
    # Preferisci coordinate OCR quando confidenza alta; catalogo per i tag che OCR non vede
    if map_id == "sediflottatore-b" and before > 40:
        base = data.get("tags") or []
        data["tags"] = merge_tags(base, ocr, cat)
    elif map_id == "filtrazione-carboni":
        # Catalogo ha coordinate curate; OCR aggiunge solo tag fuori catalogo
        data["tags"] = merge_tags(kept, ocr, cat)
        cat_pos = {str(t["id"]).upper(): t for t in cat}
        fixed = []
        for t in data["tags"]:
            if t.get("locked") or t.get("source") == "manual":
                fixed.append(t)
                continue
            c = cat_pos.get(str(t["id"]).upper())
            if c:
                fixed.append(
                    {
                        **t,
                        "x": c["x"],
                        "y": c["y"],
                        "w": c["w"],
                        "h": c["h"],
                        "label": c.get("label") or t.get("label"),
                        "kind": c.get("kind") or t.get("kind"),
                        "source": "catalog",
                    }
                )
            else:
                fixed.append(t)
        data["tags"] = fixed
    else:
        data["tags"] = merge_tags(kept, cat, ocr)

    # Pulisci rumore OCR residuo
    data["tags"] = [
        t
        for t in data["tags"]
        if t.get("id") and not OCR_NOISE.match(str(t["id"]))
    ]
    # Dedup per id (case-insensitive), preferisci OCR posizionato / catalogo con label
    dedup: dict[str, dict] = {}
    for t in data["tags"]:
        key = str(t["id"]).upper()
        prev = dedup.get(key)
        if not prev:
            dedup[key] = t
            continue
        score = (2 if t.get("source") == "ocr" and t.get("confidence", 0) >= 60 else 0) + (
            1 if t.get("source") == "catalog" else 0
        )
        prev_score = (
            2 if prev.get("source") == "ocr" and prev.get("confidence", 0) >= 60 else 0
        ) + (1 if prev.get("source") == "catalog" else 0)
        if score > prev_score or (
            score == prev_score and len(str(t.get("label") or "")) > len(str(prev.get("label") or ""))
        ):
            # tieni label migliore
            if prev.get("label") and len(str(prev["label"])) > len(str(t.get("label") or "")):
                t = {**t, "label": prev["label"], "kind": t.get("kind") or prev.get("kind")}
            dedup[key] = t
    data["tags"] = sorted(dedup.values(), key=lambda t: str(t["id"]))

    data["seedRev"] = SEED_REV
    data["notes"] = "Tag catalogo + OCR. Usa Riposiziona per affinare i box."
    json_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    after = len(data["tags"])
    print(f"{map_id:30} {before:3} -> {after:3}  (catalog {len(cat)} ocr {len(ocr)})")
    return map_id, before, after


def main() -> None:
    only = set(sys.argv[1:]) if len(sys.argv) > 1 else None
    paths = sorted(p for p in DATA.glob("*.json") if p.name != "manifest.json")
    if only:
        paths = [p for p in paths if p.stem in only]
    totals = []
    for p in paths:
        totals.append(process_one(p))
    print("---")
    print("maps", len(totals), "tags total", sum(t[2] for t in totals))


if __name__ == "__main__":
    main()

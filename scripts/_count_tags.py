from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
total = 0
for p in sorted((root / "data").glob("*.json")):
    if p.name == "manifest.json":
        continue
    d = json.loads(p.read_text(encoding="utf-8"))
    n = len(d.get("tags") or [])
    total += n
    print(f"{d.get('id'):30} {n:3} rev={d.get('seedRev')}")
print("TOTAL", total)

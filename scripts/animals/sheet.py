"""Joins the frames rig.py rendered (its _<name>.manifest) into <name>-sheet.png and deletes them: python scripts/animals/sheet.py <dir> <name>"""
import sys, os
from PIL import Image

d, name = sys.argv[1:3]
rows = {}
for line in open(os.path.join(d, f"_{name}.manifest")).read().splitlines():
    r, i, f = line.split(" ", 2)
    rows.setdefault(int(r), {})[int(i)] = f
w, h = Image.open(next(iter(rows[0].values()))).size
sheet = Image.new("RGB", (w * max(len(v) for v in rows.values()), h * len(rows)))
for r, row in rows.items():
    for i, f in row.items():
        sheet.paste(Image.open(f).convert("RGB"), (i * w, r * h))
        os.remove(f)
sheet.save(os.path.join(d, f"{name}-sheet.png"))
os.remove(os.path.join(d, f"_{name}.manifest"))

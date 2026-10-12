"""Writes src/poc3d/real/faunaCredits.ts (what the in-game credits screen lists for the animals) from the rows in
src/poc3d/real/faunaRows.ts: only models that a city really uses (a row with a simulated kind; a file that has a rigged
version is credited once, as the model it was made from). Titles and authors come from .cache/animals/poly/<id>/source.json
(scripts/animals/polypizza.py wrote them when the model was fetched).

    python scripts/animals/credits.py          (rewrite the file; also prints CREDITS.md's lines for section 1)
"""
import json, os, re, sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
os.chdir(ROOT)

ns = {}
src = open("scripts/animals/rigs/_make.py", encoding="utf-8").read()
exec("import os\nHERE='.'\n" + src[src.index("RIGS = {"):src.index("for name, (cid")], ns)
RIGS = {n: v[0] for n, v in ns["RIGS"].items()}
RIGS.update({"cat": "6dM1J6f6pm9", "gull_fly": "6Tpj_vcWP3f"})

rows = open("src/poc3d/real/faunaRows.ts", encoding="utf-8").read()
kinds = dict(re.findall(r"(\w+): (?:'(\w+)'|null)", rows[rows.index("ROW_KIND"):rows.index("};", rows.index("ROW_KIND"))]))
used = set()
rk = rows[rows.index("ROW_KIND"):rows.index("};", rows.index("ROW_KIND"))]
body = rows[rows.index("export const TOTO_ROWS"):]
for chunk in body.split(chr(10) + "  { key: '")[1:]:
    key = chunk[:chunk.index("'")]
    if not re.search(key + ": '", rk):
        continue  # a row whose animals are not in the street (the koi, the empty ones)
    for f in re.findall(r"from: '([^']+)'", chunk):
        if f == "built":
            continue
        used.add(RIGS[f[4:]] if f.startswith("rig:") else f)

by = {}
for cid in sorted(used):
    d = json.load(open(f".cache/animals/poly/{cid}/source.json", encoding="utf-8"))
    by.setdefault((d["author"], d["licence"]), []).append((d["title"], cid))

out = ["// Written by scripts/animals/credits.py from src/poc3d/real/faunaRows.ts: the animals the street uses, by author (the credits screen, district/startScreen.ts).\n",
       "export const ANIMAL_CREDITS: readonly { readonly author: string; readonly licence: string; readonly works: readonly string[] }[] = [\n"]
for (a, l), items in sorted(by.items(), key=lambda kv: kv[0][0].lower()):
    titles = sorted({t for t, _ in items})
    out.append(f"  {{ author: {json.dumps(a, ensure_ascii=False)}, licence: {json.dumps(l)}, works: {json.dumps(titles, ensure_ascii=False)} }},\n")
out.append("];\n")
open("src/poc3d/real/faunaCredits.ts", "w", encoding="utf-8", newline="\n").write("".join(out))

print(len(used), "models,", len(by), "authors")
for (a, l), items in sorted(by.items(), key=lambda kv: kv[0][0].lower()):
    print(f"- {a} ({l}): " + "; ".join(f"{t} (https://poly.pizza/m/{c})" for t, c in items))

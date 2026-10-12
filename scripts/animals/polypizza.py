"""Looks up and fetches models from Poly Pizza (poly.pizza) for the animals, with each one's licence read from its own page.

  python scripts/animals/polypizza.py search <word> [<word> ...]    list the models for each word: id, title, author, licence, animated, triangles
  python scripts/animals/polypizza.py get <id> [<id> ...]           download each .glb into .cache/animals/poly/<id>/ with a source.json (author, licence, page, day)

Poly Pizza lists the licence on every model page ("Licence": "CC0 1.0", or CC-BY 3.0 for Poly by Google's). CC0 owes nothing;
CC-BY needs its credit in CREDITS.md (.claude/rules/licences.md). Nothing here goes into the game: a model is brought in by a
build script and reviewed in a showroom first.
"""
import json, re, sys, os, time, urllib.request, datetime

sys.stdout.reconfigure(encoding="utf-8")

UA = {"User-Agent": "Mozilla/5.0 (rainy-place animal survey)"}
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", ".cache", "animals", "poly")


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def meta(pid):
    h = fetch(f"https://poly.pizza/m/{pid}").decode("utf-8", "replace")
    m = re.search(r'window.__SERVER_APP_STATE__ =\s*(\{.*?\})</script>', h, re.S)
    d = json.loads(m.group(1))["initialData"]["model"]
    return d


def search(word):
    h = fetch(f"https://poly.pizza/search/{word}").decode("utf-8", "replace")
    ids = []
    for m in re.finditer(r'href="/m/([^"]+)"', h):
        if m.group(1) not in ids:
            ids.append(m.group(1))
    return ids


def main():
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "search":
        seen = set()
        for w in args:
            print(f"== {w}")
            time.sleep(3)
            try:
                found = search(w)[:40]
            except Exception as e:
                print('  (no results)', e)
                continue
            for pid in found:
                if pid in seen:
                    continue
                seen.add(pid)
                time.sleep(0.6)
                try:
                    d = meta(pid)
                except Exception as e:
                    continue
                print(pid, "|", d["Title"], "|", d["Creator"]["Username"], "|", d.get("Licence"), "| anim" if d.get("Animated") else "| static", "|", d.get("Tris"))
    elif cmd == "get":
        for pid in args:
            time.sleep(2)  # (the site answers 429 to a fast run)
            d = meta(pid)
            out = os.path.join(ROOT, pid)
            os.makedirs(out, exist_ok=True)
            data = fetch(f"https://static.poly.pizza/{d['ResourceID']}.glb")
            open(os.path.join(out, "model.glb"), "wb").write(data)
            src = {"title": d["Title"], "author": d["Creator"]["Username"], "licence": d.get("Licence"), "page": f"https://poly.pizza/m/{pid}",
                   "animated": d.get("Animated"), "tris": d.get("Tris"), "fetched": datetime.date.today().isoformat()}
            json.dump(src, open(os.path.join(out, "source.json"), "w"), indent=1)
            print(pid, src["title"], src["author"], src["licence"], len(data), "bytes")


main()

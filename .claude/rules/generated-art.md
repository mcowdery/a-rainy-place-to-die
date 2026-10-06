---
paths:
  - "scripts/krea/**"
  - "assets/ads/briefs/**"
  - "src/poc3d/real/districtAds.ts"
  - "src/poc3d/real/sightline.ts"
  - "scripts/crop_ads.py"
  - "scripts/crop_district_ads.py"
  - "scripts/crop_wallpapers.py"
---

# Generated art (Krea Studio): propose, then review

Covers generating ad and signage art, the review flow, cropping and placing district ads. One of the area docs indexed in the root CLAUDE.md; one topic a paragraph.

Ad and signage art can be generated on request from Krea Studio (the VN generator, a local FastAPI server, default `http://127.0.0.1:7860`) with `scripts/krea/` (`studio.mjs` client, `ads.mjs` CLI). Only generate when the user asks for a batch. **Never wire generated images into the world without the user's approval.**

- Auth: `npm run krea:login` (interactive, once; caches only the session cookie in `.krea/session.json`, ~30 days). `.env.krea` (see `.env.krea.example`) can hold the URL and optional credentials; both are git-ignored. `npm run ads:status` checks the connection.

- A batch is a JSON brief in `assets/ads/briefs/` (format in the header of `ads.mjs`; `example-harbor-billboards.json` is a template). Prompts are the house style anchor, then the optional `ohwx julie` LoRA trigger (scale 0.85), then the item's subject, a composition hint for the `use` (taxi / poster / billboard / sign, which also sets the default size), then a no-lettering suffix (copy is composited in-engine). Model `krea-2-turbo`, 12 steps. `npm run ads:generate -- <brief> --dry-run` prints the exact prompts without submitting (generation costs GPU time).

- Output goes to `assets/ads/pending/<batch>/` (git-ignored): the PNGs, `manifest.json` (purpose, prompt, seed, LoRA and Studio job per image), `REVIEW.md` and `review.html`. Generations also appear in the user's Studio Staging Area.

- The user decides, usually in the browser: `npm run ads:serve` (`scripts/krea/review-server.mjs`, `127.0.0.1:5320`) makes each batch's `review.html` interactive. It has Approve / Reject / Undo buttons and a note per image ("why", or instructions for Claude). Approve moves the image to `assets/ads/source/NN_<item>.png` with a provenance `.json`; reject moves it to `pending/<batch>/rejected/`. Every decision and note is appended to `assets/ads/pending/feedback.jsonl`, and notes are also stored in the manifests. **Read the notes (`npm run ads:review`, or the feedback log) and act on them when the user says they've reviewed.** The CLI equivalents are `npm run ads:approve|reject -- <batch> <file> [--note ...]`. Only after approval, and when asked, crop it and add it to `models/ads.ts`. `node scripts/krea/ads.mjs approve-chosen` approves whatever the user moved into a `pending/<batch>/chosen/` folder.

- District ads (Kaburo): approved art in `assets/ads/source/` (committed, with provenance JSON) is cropped by `scripts/crop_district_ads.py` (per-image boxes, drops the generator's garbled lettering) into `assets/ads/kaburo/`; `DISTRICT_ADS` in `models/ads.ts` holds brand, copy and colours. `real/districtAds.ts` is the pure layout + placement run in the chunk workers (rooftop billboards, facade billboards skipping balcony fronts, shopfront poster lightboxes clear of vending machines and pots, and billboards on frames off the side walls that face a car park, playground or vacant lot; billboards and rooftop letters only where `real/sightline.ts` finds an open view from the street), and `DistrictAdAtlas` (`real/adAtlas.ts`) composites photo + copy on the main thread, uploading once when all photos have loaded.

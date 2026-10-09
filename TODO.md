# To do

Things decided or noticed that aren't done yet. Newest first within a section; strike an item out (or delete it) when it's done. Area-specific work belongs in the area docs (`.claude/rules/`), not here.

## Repository, security and upkeep

- [x] **Licence**: decided 2026-10-09, keep it closed (no `LICENSE` file: all rights reserved; the third-party assets keep their own licences, `CREDITS.md`). Revisit only if you want to open the code.
- [x] **Branch protection on `main`** (2026-10-09): the `check` CI job must pass; no force pushes or deletions; you (the admin) can still bypass. Changes reach `main` through pull requests from `vn-prototype` or another branch.
- [ ] **Formatting**: `.editorconfig` and `.gitattributes` are in (2026-10-09). **Prettier is not adopted**: measured, it would rewrite 285 of 314 source files (the code is hand-formatted, long lines on purpose), ruining `git blame` and colliding with every session's edits. Only worth doing if you want it, in one quiet moment (no other session mid-edit) as a commit of its own.
- [ ] **Dev-tooling advisories** (`npm audit`: braces, micromatch, source-map-js, all denial of service in build tools): Dependabot security updates are on and will open PRs; `@gltf-transform/cli`'s only offered fix is a downgrade, so leave it.
- [ ] **Delete the history backup** `../rainy-place-backup-2026-10-09.git` (a mirror of the repository from before the history was cleaned; it still holds the removed material, so never push it anywhere). Also delete `../rainy-clean.git` and `../purge-paths.txt` (scratch from the rewrite). Decided 2026-10-09: keep it for a while first.
- [ ] **Old commits on GitHub.** After the 2026-10-09 history rewrite the old commits are unreachable from any branch but GitHub may still serve them by hash. Not urgent (private until then, no forks). To be certain: ask GitHub Support to garbage-collect, or delete and recreate the repository and push the clean history.
- [ ] **Credits and notices before any release.** `CREDITS.md`: the game has no credits screen, and section 1's credits have to be shown to players and section 2's notices shipped in the build. Blocked on the game having a menu screen and a story (neither exists yet).
- [ ] **CI cost.** CI (`.github/workflows/ci.yml`) runs everything on every push, including `build:all` (three editions). Open: split it, cheap checks on every push and `build:all` only on `main`, pull requests and manual runs. The repository is public now, so minutes aren't a worry; revisit if runs get slow.
- [ ] **Monthly audit** runs as a scheduled cloud routine (`npm run audit`, `npm audit`, dead code, file sizes); read its report and act on it. Manage it at https://claude.ai/code/routines.
- [ ] **Baseline audit, 2026-10-09 (the first cloud run): PASS.** Typecheck clean, 598 tests in 55 files passed, `npm run audit` passed, `build:all` built all three editions and each held only its own files. Findings to act on are the next four items.
- [x] **Procedural nude bodies** (2026-10-09, decided: move out and purge history): the bare woman's detail (nipples and colour, pubic hair, the marks at the foot of the cleft) is in `adult/src/mobBare.ts`, hooked in by `real/mobBare.ts`; geometry of 4,608 figures byte-identical with the hooks (details in `mob-bodies.md`). Tip is done; **the history purge is the next item.** Still public: the smooth bare body (`nude` outfits, `koharu_bare`, the `mack_nude` outfit entry), which is a mannequin's.
- [ ] **Purge the bare-body detail from history** (needs one more force-push; main's branch protection lifted for it, then restored): `mobShape.ts`'s old versions, `mob-bodies.md` and the ad briefs' old versions. Scrub script in progress.
- [ ] **Configure knip** (dead-code finder, used by the monthly audit): it found no unused files or exports in a repo this size, so it isn't configured (add `knip.json` with the HTML pages and `scripts/` as entry points). It also lists `@gltf-transform/cli` as an unused devDependency; check whether it is only used by hand, and if so drop it (it is also the source of the `braces` advisory).
- [ ] **`src/` files in no doc's paths: 38** (was 36); `npm run audit` names them.
- [ ] **Split the largest files**: `district/main.ts` (about 4,200 lines; other sessions edit it constantly, so split it only when none is mid-edit), `real/mobShape.ts` (3,270 after the first split: mesh operations went to `real/mobMesh.ts` on 2026-10-09 with geometry byte-identical; the next seam is the body-detail tables and `buildShaped`, about 2,100 lines), `real/people.ts` (3,000). `npm run audit` lists them. Method that worked: fingerprint the output of every combination before, move code unchanged, fingerprint after.
- [ ] **Area-doc gaps**: src files in no doc's `paths:` (`npm run audit`, "docs" note): `showroom/poser.ts`, `real/characterPose.ts`, `real/mobCharacters.ts`, `fight/weaponRack.ts`.
- [ ] **Git LFS**, if the pack keeps growing: every regenerated `.glb`, ad or track adds a full copy (the pack is about 510 MB, nearly all assets).
- [x] **The nude Kana brief's references**: the brief is in `adult/assets/ads/briefs/`; `generated-art.md` still names it (a file name only), left.

## Game

- [ ] **A menu screen and a story**: the game has neither yet (it blocks the credits screen above).

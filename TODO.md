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
- [ ] **Split the largest files**: `district/main.ts` (about 4,200 lines), `real/mobShape.ts` (3,800), `real/people.ts` (3,000). `npm run audit` lists them.
- [ ] **Area-doc gaps**: src files in no doc's `paths:` (`npm run audit`, "docs" note): `showroom/poser.ts`, `real/characterPose.ts`, `real/mobCharacters.ts`, `fight/weaponRack.ts`.
- [ ] **Git LFS**, if the pack keeps growing: every regenerated `.glb`, ad or track adds a full copy (the pack is about 510 MB, nearly all assets).
- [ ] **Move the nude Kana brief's references**: `.claude/rules/generated-art.md` still names `figure-apose-nude-kana`, whose brief now lives in `adult/assets/ads/briefs/`.

## Game

- [ ] **A menu screen and a story**: the game has neither yet (it blocks the credits screen above).

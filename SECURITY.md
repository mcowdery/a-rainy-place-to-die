# Security

This is a single-player browser game with no server and no accounts. The things that could matter are the dev server's local endpoints (they write files, so they answer on localhost only and refuse cross-site requests), the build pipeline and the dependencies.

**Reporting a problem:** please use GitHub's private reporting ([Security tab, "Report a vulnerability"](https://github.com/mcowdery/a-rainy-place-to-die/security/advisories/new)) rather than a public issue. Expect an answer within a few days; this is a hobby project.

Secrets (API keys, session cookies) are kept in git-ignored files and never committed; GitHub secret scanning and push protection are on.

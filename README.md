# SGEN Migration QA

Deterministic, evidence-based website **migration certification** — no AI at runtime, no guessing. Verifies
that a migrated site is **complete**, **visually accurate**, and **production safe**. Runs locally and binds
`127.0.0.1` only; nothing leaves the machine.

## Four tools
1. **Site Audit** — one site: links, forms, accessibility (axe-core / WCAG), SEO, performance, security (TLS), cross-browser (Firefox + WebKit).
2. **Visual Comparison** — two sites, screen by screen, across the six SGEN breakpoints (1920 / 1199 / 991 / 767 / 575 / 480) with pixel + structural diff.
3. **Migration Certification** — the sign-off pipeline: `Inventory → Completeness → Visual → Production → Certification`, with stable inventory IDs, evidence, and a three-state verdict (PASS / PASS WITH MINOR ISSUES / FAIL).
4. **Reports** — history, HTML + JSON reports, evidence assets.

## Quick start
```
powershell -ExecutionPolicy Bypass -File .\install.ps1
qa qa-serve        # open http://127.0.0.1:7878
```
See **[INSTALL.md](INSTALL.md)** for requirements + update instructions, and
**[lib/site-qa/OPERATOR-GUIDE-v1.0.md](lib/site-qa/OPERATOR-GUIDE-v1.0.md)** before signing off a migration.

## Update / verify
```
qa update          # pull the latest patch, reinstall deps only if changed, re-run the smoke test
qa selftest        # offline health check (deps, registry, unit tests, UI boots)
qa version         # shipped build + engine/registry versions
qa rollback        # revert to the previous release
```

## Requirements
Node.js 18+ · deps `playwright` + `sharp` · Chromium (installed by `install.ps1`).

## What it will not do
Fake a green result. A capped crawl never yields an authoritative completeness verdict; findings without
proof are marked *Manual Verification Required*, never silently passed.

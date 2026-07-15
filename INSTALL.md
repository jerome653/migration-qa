# SGEN Migration QA — Install & Update

Deterministic, evidence-based website migration certification. Four tools: Site Audit · Visual Comparison ·
Migration Certification · Reports. Runs locally, binds `127.0.0.1` only — no data leaves the machine.

## Requirements
- **Node.js 18+**
- Internet on first install (pulls `playwright` + `sharp` and the Chromium browser)
- ~400 MB free (mostly the browser)

## Install
```
git clone https://github.com/jerome653/migration-qa.git
cd migration-qa
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
The installer checks Node, installs dependencies, installs Chromium, writes a `qa.cmd` launcher, and runs
the smoke test. (macOS/Linux: `npm ci --omit=dev && npx playwright install chromium && node sgen-selftest.js`.)

## Run
```
qa qa-serve        # then open http://127.0.0.1:7878
```
Or a single tool from the CLI: `qa qa-certify <source> --target <target> --sitemap-only`.
**Read `OPERATOR-GUIDE-v1.0.md` before signing off any migration.**

## Update (easy patching)
```
qa update          # git pull latest patch, reinstall deps only if changed, re-run selftest
qa version         # show the shipped build + engine/registry versions
qa rollback        # revert to the previous release if a patch misbehaves
```
Because the tool is plain JavaScript (no build step), a patch is a commit and an update is a pull — pulled
files run immediately. `qa update` is fast-forward-only and re-runs the smoke test after every pull.

## Verify anytime
```
qa selftest        # offline: deps, rule registry, unit tests, UI boots — exit 0 = healthy
```

## Full docs (in `lib/site-qa/`)
`OPERATOR-GUIDE-v1.0.md` · `RELEASE-FREEZE-v1.0.md` · `SHIP-AND-UPDATE-STRATEGY.md` ·
`OPERATOR-CERTIFICATION-v1.0.md` · `MIGRATION-QA-CERTIFICATION.md`

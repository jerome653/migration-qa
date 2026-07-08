#!/usr/bin/env node
'use strict';
// sgen update — pull the latest patch and re-verify. Fast-forward only (a locally-edited tree fails loudly
// instead of silently merging). Re-installs deps ONLY when the lockfile moved, browsers ONLY when the
// Playwright version moved, then runs the smoke test. exit 0 = updated + healthy.
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
function root() { try { return execSync('git rev-parse --show-toplevel', { cwd: __dirname }).toString().trim(); } catch (_) { return null; } }
function sh(cmd, cwd) { return spawnSync(cmd, { cwd, stdio: 'inherit', shell: true }).status; }
function hash(f) { try { return require('crypto').createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } catch (_) { return ''; } }
function pwVer(cwd) { try { return require(path.join(cwd, 'node_modules/playwright/package.json')).version; } catch (_) { return ''; } }

const dir = root();
if (!dir) { console.error('sgen update: not a git checkout — updates need the git-backed install (see SHIP-AND-UPDATE-STRATEGY.md).'); process.exit(2); }
const lock = path.join(dir, 'package-lock.json');
const before = { lock: hash(lock), pw: pwVer(dir) };

console.log('▶ sgen update — fetching…');
if (sh('git fetch --tags --prune', dir) !== 0) { console.error('git fetch failed'); process.exit(1); }
if (sh('git pull --ff-only', dir) !== 0) { console.error('git pull --ff-only failed (local changes? commit or stash them first)'); process.exit(1); }

if (hash(lock) !== before.lock) { console.log('▶ dependencies changed → npm ci'); if (sh('npm ci --omit=dev', dir) !== 0) process.exit(1); }
else console.log('· dependencies unchanged');
if (pwVer(dir) !== before.pw) { console.log('▶ Playwright changed → installing browsers'); sh('npx playwright install chromium', dir); }
else console.log('· Playwright unchanged');

console.log('▶ verifying (selftest)…');
const st = spawnSync(process.execPath, [path.join(__dirname, 'sgen-selftest.js')], { stdio: 'inherit' });
if (st.status !== 0) { console.error('\n⚠ selftest FAILED after update — consider `sgen rollback`.'); process.exit(1); }
console.log('\n✅ updated + healthy.');
process.exit(0);

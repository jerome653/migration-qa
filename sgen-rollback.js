#!/usr/bin/env node
'use strict';
// sgen rollback [<tag|sha>] — revert to a previous release (default: the tag before HEAD). Instant undo
// for a bad patch. Checks out the target ref, then runs the smoke test. exit 0 = rolled back + healthy.
const path = require('path');
const { execSync, spawnSync } = require('child_process');
function git(a, opts) { return execSync('git ' + a, Object.assign({ cwd: root(), stdio: ['ignore', 'pipe', 'ignore'] }, opts)).toString().trim(); }
function root() { try { return execSync('git rev-parse --show-toplevel', { cwd: __dirname }).toString().trim(); } catch (_) { return null; } }
const dir = root();
if (!dir) { console.error('sgen rollback: not a git checkout (see SHIP-AND-UPDATE-STRATEGY.md).'); process.exit(2); }

let target = process.argv[2];
if (!target) { try { target = execSync('git describe --tags --abbrev=0 HEAD^', { cwd: dir }).toString().trim(); } catch (_) {} }
if (!target) { console.error('sgen rollback: no target ref and no previous tag found. Pass one: sgen rollback v1.0.0'); process.exit(2); }

console.log('▶ rolling back to ' + target + ' …');
if (spawnSync('git', ['checkout', target], { cwd: dir, stdio: 'inherit' }).status !== 0) { console.error('checkout failed'); process.exit(1); }
const st = spawnSync(process.execPath, [path.join(__dirname, 'sgen-selftest.js')], { stdio: 'inherit' });
console.log(st.status === 0 ? '\n✅ rolled back to ' + target + ' + healthy.' : '\n⚠ rolled back but selftest failed.');
process.exit(st.status === 0 ? 0 : 1);

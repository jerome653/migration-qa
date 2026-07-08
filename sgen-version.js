#!/usr/bin/env node
'use strict';
// sgen version — prints the shipped commit + engine/registry versions so any run is traceable to a build.
const path = require('path');
const { execSync } = require('child_process');
function git(a) { try { return execSync('git ' + a, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) { return null; } }
let reg = '?', eng = '?';
try { reg = require('./lib/site-qa/rules/registry').REGISTRY_VERSION || '?'; } catch (_) {}
try { eng = require('./lib/site-qa/inventory/versions').SCHEMA.migrationQaEngine; } catch (_) {}
const desc = git('describe --tags --always --dirty') || git('rev-parse --short HEAD') || 'unknown';
console.log('SGEN Migration QA');
console.log('  build:    ' + desc);
console.log('  engine:   ' + eng);
console.log('  registry: v' + reg);
console.log('  node:     ' + process.version);
process.exit(0);

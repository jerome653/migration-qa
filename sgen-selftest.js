#!/usr/bin/env node
'use strict';
// sgen selftest — fast, offline smoke test. Verifies the install is healthy: Node version, required
// files, third-party deps resolve, rule registry loads, inventory unit tests pass, and the qa-serve UI
// boots + serves its four tools. No network, no real site scan. exit 0 = healthy, 1 = a check failed.
// This is the gate `sgen update` runs after every pull, and the release gate before a commit ships.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');

const BIN = __dirname;
let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); failed++; };

function check(name, fn) { try { const r = fn(); if (r && r.then) return r; if (r === false) bad(name); else ok(typeof r === 'string' ? r : name); } catch (e) { bad(name + ' — ' + (e && e.message || e)); } }

async function main() {
  console.log('SGEN Migration QA — selftest\n');

  // 1. Node version
  const major = parseInt(process.versions.node.split('.')[0], 10);
  major >= 18 ? ok('Node ' + process.version + ' (>= 18)') : bad('Node ' + process.version + ' is below 18');

  // 2. Required files
  const need = ['sgen.js', 'sgen-qa-serve.js', 'sgen-qa-certify.js', 'sgen-qa-visual-match.js',
    'lib/site-qa/audit.js', 'lib/site-qa/visual-match.js', 'lib/site-qa/rules/registry.js',
    'lib/site-qa/inventory/certify-pipeline.js', 'lib/migration-qa/crawl.js'];
  const missing = need.filter(f => !fs.existsSync(path.join(BIN, f)));
  missing.length ? bad('missing files: ' + missing.join(', ')) : ok('all ' + need.length + ' core files present');

  // 3. Third-party deps resolve
  for (const dep of ['playwright', 'sharp']) {
    try { require.resolve(dep); ok('dep resolves: ' + dep); } catch (e) { bad('dep missing: ' + dep + ' (run: npm ci)'); }
  }

  // 4. Rule registry loads + validates
  try { const r = require('./lib/site-qa/rules/registry'); const n = (r.RULES || []).length; n >= 90 ? ok('registry loads: ' + n + ' rules v' + (r.REGISTRY_VERSION || '?')) : bad('registry only ' + n + ' rules'); }
  catch (e) { bad('registry failed to load: ' + e.message); }

  // 5. Inventory unit tests (spawn, check exit + assertion line)
  const t = spawnSync(process.execPath, [path.join(BIN, 'lib/site-qa/inventory/inventory.test.js')], { encoding: 'utf8' });
  /PASS/.test(t.stdout || '') && t.status === 0 ? ok('inventory unit tests: ' + ((t.stdout.match(/\d+\/\d+ assertions/) || ['?'])[0])) : bad('inventory unit tests failed (exit ' + t.status + ')');

  // 6. qa-serve boots + serves the four tools
  await new Promise((resolve) => {
    const PORT = 7897;
    const srv = spawn(process.execPath, [path.join(BIN, 'sgen-qa-serve.js'), '--port', String(PORT)], { stdio: 'ignore' });
    let tries = 0;
    const poll = () => {
      http.get('http://127.0.0.1:' + PORT + '/', (res) => {
        let b = ''; res.on('data', d => b += d); res.on('end', () => {
          // Tab 3 is 'Post-Deployment Check' (renamed from 'Migration Certification' in 2.5.x).
          // A case-sensitive 'Migration Certification' test here matched nothing on 2.5.x, so this
          // check failed on a perfectly healthy engine — which made `sgen update` report failure and
          // advise rollback on EVERY update. Match case-insensitively and accept either name, so the
          // test still holds if the CLI and the engine tree are at different versions.
          const body = String(b).toLowerCase();
          const tabs = ['site audit', 'visual comparison', 'reports'].every(s => body.includes(s))
            && ['post-deployment check', 'migration certification'].some(s => body.includes(s));
          res.statusCode === 200 && tabs ? ok('qa-serve boots + serves 4 tools (:' + PORT + ')') : bad('qa-serve served but incomplete');
          http.get('http://127.0.0.1:' + PORT + '/api/reports', (r2) => { r2.statusCode === 200 ? ok('/api/reports responds 200') : bad('/api/reports ' + r2.statusCode); r2.resume(); srv.kill(); resolve(); })
            .on('error', () => { bad('/api/reports unreachable'); srv.kill(); resolve(); });
        });
      }).on('error', () => { if (++tries > 20) { bad('qa-serve did not boot'); srv.kill(); resolve(); } else setTimeout(poll, 250); });
    };
    setTimeout(poll, 400);
  });

  console.log('\n' + (failed === 0 ? 'SELFTEST: PASS ✅' : 'SELFTEST: ' + failed + ' FAILED ❌'));
  process.exit(failed === 0 ? 0 : 1);
}
main();

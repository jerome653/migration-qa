#!/usr/bin/env node
'use strict';
// sgen qa-visual-match <reference-url> <candidate-url>
//   Compare a client's OLD LIVE site (reference) against the SGEN staging rebuild (candidate):
//   page-by-page, section-by-section, element-by-element, across mobile/tablet/desktop.
//   Emits pixel mismatch % + structural deltas (missing/extra/moved/restyled) + a match score.
//
//   --max-pages N     crawl cap per site (default 20)
//   --map <file>      old->new path map, one "oldpath,newpath" per line (if paths changed)
//   --out <dir>       output dir (default reports/visual-<host>-<stamp>)
//   --json            print machine summary

const fs = require('fs');
const path = require('path');
const { run } = require('./lib/site-qa/visual-match');
const { render } = require('./lib/site-qa/report-visual');

function parseArgs(argv) { const a = argv.slice(2); const o = { _: [] }; for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; o[k] = v; } else o._.push(a[i]); } return o; }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function usage(c) { process.stdout.write(`sgen qa-visual-match <reference-url> <candidate-url>\n\n  reference = old live site · candidate = SGEN staging rebuild\n  --max-pages N   crawl cap per site (default 20)\n  --map <file>    old,new path pairs per line (if URLs changed)\n  --out <dir>     output dir\n  --json          machine summary\n`); process.exit(c); }

(async () => {
  const o = parseArgs(process.argv);
  let [ref, cand] = o._;
  if (!ref || !cand) usage(2);
  if (!/^https?:\/\//i.test(ref)) ref = 'https://' + ref;
  if (!/^https?:\/\//i.test(cand)) cand = 'https://' + cand;

  let urlMap = null;
  if (o.map && typeof o.map === 'string' && fs.existsSync(o.map)) {
    urlMap = {}; for (const ln of fs.readFileSync(o.map, 'utf8').split(/\r?\n/)) { const [a, b] = ln.split(','); if (a && b) urlMap[a.trim().replace(/\/+$/, '') || '/'] = b.trim().replace(/\/+$/, '') || '/'; }
  }
  const host = (() => { try { return new URL(cand).host; } catch (e) { return 'site'; } })();
  const outDir = o.out ? path.resolve(o.out) : path.resolve(__dirname, '..', 'reports', `visual-${host}-${stamp()}`);

  process.stderr.write(`\n=== SGEN Visual Match ===\n  reference: ${ref}\n  candidate: ${cand}\n`);
  const data = await run(ref, cand, { maxPages: +o['max-pages'] || 20, urlMap, outDir, log: m => process.stderr.write('  ' + m + '\n'), progress: () => {} });
  const file = render(data, outDir);
  process.stderr.write(`\n  overall match: ${data.overall}%  ·  ${data.pairs} page(s)\n  report: ${file}\n`);
  if (o.json) process.stdout.write(JSON.stringify({ overall: data.overall, pairs: data.pairs, report: file }, null, 2) + '\n');
  process.exit(0);
})().catch(e => { process.stderr.write('visual-match failed: ' + (e && e.stack || e) + '\n'); process.exit(1); });

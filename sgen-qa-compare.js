#!/usr/bin/env node
'use strict';
// sgen qa-compare <A> <B> — deterministic diff of two qa-site scans (e.g. live vs staging), or a
// scan vs a saved reference baseline. A/B each = a baseline label, a report.json path, or a scan
// dir. Emits comparison.html + comparison.json. No AI — every transition is real.
//
//   sgen qa-compare <A> <B> [--out <dir>] [--json]
//   sgen qa-compare --list                 list saved baselines
//   exit 0 = B not worse than A · 1 = B regressed (new/worse failures) · 2 = usage

const path = require('path');
const { diff, loadResult, listBaselines, BASELINES } = require('./lib/site-qa/compare');
const { renderCompare } = require('./lib/site-qa/report-compare');

function parseArgs(argv) { const a = argv.slice(2); const o = { _: [] }; for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; o[k] = v; } else o._.push(a[i]); } return o; }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

const args = parseArgs(process.argv);
if (args.list) { const b = listBaselines(); process.stdout.write(b.length ? `saved baselines (${BASELINES}):\n` + b.map(x => '  ' + x).join('\n') + '\n' : `no saved baselines yet in ${BASELINES}\n`); process.exit(0); }
if (args.help || args._.length < 2) {
  process.stdout.write(`sgen qa-compare <A> <B> — diff two site-QA scans (live vs staging / vs baseline)\n\n  A, B = baseline label | report.json path | scan dir\n  --out <dir>   comparison output dir\n  --list        list saved baselines\n  --json        print machine summary\n\n  exit 0 = B not worse · 1 = B regressed · 2 = usage\n`);
  process.exit(args.help ? 0 : 2);
}

(function () {
  let A, B;
  try { A = loadResult(args._[0]); } catch (e) { process.stderr.write('A: ' + e.message + '\n'); process.exit(2); }
  try { B = loadResult(args._[1]); } catch (e) { process.stderr.write('B: ' + e.message + '\n'); process.exit(2); }
  A.data._label = args._[0]; B.data._label = args._[1];

  const d = diff(A.data, B.data);
  const outDir = args.out ? path.resolve(args.out) : path.resolve(__dirname, '..', 'sgen', 'W5-Live-Surface-Audit', 'site-qa', `_compare-${stamp()}`);
  const { htmlPath, jsonPath } = renderCompare(d, outDir);

  process.stderr.write(`\n=== COMPARE  A(${d.a.label}) ${d.a.score}%  →  B(${d.b.label}) ${d.b.score}%  (Δ${d.scoreDelta >= 0 ? '+' : ''}${d.scoreDelta}) ===\n`);
  process.stderr.write(`regressed=${d.counts.regressed}  new=${d.counts.newIssues}  fixed=${d.counts.fixed}  resolved=${d.counts.resolved}  still-open=${d.counts.persisting}\n`);
  process.stderr.write(`verdict: ${d.worse ? 'B IS WORSE (regressions/new failures)' : 'B not worse than A'}\n`);
  process.stderr.write(`report: ${htmlPath}\n`);
  if (args.json) process.stdout.write(JSON.stringify({ a: d.a, b: d.b, scoreDelta: d.scoreDelta, counts: d.counts, worse: d.worse, report: htmlPath, json: jsonPath }, null, 2) + '\n');
  process.exit(d.worse ? 1 : 0);
})();

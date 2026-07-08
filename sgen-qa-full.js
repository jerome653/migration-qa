#!/usr/bin/env node
'use strict';
// sgen qa-full <url> — the fully-wired audit: live scan + advisory passes (FUNC-008 content-artifacts,
// Best Practices Suite 11) + immutable persistence (Scan Store) + finding lifecycle (Finding Store) +
// timeline + regression GATE vs a saved baseline. One command, the whole platform.
//
//   sgen qa-full <url> [--out <dir>] [--data <dir>] [--max-pages N] [--no-render]
//        [--set-baseline] [--json]
//   exit 0 = gate PASS (or no baseline) | 1 = gate FAIL / scan has failures | 2 = usage
//
// Determinism + immutability: every run appends a content-addressed record; the gate verdict is
// reproducible. No AI at runtime.
const path = require('path');
const { runFullAudit } = require('./lib/site-qa/pipeline');
const { renderReport } = require('./lib/site-qa/report');

function parseArgs(argv) {
  const a = argv.slice(2); const o = { _: [] };
  for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; o[k] = v; } else o._.push(a[i]); }
  return o;
}
function usage(code) {
  process.stdout.write(`sgen qa-full <url> — fully-wired audit (scan → advisory → persist → history → gate)\n\n` +
    `  --data <dir>        history store root (default .auditor-data)\n` +
    `  --compare <url>     also visual-match this reference (old/live) vs the target (staging)\n` +
    `  --out <dir>         also write the HTML/JSON report here\n` +
    `  --max-pages N       crawl cap (default 150)\n` +
    `  --no-render         skip the browser pass (static checks only)\n` +
    `  --set-baseline      pin this scan as the regression baseline for the target\n` +
    `  --json              print the machine summary\n\n` +
    `  exit 0 = gate PASS (or no baseline) · 1 = gate FAIL / failures present · 2 = usage\n`);
  process.exit(code);
}

(async () => {
  const o = parseArgs(process.argv);
  const url = o._[0];
  if (!url || o.help) usage(url ? 0 : 2);
  const dataRoot = path.resolve(o.data || '.auditor-data');

  process.stderr.write(`▶ qa-full ${url}\n`);
  const compareUrl = o.compare || (o._[1] && !String(o._[1]).startsWith('--') ? o._[1] : null);
  if (compareUrl) process.stderr.write(`  visual match: ${compareUrl} (reference) vs ${url} (candidate)\n`);
  const doRender = !(o.render === false || o['no-render']);
  const run = await runFullAudit(url, {
    dataRoot,
    compareUrl,
    maxPages: o['max-pages'] ? +o['max-pages'] : undefined,
    render: doRender,
    screensDir: doRender ? path.join(dataRoot, 'shots') : undefined,
    visualOutDir: compareUrl ? path.join(dataRoot, 'visual') : undefined,
    log: m => process.stderr.write('  ' + m + '\n'),
  });
  if (o['set-baseline']) { run.setBaseline(); process.stderr.write('  ✓ baseline pinned for ' + url + '\n'); }

  if (o.out) {
    const outDir = path.resolve(o.out);
    renderReport(run.result, outDir);
    process.stderr.write('  report → ' + path.join(outDir, 'report.html') + '\n');
  }

  const g = run.regression;
  const summary = {
    scanId: run.scanId, fingerprint: run.fingerprint,
    quality: run.quality.overall, verdict: run.verdict,
    tally: run.result.tally, findingEvents: run.findingEvents,
    scans: run.stores.scans.count(),
    gate: g ? { verdict: g.verdict, scoreDelta: g.scoreDelta, created: g.diff.counts.created, resolved: g.diff.counts.resolved, reopened: g.diff.counts.reopened, violations: g.violations.length } : null,
  };
  if (o.json) process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  else {
    process.stdout.write(`\n  scan ${summary.scanId}  ·  quality ${summary.quality}/100  ·  ${summary.verdict}\n`);
    process.stdout.write(`  findings lifecycle events: ${summary.findingEvents}  ·  scans on record: ${summary.scans}\n`);
    if (run.visual) process.stdout.write(`  VISUAL  ${run.visual.pairs} pair(s) × ${run.visual.viewports} viewport(s)  ·  ${run.visual.mismatches} over threshold  ·  ${run.visual.unmatched} unmatched\n`);
    if (g) process.stdout.write(`  GATE ${g.verdict}  ·  score ${g.scoreDelta >= 0 ? '+' : ''}${g.scoreDelta}  ·  new ${g.diff.counts.created} / resolved ${g.diff.counts.resolved} / reopened ${g.diff.counts.reopened}  ·  ${g.violations.length} violation(s)\n`);
    else process.stdout.write(`  GATE — (no baseline set; use --set-baseline to pin one)\n`);
  }

  const failed = (g && g.verdict === 'FAIL') || run.result.tally.fail > 0;
  process.exit(failed ? 1 : 0);
})().catch(e => { process.stderr.write('qa-full error: ' + (e && e.stack || e) + '\n'); process.exit(1); });

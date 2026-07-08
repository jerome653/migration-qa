#!/usr/bin/env node
'use strict';
// sgen qa-site <url> — deterministic "does the whole site work + pass" tester.
//
// Crawls the site, runs every automatable check (SEO, a11y, links, forms, responsive, performance,
// security, console) grouped into 9 QA suites, renders the tester report (HTML + JSON), and gives a
// pass/fail verdict. No AI at runtime — pure Node + Playwright. Items code cannot certify (design
// fidelity, real form/email delivery, gated flows) are marked "manual", never faked green.
//
//   sgen qa-site <url> [--out <dir>] [--json] [--max-pages N] [--concurrency N]
//        [--render-sample N] [--no-render]
//   exit 0 = passing (no failures; may have warnings/manual) | 1 = failures present | 2 = usage

const path = require('path');
const { runAudit } = require('./lib/site-qa/audit');
const { renderReport } = require('./lib/site-qa/report');
const { saveBaseline, loadResult, diff, recordScan } = require('./lib/site-qa/compare');
const { renderCompare } = require('./lib/site-qa/report-compare');

function parseArgs(argv) {
  const a = argv.slice(2); const o = { _: [] };
  for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; o[k] = v; } else o._.push(a[i]); }
  return o;
}
function usage(code) {
  process.stdout.write(`sgen qa-site <url> — full-site QA tester (does everything work + pass)\n\n` +
    `  --out <dir>            report dir (default Workspace/W5-Live-Surface-Audit/site-qa/<host>-<stamp>)\n` +
    `  --max-pages N          crawl cap (default 150)\n` +
    `  --concurrency N        fetch concurrency (default 8)\n` +
    `  --render-sample N      pages to render in the browser pass (default 12)\n` +
    `  --no-render            skip Playwright (static + link/header checks only)\n` +
    `  --save <label>         save this scan as a reusable reference baseline\n` +
    `  --baseline <label>     compare this scan against a saved baseline (writes comparison.html)\n` +
    `  --json                 print machine summary to stdout\n\n` +
    `  exit 0 = passing · 1 = failures present · 2 = usage\n`);
  process.exit(code);
}
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

(async () => {
  const args = parseArgs(process.argv);
  if (args.help || args.h) usage(0);
  let target = (args._[0] || '').trim();
  if (target && !/^https?:\/\//i.test(target)) target = 'https://' + target; // accept bare domains
  if (!target) { process.stderr.write('error: pass a site URL\n'); usage(2); }
  let host; try { host = new URL(target).host; } catch (e) { process.stderr.write('error: invalid URL\n'); usage(2); }

  const outDir = args.out ? path.resolve(args.out)
    : path.resolve(__dirname, '..', 'sgen', 'W5-Live-Surface-Audit', 'site-qa', `${host}-${stamp()}`);
  const log = (m) => process.stderr.write(m + '\n');

  const data = await runAudit(target, {
    maxPages: parseInt(args['max-pages'] || '150', 10),
    concurrency: parseInt(args.concurrency || '8', 10),
    renderSample: parseInt(args['render-sample'] || '12', 10),
    render: !args['no-render'],
    screensDir: path.join(outDir, 'screenshots'),
    log,
  });

  const { htmlPath, jsonPath } = renderReport(data, outDir);

  // ALWAYS record the scan to per-domain history (domain + timestamp) — builds a running record
  const recFile = recordScan(data); log(`recorded: ${recFile}`);

  // optionally also save as a NAMED reference baseline (for named compares)
  if (args.save) { const bf = saveBaseline(data, args.save); log(`baseline saved: ${bf}`); }

  // compare this scan against a saved baseline (A = baseline, B = this scan)
  if (args.baseline) {
    try {
      const base = loadResult(args.baseline); base.data._label = args.baseline; data._label = 'current';
      const d = diff(base.data, data);
      renderCompare(d, outDir);
      log(`\ncompare vs "${args.baseline}": regressed=${d.counts.regressed} new=${d.counts.newIssues} fixed=${d.counts.fixed} resolved=${d.counts.resolved} (Δscore ${d.scoreDelta >= 0 ? '+' : ''}${d.scoreDelta}) → ${d.worse ? 'REGRESSED vs baseline' : 'no regression'}`);
      log(`comparison: ${path.join(outDir, 'comparison.html')}`);
    } catch (e) { log(`--baseline compare skipped: ${e.message}`); }
  }

  const t = data.tally;
  log(`\n===== ${data.verdict} · score ${data.score}% =====`);
  log(`passed=${t.pass}  warnings=${t.warn}  failed=${t.fail}  manual=${t.manual}`);
  log(`pages=${data.crawl.pages} · rendered=${data.render.rendered}/${data.render.total} · links=${data.links.checked} (${data.links.broken} broken)`);
  log(`report: ${htmlPath}`);

  if (args.json) process.stdout.write(JSON.stringify({ target, verdict: data.verdict, ready: data.ready, score: data.score, tally: t, pages: data.crawl.pages, rendered: data.render.rendered, links: data.links, report: htmlPath, json: jsonPath }, null, 2) + '\n');

  process.exit(data.ready ? 0 : 1);
})().catch(e => { process.stderr.write('qa-site failed: ' + (e && e.stack || e) + '\n'); process.exit(1); });

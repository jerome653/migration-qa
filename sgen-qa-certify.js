#!/usr/bin/env node
'use strict';
// sgen qa-certify <source> --target <migrated> — TOOL 3, Migration Certification.
// Inventory-driven, evidence-backed. Runs the frozen layer pipeline: Provider → Inventory → Comparison
// → Evidence → Certification → Reporting. Writes report.html + report.json from ACTUAL runtime data.
//
//   sgen qa-certify <source-url> --target <migrated-url> [--out <dir>] [--data <dir>]
//        [--max-pages N] [--allow <file>] [--json]
//   exit 0 = PASS · 1 = FAIL · 2 = usage
const fs = require('fs');
const path = require('path');
const { discoverPages } = require('./lib/migration-qa/crawl');
const { certifyMigration } = require('./lib/site-qa/inventory/certify-pipeline');
const { IdRegistry } = require('./lib/site-qa/inventory/id-registry');
const { runAudit } = require('./lib/site-qa/audit');
const visualMatch = require('./lib/site-qa/visual-match');

function args(argv) { const a = argv.slice(2); const o = { _: [] }; for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; o[k] = v; } else o._.push(a[i]); } return o; }
function usage(c) { process.stdout.write(`sgen qa-certify <source> --target <migrated> — Migration Certification (Tool 3)\n\n  Runs: Inventory → Completeness → Visual Comparison → Production Validation → Certification.\n\n  --target <url>       the migrated site to certify against the source (required)\n  --out <dir>          write report.html + report.json here\n  --data <dir>         persist stable inventory IDs (default .auditor-data)\n  --max-pages N        crawl cap per site (default 80)\n  --visual             also run the visual-comparison stage (Playwright + sharp, at SGEN breakpoints)\n  --no-audit           skip the production-validation stage (audit of the target)\n  --no-render          production validation without the browser render pass\n  --allow <file>       identity keys (one per line) intentionally removed → APPROVED, not FAIL\n  --exceptions <file>  JSON [{relatedIds,reason,approver,date,evidence}] approved exceptions\n  --json               print the certification JSON\n\n  exit 0 = PASS · 1 = FAIL · 2 = usage\n`); process.exit(c); }
const H = u => { try { return new URL(u).host; } catch (_) { return ''; } };

(async () => {
  const o = args(process.argv);
  const source = o._[0]; const target = o.target;
  if (!source || !target || o.help) usage(source && target ? 0 : 2);
  const maxPages = o['max-pages'] ? +o['max-pages'] : 80;
  const dataRoot = path.resolve(o.data || '.auditor-data');
  const allowRemoved = o.allow && fs.existsSync(o.allow) ? fs.readFileSync(o.allow, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
  const exceptions = o.exceptions && fs.existsSync(o.exceptions) ? JSON.parse(fs.readFileSync(o.exceptions, 'utf8')) : [];

  const log = m => process.stderr.write('  ' + m + '\n');
  process.stderr.write(`▶ certify  source ${source}  →  target ${target}\n`);
  const [refCrawl, tgtCrawl] = [await discoverPages(source, { maxPages, log }), await discoverPages(target, { maxPages, log })];

  const at = new Date().toISOString();
  const shotsDir = path.join(dataRoot, 'shots');

  // Phase 2 — Production Validation: audit the TARGET (default on; --no-audit to skip). Real render.
  let auditResult = null;
  if (!o['no-audit']) { process.stderr.write('  production validation: auditing target...\n'); try { auditResult = await runAudit(target, { maxPages, render: !o['no-render'], screensDir: shotsDir, log }); } catch (e) { process.stderr.write('  (audit stage failed: ' + e.message + ')\n'); } }
  // Phase 1 — Visual Comparison: reference vs target (opt-in --visual; needs Playwright + sharp).
  let visualResult = null;
  if (o.visual) { process.stderr.write('  visual comparison: source vs target at SGEN breakpoints...\n'); try { visualResult = await visualMatch.run(source, target, { maxPages, outDir: path.join(dataRoot, 'visual'), log }); } catch (e) { process.stderr.write('  (visual stage failed: ' + e.message + ')\n'); } }

  let gitCommit = 'unknown';
  try { gitCommit = require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) {}
  const buildMeta = { gitCommit, build: 'source', environment: `node ${process.version} · ${process.platform}` };

  const idRegistry = new IdRegistry(path.join(dataRoot, 'inventory-ids.jsonl'));
  const r = certifyMigration(refCrawl.pages, tgtCrawl.pages, {
    idRegistry, source: H(source), target: H(target), sourceHost: H(source), targetHost: H(target),
    allowRemoved, exceptions, auditResult, visualResult, at, meta: buildMeta,
    capped: refCrawl.capped || tgtCrawl.capped,
  });

  if (o.out) {
    const outDir = path.resolve(o.out); fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'report.html'), r.report.html);
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(r.report.json, null, 2));
    process.stderr.write('  report → ' + path.join(outDir, 'report.html') + '\n');
  }

  if (o.json) process.stdout.write(JSON.stringify({ verdict: r.cert.verdict, tally: r.cert.tally, gates: r.cert.gates, findings: r.cert.explanations }, null, 2) + '\n');
  else {
    process.stdout.write(`\n  MIGRATION CERTIFICATION  ${H(source)} → ${H(target)}\n  VERDICT: ${r.cert.verdict}   ·   migration confidence ${r.report.json.migrationConfidence}% (informational)\n`);
    process.stdout.write(`  passed ${r.cert.tally.passed} · warnings ${r.cert.tally.warning} · failed ${r.cert.tally.failed} · manual ${r.cert.tally.manual} · approved ${r.cert.tally.approved}\n`);
    process.stdout.write(`  stages: completeness ${r.diff.missing.length} · visual ${r.visual.mapped} · production ${r.production.mapped} findings\n\n`);
    process.stdout.write('  inventory        src  tgt  matched  missing  added\n');
    for (const [t, s] of Object.entries(r.diff.perType)) if (s.ref || s.target) process.stdout.write('  ' + t.padEnd(15) + String(s.ref).padStart(3) + String(s.target).padStart(5) + String(s.matched).padStart(9) + String(s.missing).padStart(9) + String(s.added).padStart(7) + '\n');
    if (r.cert.explanations.length) {
      process.stdout.write(`\n  WHY ${r.cert.verdict}:\n`);
      for (const e of r.cert.explanations.slice(0, 40)) process.stdout.write('  ' + (e.severity === 'blocking' ? '✗' : e.severity === 'manual' ? '?' : '·') + ' ' + e.id.padEnd(11) + (e.axis || 'completeness').padEnd(13) + (e.ruleId || '').padEnd(9) + e.identityKey.replace(/^[a-z]+:/, '').slice(0, 40) + '\n');
    } else process.stdout.write('\n  Every source inventory item is present, faithful, and production-clean on the target.\n');
  }
  process.exit(r.cert.verdict === 'FAIL' ? 1 : 0);
})().catch(e => { process.stderr.write('qa-certify error: ' + (e && e.stack || e) + '\n'); process.exit(1); });

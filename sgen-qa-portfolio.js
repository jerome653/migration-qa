#!/usr/bin/env node
'use strict';
// sgen qa-portfolio <source> --target <sgen-target> — run a full Migration Certification and RECORD it
// as a certified case study in the Production Qualification Portfolio (living document + cumulative
// stats). Reuses the qa-certify pipeline entirely; adds no QA capability. Real execution only.
//
//   sgen qa-portfolio <src> --target <t> --name "<client>" --category <cat> [--ledger f] [--out doc.md]
//        [--no-audit] [--visual] [--max-pages N] [--data <dir>]
//   exit 0 = recorded (verdict may be PASS/MINOR/FAIL) · 2 = usage
const fs = require('fs');
const path = require('path');
const { discoverPages } = require('./lib/migration-qa/crawl');
const { certifyMigration } = require('./lib/site-qa/inventory/certify-pipeline');
const { IdRegistry } = require('./lib/site-qa/inventory/id-registry');
const { runAudit } = require('./lib/site-qa/audit');
const visualMatch = require('./lib/site-qa/visual-match');
const { computeCase, appendCase, loadCases, renderPortfolio } = require('./lib/site-qa/inventory/portfolio');

function args(argv) { const a = argv.slice(2); const o = { _: [] }; for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; o[k] = v; } else o._.push(a[i]); } return o; }
function usage(c) { process.stdout.write(`sgen qa-portfolio <source> --target <sgen-target> — record a certified case study\n\n  --target <url>       migrated SGEN site (required)\n  --name "<client>"    project name (required)\n  --category <cat>     small-brochure|corporate|large-marketing|blog|woocommerce|membership|lms|multi-language|large-asset-library|high-page-count|reference\n  --ledger <file>      portfolio ledger JSONL (default <data>/portfolio.jsonl)\n  --out <doc.md>       regenerate the living portfolio document here\n  --visual             include the visual-comparison stage\n  --no-audit           skip production validation\n  --max-pages N        crawl cap (default 80)\n  --sitemap-only       certify the canonical sitemap page set exactly (no link-follow → authoritative, uncapped completeness)\n  --data <dir>         stable-ID + ledger root (default .auditor-data)\n\n  exit 0 = recorded · 2 = usage\n`); process.exit(c); }
const H = u => { try { return new URL(u).host; } catch (_) { return u; } };

(async () => {
  const o = args(process.argv);
  const source = o._[0], target = o.target, name = o.name;
  if (!source || !target || !name || o.help) usage(source && target && name ? 0 : 2);
  const category = o.category || 'reference';
  const maxPages = o['max-pages'] ? +o['max-pages'] : 80;
  const dataRoot = path.resolve(o.data || '.auditor-data');
  const ledger = o.ledger ? path.resolve(o.ledger) : path.join(dataRoot, 'portfolio.jsonl');
  const log = m => process.stderr.write('  ' + m + '\n');

  process.stderr.write(`▶ qualify "${name}"  ${source} → ${target}\n`);
  const t0 = process.hrtime.bigint(); const m0 = process.memoryUsage().heapUsed;
  const sitemapOnly = !!o['sitemap-only'];
  const [refCrawl, tgtCrawl] = [await discoverPages(source, { maxPages, sitemapOnly, log }), await discoverPages(target, { maxPages, sitemapOnly, log })];
  const at = new Date().toISOString();
  let auditResult = null, visualResult = null, screenshots = 0;
  if (!o['no-audit']) { try { auditResult = await runAudit(target, { maxPages, render: true, screensDir: path.join(dataRoot, 'shots'), log }); screenshots += auditResult && auditResult.render ? auditResult.render.rendered : 0; } catch (e) { log('audit failed: ' + e.message); } }
  if (o.visual) { try { visualResult = await visualMatch.run(source, target, { maxPages, outDir: path.join(dataRoot, 'visual'), log }); } catch (e) { log('visual failed: ' + e.message); } }

  const idRegistry = new IdRegistry(path.join(dataRoot, 'inventory-ids.jsonl'));
  const r = certifyMigration(refCrawl.pages, tgtCrawl.pages, { idRegistry, source: H(source), target: H(target), sourceHost: H(source), targetHost: H(target), auditResult, visualResult, at, capped: refCrawl.capped || tgtCrawl.capped, meta: { environment: `node ${process.version} · ${process.platform}` } });
  const runtimeMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const memMb = (process.memoryUsage().heapUsed - m0) / 1048576;

  const caseObj = computeCase({ name, category, source: H(source), target: H(target), at, r, runtimeMs, memMb, screenshots, isReference: category === 'reference' });
  appendCase(ledger, caseObj);
  const cases = loadCases(ledger);
  if (o.out) { fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true }); fs.writeFileSync(path.resolve(o.out), renderPortfolio(cases)); process.stderr.write('  portfolio → ' + path.resolve(o.out) + '\n'); }

  process.stdout.write(`\n  RECORDED  "${name}" (${category})\n  VERDICT: ${r.cert.verdict}\n  ${caseObj.metrics.pages} pages · ${caseObj.metrics.assets} assets · ${caseObj.metrics.forms} forms · ${caseObj.metrics.inventorySize} inventory items\n  ${caseObj.metrics.findings} findings (${caseObj.metrics.blocking} blocking · ${caseObj.metrics.warnings} warn · ${caseObj.metrics.manual} manual · ${caseObj.metrics.approved} approved)\n  ${runtimeMs.toFixed(0)} ms · ${memMb.toFixed(1)} MB · ${screenshots} screenshots\n  portfolio now: ${cases.length} case(s)\n`);
  process.exit(0);
})().catch(e => { process.stderr.write('qa-portfolio error: ' + (e && e.stack || e) + '\n'); process.exit(1); });

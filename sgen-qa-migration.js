#!/usr/bin/env node
'use strict';
// sgen qa-migration <url> — deterministic post-migration production-readiness gate.
//
// Runs the automatable subset of the SGEN Website Migration QA Standard v2.0 against a handed-over
// site (any URL), plus a headless render pass, and emits an HTML+JSON report with a per-check
// verdict and a manual sign-off checklist. No AI at runtime — pure Node + Playwright.
//
//   sgen qa-migration <url> [--env staging|live|auto] [--out <dir>] [--json]
//        [--max-pages N] [--concurrency N] [--render-sample N] [--no-render]
//        [--redirects <file>] [--pdf]
//   exit 0 = automated checks pass (awaiting manual sign-off) | 1 = NOT-READY | 2 = usage

const fs = require('fs');
const path = require('path');
const http = require('./lib/migration-qa/http');
const { discoverPages } = require('./lib/migration-qa/crawl');
const { STATIC_CHECKS, SITE_CHECKS, buildCtx, F } = require('./lib/migration-qa/checks-static');
const { renderPass } = require('./lib/migration-qa/checks-render');
const { manualChecklist } = require('./lib/migration-qa/manual-checklist');
const { computeVerdict, tally } = require('./lib/migration-qa/verdict');
const { writeReport } = require('./lib/migration-qa/report');

function parseArgs(argv) {
  const a = argv.slice(2); const o = { _: [] };
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; o[k] = v; }
    else o._.push(a[i]);
  }
  return o;
}
function usage(code) {
  process.stdout.write(`sgen qa-migration <url> — post-migration production-ready QA gate\n\n` +
    `  --env staging|live|auto   check profile (default auto by hostname)\n` +
    `  --out <dir>               report dir (default Workspace/W5-Live-Surface-Audit/migration-qa/<host>-<stamp>)\n` +
    `  --max-pages N             crawl cap (default 150)\n` +
    `  --concurrency N           fetch concurrency (default 8)\n` +
    `  --render-sample N         pages to render in the browser pass (default 12)\n` +
    `  --no-render               skip the Playwright pass (static + headers only)\n` +
    `  --redirects <file>        old-URL list (one per line or "old,new") for live 301 preservation\n` +
    `  --pdf                     also emit report.pdf (needs local Chrome)\n` +
    `  --json                    print machine summary to stdout\n\n` +
    `  exit 0 = AUTOMATED-PASS (awaiting manual sign-off) · 1 = NOT-READY · 2 = usage\n`);
  process.exit(code);
}
function detectEnv(host, flag) {
  if (flag && flag !== 'auto') { if (flag === 'staging' || flag === 'live') return flag; }
  return /(^|\.)(staging|qa\d?|dev|preview|test|uat)\./i.test(host) ? 'staging' : 'live';
}
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function imgSrcs(html, pageUrl) {
  const out = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const s = m[0].match(/\ssrc\s*=\s*["']([^"']+)["']/i) || m[0].match(/\sdata-src\s*=\s*["']([^"']+)["']/i);
    if (!s) continue; if (/^data:/i.test(s[1])) continue;
    const a = http.abs(s[1], pageUrl); if (a) out.push(a);
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv);
  if (args.help || args.h) usage(0);
  let target = (args._[0] || '').trim();
  if (target && !/^https?:\/\//i.test(target)) target = 'https://' + target; // accept bare domains
  if (!target) { process.stderr.write('error: pass a site URL\n'); usage(2); }

  let host; try { host = new URL(target).host; } catch (e) { process.stderr.write('error: invalid URL\n'); usage(2); }
  const env = detectEnv(host, args.env);
  const maxPages = parseInt(args['max-pages'] || '150', 10);
  const conc = parseInt(args.concurrency || '8', 10);
  const renderSample = parseInt(args['render-sample'] || '12', 10);
  const outDir = args.out ? path.resolve(args.out)
    : path.resolve(__dirname, '..', 'sgen', 'W5-Live-Surface-Audit', 'migration-qa', `${host}-${stamp()}`);
  const log = (m) => process.stderr.write(m + '\n');

  log(`\n=== SGEN Migration QA · ${target} · env=${env} ===`);

  // 1) discover + fetch pages
  const crawl = await discoverPages(target, { maxPages, concurrency: conc, log });
  const htmlPages = crawl.pages.filter(p => p.status === 200 && (/text\/html/i.test(p.contentType || '') || /<html[\s>]/i.test(p.body || '')));

  // 2) static per-page checks
  const findings = [];
  const titles = {}, descs = {}, imgRef = {};
  for (const p of crawl.pages) {
    const ctx = buildCtx(p, host);
    for (const chk of STATIC_CHECKS) {
      let r; try { r = chk.fn(ctx, { env, host }); } catch (e) { r = null; }
      if (!r) continue;
      (Array.isArray(r) ? r : [r]).forEach(f => findings.push(f));
    }
    if (ctx.isHtml && p.status === 200) {
      if (ctx.title) (titles[ctx.title] = titles[ctx.title] || []).push(p.url);
      const d = (ctx.head.match(/<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i) || [''])[0];
      const dc = d && (d.match(/content\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (dc) (descs[dc] = descs[dc] || []).push(p.url);
      for (const u of imgSrcs(p.body || '', p.url)) (imgRef[u] = imgRef[u] || p.url);
    }
  }

  // 3) cross-page duplicate title / description (AUDXY cr6/cr7)
  for (const [ti, urls] of Object.entries(titles)) if (urls.length > 1) urls.forEach(u => findings.push(F('duplicate-title', '8 SEO', 'medium', 'Duplicate <title> across pages', `same title on ${urls.length} pages: "${ti.slice(0, 60)}"`, u, urls.length)));
  for (const [de, urls] of Object.entries(descs)) if (urls.length > 1) urls.forEach(u => findings.push(F('duplicate-description', '8 SEO', 'low', 'Duplicate meta description across pages', `shared by ${urls.length} pages`, u, urls.length)));

  // 4) broken-image probe (global HEAD over unique srcs)
  const imgUrls = Object.keys(imgRef).slice(0, 500);
  if (imgUrls.length) {
    log(`Checking ${imgUrls.length} unique images...`);
    const statuses = await http.pool(imgUrls, conc, async (u) => [u, await http.head(u)]);
    for (const [u, s] of statuses) {
      const okAsset = typeof s === 'number' && s >= 200 && s < 400;
      if (!okAsset) findings.push(F('broken-image', '1 Visual', 'high', 'Broken image', `${u} [${s}]`, imgRef[u], s));
    }
  }

  // 5) site-level checks (once)
  for (const chk of SITE_CHECKS) {
    let r; try { r = await chk.fn({ origin: crawl.origin, host, env, http, crawl }); } catch (e) { r = null; }
    if (r) (Array.isArray(r) ? r : [r]).forEach(f => findings.push(f));
  }

  // 6) redirect preservation (live + --redirects)
  let redirects = null;
  if (args.redirects) {
    if (!fs.existsSync(args.redirects)) log(`--redirects file not found: ${args.redirects}`);
    else {
      const olds = fs.readFileSync(args.redirects, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        .map(l => http.abs(l.split(/[,\t]/)[0].trim(), crawl.origin)).filter(Boolean);
      log(`Checking ${olds.length} old URLs for 301 preservation...`);
      const res = await http.pool(olds, conc, async (u) => {
        const r = await http.getText(u);
        const good = (r.status >= 300 && r.status < 400) || r.status === 200 || r.status === 410;
        return { url: u, status: r.status, location: r.location, good };
      });
      const failed = res.filter(r => !r.good).map(r => ({ url: r.url, detail: `HTTP ${r.status} (expected 301/302/410 or 200)` }));
      failed.forEach(f => findings.push(F('redirect-preservation', '8 SEO', 'high', 'Old URL not preserved', f.detail, f.url)));
      redirects = { checked: olds.length, ok: res.filter(r => r.good).length, failed };
    }
  } else if (env === 'live') {
    log('(no --redirects file — 301 preservation left to the manual checklist)');
  }

  // 7) render pass
  let render = { rendered: 0, sampled: 0, total: htmlPages.length, error: null };
  let shots = {};
  if (!args['no-render'] && htmlPages.length) {
    log(`Render pass (up to ${renderSample} pages × ${3} viewports)...`);
    const rp = await renderPass(htmlPages.map(p => p.url), { screensDir: path.join(outDir, 'screenshots'), sampleN: renderSample, log });
    rp.findings.forEach(f => findings.push(f));
    shots = rp.shots; render = { rendered: rp.rendered, sampled: rp.sampled, total: rp.total, viewports: rp.viewports, error: rp.error || null };
  }

  // 8) verdict + report
  const verdict = computeVerdict(findings);
  const data = {
    target, env, generated: new Date().toISOString(), verdict,
    crawl: { pages: crawl.pages.length, sitemapCount: crawl.sitemapCount, linkFollowed: crawl.linkFollowed, capped: crawl.capped, maxPages },
    render, sections: null, findings, shots, redirects,
    manual: manualChecklist(env),
  };
  const { htmlPath, jsonPath, pdfPath } = writeReport(data, outDir, { pdf: !!args.pdf });

  // 9) console summary
  const t = verdict.tally;
  log(`\n===== VERDICT: ${verdict.label} =====`);
  log(`env=${env} · pages=${crawl.pages.length} · rendered=${render.rendered}/${render.total}`);
  log(`critical=${t.critical}  high=${t.high}  medium=${t.medium}  low=${t.low}`);
  log(`report: ${htmlPath}`);
  if (pdfPath) log(`pdf:    ${pdfPath}`);
  log(`manual sign-off items: ${data.manual.items.length} (${data.manual.title})`);

  if (args.json) process.stdout.write(JSON.stringify({ target, env, verdict: verdict.label, ready: verdict.ready, tally: t, pages: crawl.pages.length, rendered: render.rendered, report: htmlPath, json: jsonPath, pdf: pdfPath }, null, 2) + '\n');

  process.exit(verdict.ready ? 0 : 1);
})().catch(e => { process.stderr.write('qa-migration failed: ' + (e && e.stack || e) + '\n'); process.exit(1); });

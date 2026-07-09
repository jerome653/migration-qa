#!/usr/bin/env node
'use strict';
// sgen qa-serve — local web UI for the SGEN Migration QA Suite. FOUR independent tools, one browser app,
// bound to 127.0.0.1 only. No AI at runtime; no fake results. Every button POSTs to the SAME frozen
// engines the CLIs use — this file is UI-exposure ONLY and modifies none of them:
//   1. Site Audit          -> runAudit + renderReport                (/api/run)
//   2. Visual Comparison   -> visual-match.run + report-visual.render (/api/visual)
//   3. Migration Cert.     -> discoverPages + certifyMigration        (/api/certify)
//   4. Reports             -> lists _ui-runs + qualification portfolio (/api/reports)
//
//   sgen qa-serve [--port 7878] [--open]

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { runAudit } = require('./lib/site-qa/audit');
const { renderReport, STYLE } = require('./lib/site-qa/report');
const { saveBaseline, loadResult, diff, listBaselines, recordScan } = require('./lib/site-qa/compare');
const { renderCompare } = require('./lib/site-qa/report-compare');
const { discoverPages } = require('./lib/migration-qa/crawl');
const visualMatch = require('./lib/site-qa/visual-match');
const { render: renderVisual } = require('./lib/site-qa/report-visual');
const { certifyMigration } = require('./lib/site-qa/inventory/certify-pipeline');
const { IdRegistry } = require('./lib/site-qa/inventory/id-registry');
let loadCases; try { ({ loadCases } = require('./lib/site-qa/inventory/portfolio')); } catch (e) { loadCases = () => []; }

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def; }
const PORT = parseInt(arg('port', '7878'), 10);
const RUNS = path.resolve(__dirname, '..', 'sgen', 'W5-Live-Surface-Audit', 'site-qa', '_ui-runs');
const DATA = path.resolve(__dirname, '..', 'sgen', 'W5-Live-Surface-Audit', 'site-qa', '_auditor-data');
const safe = (s) => String(s).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const H = (u) => { try { return new URL(u).host; } catch (_) { return u; } };
const norm = (u) => { u = String(u || '').trim(); if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u; return u; };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html; charset=utf-8' };
const gitCommit = (() => { try { return require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) { return 'unknown'; } })();

// ---- shared page chrome (nav + shared runner) ---------------------------------------------------
function appPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SGEN Migration QA Suite</title><style>${STYLE}
  :root{--nav-h:56px}
  .top{position:sticky;top:0;z-index:20;background:var(--surface);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:14px 12px;padding:8px 20px;min-height:var(--nav-h);flex-wrap:wrap}
  @media(max-width:640px){ .top{gap:8px} .top .env{display:none} .top nav{margin-left:0;width:100%;order:3} .top .brand{flex:1 1 auto} }
  .top .brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;font-size:15px}
  .top .brand .mk{width:28px;height:28px;border-radius:8px;background:var(--brand-solid);display:grid;place-items:center}
  .top nav{display:flex;gap:2px;margin-left:8px;flex-wrap:wrap}
  .top nav button{background:none;border:0;color:var(--ink-soft);font-size:13.5px;font-weight:560;padding:8px 13px;border-radius:8px;cursor:pointer;font-family:inherit}
  .top nav button:hover{background:var(--surface-2);color:var(--ink)}
  .top nav button.on{background:var(--brand-solid);color:#fff}
  .top .env{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--ink-faint)}
  html,body{max-width:100%;overflow-x:hidden}
  .wrap{width:100%;max-width:none;margin:0;padding:26px clamp(22px,4vw,56px) 60px;box-sizing:border-box}
  .panel{display:none}.panel.on{display:block}
  .card,.pbar,.status,.cmplink{width:100%;box-sizing:border-box}
  .row{width:100%}
  iframe{width:100%;box-sizing:border-box}
  h2.tt{font-size:20px;margin:0 0 4px;letter-spacing:-.02em}
  p.sub{color:var(--ink-soft);font-size:13.5px;margin:0 0 18px;line-height:1.6}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px;margin-bottom:14px}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  label.fld{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--ink-soft);font-weight:600;flex:1;min-width:220px}
  input[type=text],select{font-family:var(--mono);font-size:13.5px;padding:10px 12px;border:1px solid var(--line-strong);border-radius:9px;background:var(--surface-2);color:var(--ink);outline:none;width:100%}
  input[type=text]:focus,select:focus{border-color:var(--brand)}
  input[type=number]{width:70px;font-family:var(--mono);padding:7px 9px;border:1px solid var(--line);border-radius:7px;background:var(--surface-2);color:var(--ink)}
  .run{background:var(--brand-solid);color:#fff;border:0;border-radius:9px;padding:11px 22px;font-size:14px;font-weight:650;cursor:pointer;white-space:nowrap;font-family:inherit}
  .run:disabled{opacity:.55;cursor:default}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
  .chip{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-soft);background:var(--surface-2);border:1px solid var(--line);border-radius:7px;padding:6px 10px;cursor:pointer;user-select:none}
  .chip input{accent-color:var(--brand-solid)}
  .grp{margin-top:14px}.grp .glab{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-faint);font-weight:700;margin-bottom:7px}
  .opts{display:flex;flex-wrap:wrap;gap:16px;margin-top:14px;align-items:center;font-size:13px;color:var(--ink-soft)}
  .opts label{display:flex;align-items:center;gap:6px}
  .note{font-size:11.5px;color:var(--ink-faint);margin:12px 0 0;line-height:1.6}.note b{color:var(--ink-soft);font-weight:640}
  .status{font-family:var(--mono);font-size:13px;color:var(--ink-soft);min-height:22px;margin-top:14px}
  .status .spin{display:inline-block;width:11px;height:11px;border:2px solid var(--line-strong);border-top-color:var(--brand);border-radius:50%;animation:sp .8s linear infinite;vertical-align:-1px;margin-right:8px}
  @keyframes sp{to{transform:rotate(360deg)}}
  .pbar{height:8px;background:var(--surface-2);border:1px solid var(--line);border-radius:99px;overflow:hidden;display:none;margin-top:12px}.pbar.on{display:block}
  .pfill{height:100%;width:0;background:var(--brand);transition:width .35s ease;border-radius:99px}
  .cmplink{font-size:13px;margin-top:10px}.cmplink a{color:var(--brand);font-weight:600}
  iframe{width:100%;height:auto;min-height:520px;border:1px solid var(--line);border-radius:12px;background:var(--ground);display:block;overflow:auto;margin-top:14px}
  .pipe{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;font-family:var(--mono);font-size:11.5px}
  .pipe span{padding:4px 9px;border:1px solid var(--line);border-radius:99px;color:var(--ink-faint)}
  .pipe span.on{border-color:var(--brand);color:var(--brand);background:var(--surface-2)}
  .pipe span.done{border-color:var(--ok,#3EA372);color:var(--ok,#3EA372)}
  .rlist{display:flex;flex-direction:column;gap:8px}
  .ritem{display:flex;align-items:center;gap:12px;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2);font-size:13px}
  .ritem .tag{font-family:var(--mono);font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:.04em}
  .tag.audit{background:#2A3A55;color:#BcD}.tag.visual{background:#3A2A55;color:#DcF}.tag.cert{background:#553A2A;color:#FDc}.tag.case{background:#2A5541;color:#cFD}
  .ritem .nm{flex:1;font-family:var(--mono);color:var(--ink)}.ritem .when{color:var(--ink-faint);font-size:11.5px}
  .ritem a{color:var(--brand);font-weight:600;font-size:12.5px}
  .hint{font-family:var(--mono);font-size:11px;color:var(--ink-faint)}
  /* two-column tool layout: controls left, results right */
  .toolgrid{display:grid;grid-template-columns:minmax(320px,430px) 1fr;gap:20px;align-items:start}
  .toolgrid .col-right{min-width:0}
  @media(max-width:920px){.toolgrid{grid-template-columns:1fr}}
  .card{margin-bottom:0}
  .placeholder{border:1px dashed var(--line-strong);border-radius:12px;padding:46px 22px;text-align:center;color:var(--ink-faint);font-size:13px;line-height:1.6;background:var(--surface-2)}
  .placeholder b{color:var(--ink-soft);display:block;margin-bottom:4px;font-size:13.5px}
  /* Site Audit — horizontal scan-configuration grouping (operator console, not a settings form) */
  .scancfg{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
  .cfg-grid{display:flex;flex-wrap:wrap;gap:14px 24px;align-items:center}
  .cfg-grid>label{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-soft);font-weight:600}
  .cfg-c{flex:0 0 auto}
  .cfg-g{flex:1 1 240px}
  .cfg-action{display:flex;justify-content:flex-end;margin-top:18px}
  @media(max-width:820px){ .cfg-c,.cfg-g{flex:1 1 calc(50% - 24px)} }
  @media(max-width:520px){ .cfg-grid{gap:12px} .cfg-grid>label{flex:1 1 100%} .cfg-action{margin-top:14px} .cfg-action .run{width:100%} }
  /* help bubble */
  .help{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--surface-2);border:1px solid var(--line-strong);color:var(--ink-soft);font-size:10px;font-weight:700;cursor:help;margin-left:6px;position:relative;font-family:var(--mono);vertical-align:middle}
  .help:hover,.help:focus{background:var(--brand-solid);color:#fff;border-color:var(--brand-solid);outline:none}
  .help .tip{display:none;position:absolute;left:50%;bottom:calc(100% + 9px);transform:translateX(-50%);width:250px;max-width:70vw;background:var(--surface);border:1px solid var(--line-strong);border-radius:10px;box-shadow:var(--shadow);padding:11px 13px;font-size:11.5px;line-height:1.55;color:var(--ink-soft);z-index:60;text-align:left;font-family:inherit;font-weight:400;white-space:normal}
  .help:hover .tip,.help:focus .tip{display:block}
  .help .tip b{color:var(--ink);display:block;margin-bottom:3px;font-size:12px}
  .help .tip em{color:var(--brand-ink);font-style:normal;display:block;margin-top:5px}
  /* walkthrough modal */
  .ovl{position:fixed;inset:0;background:rgba(0,0,0,.74);z-index:100;display:none;align-items:center;justify-content:center;padding:20px}
  .ovl.on{display:flex}
  .wk{background:var(--surface);border:1px solid var(--line-strong);border-radius:16px;max-width:560px;width:100%;box-shadow:var(--shadow);overflow:hidden}
  .wk-body{padding:28px 30px;min-height:180px}
  .wk-step{display:none}.wk-step.on{display:block}
  .wk .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--brand-ink);font-weight:700;margin-bottom:6px}
  .wk h3{font-size:19px;margin:0 0 9px;letter-spacing:-.01em}
  .wk p{color:var(--ink-soft);font-size:13.5px;line-height:1.62;margin:0 0 11px}
  .wk .io{display:flex;gap:18px;flex-wrap:wrap;font-size:12.5px;margin-top:10px}
  .wk .io div{flex:1;min-width:160px}.wk .io .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-faint);font-weight:700;margin-bottom:4px}
  .wk .io ul{margin:0;padding-left:16px;color:var(--ink-soft);line-height:1.6}
  .wk .pipe-mini{font-family:var(--mono);font-size:11.5px;color:var(--ink-soft);background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin-top:10px}
  .wk-foot{display:flex;align-items:center;gap:10px;padding:15px 30px;border-top:1px solid var(--line);background:var(--surface-2)}
  .wk-dots{display:flex;gap:6px;margin-right:auto}
  .wk-dots i{width:7px;height:7px;border-radius:50%;background:var(--line-strong);transition:background .2s}.wk-dots i.on{background:var(--brand-solid)}
  .wk-btn{background:var(--surface);border:1px solid var(--line-strong);color:var(--ink);border-radius:8px;padding:8px 17px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
  .wk-btn:disabled{opacity:.4;cursor:default}
  .wk-btn.primary{background:var(--brand-solid);color:#fff;border-color:var(--brand-solid)}
  .wk-skip{background:none;border:0;color:var(--ink-faint);font-size:12px;cursor:pointer;font-family:inherit;margin-right:4px}
  .help-btn{background:none;border:1px solid var(--line-strong);color:var(--ink-soft);border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}
  .help-btn:hover{color:var(--ink);border-color:var(--brand)}
  /* reports two-column */
  .rgrid{display:grid;grid-template-columns:minmax(280px,380px) 1fr;gap:18px;align-items:start}
  @media(max-width:920px){.rgrid{grid-template-columns:1fr}}
  .rfilters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
  .rfilters button{background:var(--surface-2);border:1px solid var(--line);color:var(--ink-soft);border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer;font-family:inherit}
  .rfilters button.on{background:var(--brand-solid);color:#fff;border-color:var(--brand-solid)}
  .ritem{cursor:pointer}.ritem.sel{border-color:var(--brand);background:var(--surface)}
  </style></head><body>
  <div class="top">
    <div class="brand"><span class="mk"><svg viewBox="0 0 24 24" width="17" height="17" fill="none"><path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>SGEN Migration QA</div>
    <nav>
      <button data-t="audit" class="on" onclick="tab('audit')">1 · Site Audit</button>
      <button data-t="visual" onclick="tab('visual')">2 · Visual Comparison</button>
      <button data-t="cert" onclick="tab('cert')">3 · Migration Certification</button>
      <button data-t="reports" onclick="tab('reports');loadReports()">4 · Reports</button>
    </nav>
    <button class="help-btn" onclick="openWalk()" title="Reopen the walkthrough">? Help</button>
    <div class="env">127.0.0.1:${PORT} · ${gitCommit} · real</div>
  </div>
  <div class="wrap">

    <!-- 1 SITE AUDIT -->
    <section class="panel on" id="p-audit">
      <h2 class="tt">Site Audit</h2><p class="sub">Full single-site tester — links, forms, responsive, accessibility (axe-core), SEO, performance, security (TLS), cross-browser (Firefox + WebKit), console. Independent: needs no inventory, comparison, or certification.</p>
      <div class="card">
        <label class="fld" style="min-width:0">Site URL<input id="a-url" type="text" placeholder="e.g. sgen.com" spellcheck="false"></label>
        <div class="scancfg">
          <div class="glab">Scan Configuration</div>
          <div class="cfg-grid">
            <label class="cfg-c">Max pages <input id="a-max" type="number" value="30" min="1" max="500"><span class="help" tabindex="0">?<span class="tip"><b>Max pages</b>How many pages to crawl and test. 1 = homepage only; higher follows the sitemap + internal links up to this cap.<em>Example: 1 for a quick single-page check.</em></span></span></label>
            <label class="cfg-c"><input id="a-render" type="checkbox" checked> Browser render <span class="help" tabindex="0">?<span class="tip"><b>Browser render</b>Loads each page in a real headless browser for axe-core accessibility, Core Web Vitals, full-page screenshots, and Firefox + WebKit. Off = faster static-only scan.</span></span></label>
            <label class="cfg-g">Save report as <input id="a-save" type="text" placeholder="reference name" style="flex:1;min-width:120px"><span class="help" tabindex="0">?<span class="tip"><b>Save report as</b>Stores this scan as a reference for future comparisons.<em>Example: save the live site, then compare staging to it.</em></span></span></label>
            <label class="cfg-g">Compare against <select id="a-baseline" style="flex:1;min-width:120px"><option value="">— none —</option></select><span class="help" tabindex="0">?<span class="tip"><b>Compare against</b>Optional. Compare this audit against a previous saved scan.<em>Example: diff staging vs a saved live baseline.</em></span></span></label>
          </div>
          <div class="cfg-action"><button class="run" id="a-btn" onclick="runAudit()">Run audit</button></div>
        </div>
      </div>
      <div class="pbar" id="a-pbar"><div class="pfill" id="a-pfill"></div></div><div class="status" id="a-status"></div><div class="cmplink" id="a-link"></div><div id="a-frame"></div>
      <div class="placeholder" id="a-ph"><b>Results appear here</b>Run an audit to see the quality score, findings, screenshots, and the full report preview.</div>
    </section>

    <!-- 2 VISUAL COMPARISON -->
    <section class="panel" id="p-visual">
      <h2 class="tt">Visual Comparison</h2><p class="sub">Compare a reference site and a target site visually across the SGEN breakpoints — no prior audit, no certification, no stored inventory. Diffs page render + full DOM structure.</p>
      <div class="toolgrid">
        <div class="col-left"><div class="card">
          <label class="fld" style="min-width:0">Reference URL<input id="v-ref" type="text" placeholder="old / source site" spellcheck="false"></label>
          <label class="fld" style="min-width:0;margin-top:12px">Target URL<input id="v-tgt" type="text" placeholder="new / SGEN site" spellcheck="false"></label>
          <div class="grp"><div class="glab">Scope <span class="help" tabindex="0">?<span class="tip"><b>Scope</b>How many pages to compare. <b style="display:inline">Full site</b> discovers additional linked pages — useful for audits, but may surface non-canonical URLs (pagination, query variants).<em>Example: Single page for a fast homepage check.</em></span></span></div>
            <select id="v-scope" style="max-width:280px"><option value="single">Single page (homepage)</option><option value="multiple">Multiple pages (up to max)</option><option value="sitemap">Sitemap-driven</option><option value="full">Full site</option></select>
            <label style="font-size:12px;color:var(--ink-soft);margin-left:10px">max <input id="v-max" type="number" value="8" min="1" max="200"></label></div>
          <div class="grp"><div class="glab">Viewports <span class="help" tabindex="0">?<span class="tip"><b>Viewports</b>Industry-standard device widths: desktop, laptop, iPad landscape/portrait, iPhone, Android baseline. The 360–430 phone band is where most real-world breakage lives.<em>1920 · 1440 · 1024 · 768 · 390 · 360</em></span></span></div><div class="chips" id="v-vps">
            <label class="chip"><input type="checkbox" value="1920" checked>1920</label><label class="chip"><input type="checkbox" value="1440" checked>1440</label><label class="chip"><input type="checkbox" value="1024" checked>1024</label><label class="chip"><input type="checkbox" value="768" checked>768</label><label class="chip"><input type="checkbox" value="390" checked>390</label><label class="chip"><input type="checkbox" value="360" checked>360</label></div></div>
          <div class="grp"><div class="glab">Comparison axes <span class="help" tabindex="0">?<span class="tip"><b>Comparison axes</b>Defines what is compared.<em>Layout · Components · Assets · Forms · Behaviors</em></span></span></div><div class="chips" id="v-ax">
            <label class="chip"><input type="checkbox" value="page" checked>Page</label><label class="chip"><input type="checkbox" value="section" checked>Section</label><label class="chip"><input type="checkbox" value="global" checked>Global components</label><label class="chip"><input type="checkbox" value="assets" checked>Assets</label><label class="chip"><input type="checkbox" value="forms" checked>Forms</label><label class="chip"><input type="checkbox" value="behaviors" checked>Behaviors</label></div></div>
          <div class="row" style="margin-top:16px"><button class="run" id="v-btn" onclick="runVisual()">Run visual comparison</button></div>
        </div></div>
        <div class="col-right">
          <div class="pbar" id="v-pbar"><div class="pfill" id="v-pfill"></div></div><div class="status" id="v-status"></div><div class="cmplink" id="v-link"></div><div id="v-frame"></div>
          <div class="placeholder" id="v-ph"><b>Comparison results appear here</b>Run a comparison to see the similarity score, screenshot gallery, difference images, and evidence.</div>
        </div>
      </div>
    </section>

    <!-- 3 MIGRATION CERTIFICATION -->
    <section class="panel" id="p-cert">
      <h2 class="tt">Migration Certification</h2><p class="sub">Validates that a migrated site faithfully represents the source and is safe to deploy. Runs the full frozen pipeline with stable inventory IDs, evidence, and a three-state verdict. No CLI required.</p>
      <div class="toolgrid">
        <div class="col-left"><div class="card">
          <label class="fld" style="min-width:0">Source URL<input id="c-src" type="text" placeholder="original site" spellcheck="false"></label>
          <label class="fld" style="min-width:0;margin-top:12px">Target URL<input id="c-tgt" type="text" placeholder="migrated SGEN site" spellcheck="false"></label>
          <div class="grp"><div class="glab">Migration options</div><div class="opts" style="margin-top:0;flex-direction:column;align-items:flex-start;gap:11px">
            <label><input id="c-sitemap" type="checkbox"> sitemap-only completeness <span class="help" tabindex="0">?<span class="tip"><b>Sitemap-only</b>Uses the sitemap as the authoritative page list. Recommended for migration completeness checks. Without it, a capped crawl reports completeness as <b style="display:inline">manual</b>, never authoritative.<em>Example: certify docs.sgen.com → staging against the sitemap.</em></span></span></label>
            <label><input id="c-visual" type="checkbox"> visual comparison stage</label>
            <label><input id="c-prod" type="checkbox" checked> production validation (audit target)</label>
            <label>max pages <input id="c-max" type="number" value="30" min="1" max="700"></label>
          </div></div>
          <div class="grp"><div class="glab">Evidence <span class="help" tabindex="0">?<span class="tip"><b>Evidence</b>Every finding must have proof (screenshot / DOM / network). Findings without available proof are marked <b style="display:inline">Manual Verification Required</b> — never silently passed.</span></span></div>
            <div class="hint">Findings carry inventory IDs, status, and an evidence package.</div></div>
          <div class="row" style="margin-top:16px"><button class="run" id="c-btn" onclick="runCert()">Run certification</button></div>
        </div></div>
        <div class="col-right">
          <div class="glab" style="margin-bottom:7px">Pipeline</div>
          <div class="pipe" id="c-pipe"><span data-s="inventory">Inventory</span><span data-s="completeness">Completeness</span><span data-s="visual">Visual</span><span data-s="production">Production</span><span data-s="certification">Certification</span></div>
          <div class="pbar" id="c-pbar"><div class="pfill" id="c-pfill"></div></div><div class="status" id="c-status"></div><div class="cmplink" id="c-link"></div><div id="c-frame"></div>
          <div class="placeholder" id="c-ph"><b>Certification results appear here</b>Run the pipeline to see inventory summary, completeness, the verdict, and findings with evidence.</div>
        </div>
      </div>
    </section>

    <!-- 4 REPORTS -->
    <section class="panel" id="p-reports">
      <h2 class="tt">Reports</h2><p class="sub">Review previous scans, certifications, evidence, and exported results. Select a run to preview its report; open HTML (evidence + screenshots + versions) or raw JSON.</p>
      <div class="rgrid">
        <div class="col-left">
          <div class="rfilters" id="r-filters">
            <button data-f="all" class="on" onclick="rfilter('all')">All</button>
            <button data-f="audit" onclick="rfilter('audit')">Audit</button>
            <button data-f="visual" onclick="rfilter('visual')">Visual</button>
            <button data-f="cert" onclick="rfilter('cert')">Cert</button>
            <button data-f="case" onclick="rfilter('case')">Cases</button>
          </div>
          <div class="rlist" id="r-list"><div class="hint">Loading…</div></div>
        </div>
        <div class="col-right">
          <div id="r-preview"></div>
          <div class="placeholder" id="r-ph"><b>Select a report</b>Choose a run on the left to preview its HTML report, evidence, and assets here.</div>
        </div>
      </div>
    </section>

  </div>

  <!-- first-use walkthrough (operational, shown once; reopen via ? Help) -->
  <div class="ovl" id="walk"><div class="wk">
    <div class="wk-body">
      <div class="wk-step on" data-w="0"><div class="lbl">Welcome</div><h3>SGEN Migration QA</h3><p>SGEN Migration QA verifies that a migrated website is <b>complete</b>, <b>visually accurate</b>, and <b>production safe</b>. Four independent tools, one local workspace — no data leaves this machine.</p></div>
      <div class="wk-step" data-w="1"><div class="lbl">Tool 1</div><h3>Site Audit</h3><p>Checks a single site for technical quality, accessibility, security, performance, and production issues.</p><div class="io"><div><div class="k">Inputs</div><ul><li>URL</li><li>Scan options</li></ul></div><div><div class="k">Output</div><ul><li>Findings</li><li>Evidence</li><li>Report</li></ul></div></div></div>
      <div class="wk-step" data-w="2"><div class="lbl">Tool 2</div><h3>Visual Comparison</h3><p>Compares a reference site and target site visually across SGEN breakpoints.</p><div class="io"><div><div class="k">Inputs</div><ul><li>Reference URL</li><li>Target URL</li><li>Pages · Viewports · Axes</li></ul></div><div><div class="k">Output</div><ul><li>Similarity score</li><li>Screenshots</li><li>Differences</li></ul></div></div></div>
      <div class="wk-step" data-w="3"><div class="lbl">Tool 3</div><h3>Migration Certification</h3><p>Validates that a migrated site faithfully represents the source and is safe to deploy.</p><div class="pipe-mini">Inventory → Completeness → Visual Comparison → Production Validation → Certification</div></div>
      <div class="wk-step" data-w="4"><div class="lbl">Tool 4</div><h3>Reports</h3><p>Review previous scans, certifications, evidence, and exported results — preview any run, or open its HTML / JSON.</p></div>
    </div>
    <div class="wk-foot">
      <button class="wk-skip" onclick="closeWalk()">Skip</button>
      <div class="wk-dots" id="wk-dots"></div>
      <button class="wk-btn" id="wk-back" onclick="walkStep(-1)">Back</button>
      <button class="wk-btn primary" id="wk-next" onclick="walkStep(1)">Next</button>
    </div>
  </div></div>

  <script>
    var VPMAP={1920:'1920 · desktop',1440:'1440 · laptop',1024:'1024 · tablet-landscape',768:'768 · tablet',390:'390 · mobile',360:'360 · mobile-small'};
    function tab(t){document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('on')});document.getElementById('p-'+t).classList.add('on');document.querySelectorAll('.top nav button').forEach(function(b){b.classList.toggle('on',b.dataset.t===t)});}
    function $(id){return document.getElementById(id);}
    function checked(cid){return [].slice.call(document.querySelectorAll('#'+cid+' input:checked')).map(function(i){return i.value});}
    function setProg(pre,pct,phase){$(pre+'-pbar').classList.add('on');pct=Math.max(2,Math.min(100,pct||0));$(pre+'-pfill').style.width=pct+'%';if(phase)$(pre+'-status').innerHTML='<span class="spin"></span>'+phase+' — '+pct+'%';}
    function endProg(pre){setProg(pre,100,'');setTimeout(function(){$(pre+'-pbar').classList.remove('on')},400);}
    // desktop notification when a scan finishes — fires as a native OS toast when the tab is in the
    // background or the window unfocused (multitasking), plus a soft chime + title flash either way.
    var TOOL_NAME={a:'Site Audit',v:'Visual Comparison',c:'Migration Certification'};
    var baseTitle=document.title;
    function chime(){try{var ctx=new (window.AudioContext||window.webkitAudioContext)();var o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=880;g.gain.setValueAtTime(0.0001,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.06,ctx.currentTime+0.02);g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.5);o.start();o.stop(ctx.currentTime+0.55);}catch(e){}}
    function flashTitle(msg){var n=0,iv=setInterval(function(){document.title=(n%2?baseTitle:msg);if(++n>9||!document.hidden){clearInterval(iv);document.title=baseTitle;}},900);}
    function scanNotify(pre,m){
      var tool=TOOL_NAME[pre]||'Scan';
      var body=m.ok===false?('Failed: '+String(m.error||'unknown error').slice(0,120))
        :(m.verdict?tool+': '+m.verdict+(m.score!=null?' \\u00b7 '+m.score+'%':'')+(m.tally?' \\u00b7 '+(m.tally.fail||0)+' failed / '+(m.tally.warn||0)+' warnings':'')
        :(m.overall!=null?tool+': '+m.overall+'% match \\u00b7 '+(m.pairs||0)+' page(s)':tool+' finished'));
      chime();flashTitle('\\u2713 '+tool+' done');
      if(!('Notification' in window))return;
      if((document.hidden||!document.hasFocus())&&Notification.permission==='granted'){
        try{var nt=new Notification('SGEN Migration QA \\u2014 '+tool+' finished',{body:body,tag:'sgenqa-'+pre,requireInteraction:false});nt.onclick=function(){try{window.focus();}catch(e){}nt.close();};}catch(e){}
      }
    }
    function stream(endpoint,body,pre,onDone){
      if('Notification' in window&&Notification.permission==='default'){try{Notification.requestPermission();}catch(e){}} // ask on the Run gesture, so the first finished scan can already toast
      var btn=$(pre+'-btn');btn.disabled=true;$(pre+'-frame').innerHTML='';$(pre+'-link').innerHTML='';setProg(pre,3,'starting');
      fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){
        var reader=r.body.getReader(),dec=new TextDecoder(),buf='';
        function pump(){return reader.read().then(function(res){if(res.done)return;buf+=dec.decode(res.value,{stream:true});var lines=buf.split('\\n');buf=lines.pop();lines.forEach(function(ln){if(ln.trim()){try{var m=JSON.parse(ln);if(m.t==='p'){setProg(pre,m.pct,m.phase);if(m.stage)mark(pre,m.stage);}else if(m.t==='done'){btn.disabled=false;endProg(pre);scanNotify(pre,m);onDone(m);}}catch(e){}}});return pump();});}
        return pump();
      }).catch(function(err){btn.disabled=false;endProg(pre);$(pre+'-status').innerHTML='Request error: '+err;});
    }
    function showReport(pre,route,label){
      var ph=$(pre+'-ph'); if(ph)ph.style.display='none';
      $(pre+'-link').innerHTML='<a href="'+route+'" target="_blank">↗ Open '+label+' in a new tab</a>';
      var f=document.createElement('iframe');f.src=route;f.onload=function(){try{var d=f.contentWindow.document;var h=Math.max(d.body.scrollHeight,d.documentElement.scrollHeight)+40;f.style.height=h+'px';var n=0,iv=setInterval(function(){try{f.style.height=(Math.max(d.body.scrollHeight,d.documentElement.scrollHeight)+40)+'px'}catch(e){}if(++n>12)clearInterval(iv)},400);}catch(e){}};
      $(pre+'-frame').appendChild(f);
    }
    function mark(pre,stage){var p=$(pre+'-pipe');if(!p)return;var els=p.querySelectorAll('span');var hit=false;els.forEach(function(s){if(s.dataset.s===stage){s.className='on';hit=true;}else if(!hit){s.className='done';}});}

    // 1 Site Audit
    fetch('/api/baselines').then(function(r){return r.json()}).then(function(d){var s=$('a-baseline');(d.baselines||[]).forEach(function(b){var o=document.createElement('option');o.value=b;o.textContent=b;s.appendChild(o)})});
    function runAudit(){var url=$('a-url').value.trim();if(!url){$('a-status').textContent='Enter a site URL.';return;}
      stream('/api/run',{url:url,maxPages:+$('a-max').value||30,render:$('a-render').checked,save:$('a-save').value.trim(),baseline:$('a-baseline').value},'a',function(m){
        if(!m.ok){$('a-status').textContent='Scan failed: '+(m.error||'unknown');return;}
        $('a-status').innerHTML='Done — '+m.verdict+' · score '+m.score+'% · pass '+m.tally.pass+' / warn '+m.tally.warn+' / fail '+m.tally.fail+' / manual '+m.tally.manual+' · saved to history';
        var cmp='';if(m.comparison)cmp=' · <a href="/compare/'+m.id+'" target="_blank">open comparison ↗</a>';$('a-link').innerHTML='<a href="/report/'+m.id+'" target="_blank">↗ Open full report</a>'+cmp;
        showReport('a','/report/'+m.id,'report');});}

    // 2 Visual Comparison
    function runVisual(){var ref=$('v-ref').value.trim(),tgt=$('v-tgt').value.trim();if(!ref||!tgt){$('v-status').textContent='Enter both Reference and Target URLs.';return;}
      var vps=checked('v-vps').map(function(w){return VPMAP[w]});
      stream('/api/visual',{ref:ref,target:tgt,scope:$('v-scope').value,maxPages:+$('v-max').value||8,viewports:vps,axes:checked('v-ax')},'v',function(m){
        if(!m.ok){$('v-status').textContent='Comparison failed: '+(m.error||'unknown');return;}
        $('v-status').innerHTML='Done — overall match '+m.overall+'% · '+m.pairs+' page(s) · '+m.viewports+' viewport(s)'+(m.sharp?'':' · (pixel diff off: sharp missing)');
        showReport('v','/visual/'+m.id,'visual report');});}

    // 3 Migration Certification
    function runCert(){var src=$('c-src').value.trim(),tgt=$('c-tgt').value.trim();if(!src||!tgt){$('c-status').textContent='Enter both Source and Target URLs.';return;}
      $('c-pipe').querySelectorAll('span').forEach(function(s){s.className=''});
      stream('/api/certify',{source:src,target:tgt,sitemapOnly:$('c-sitemap').checked,visual:$('c-visual').checked,production:$('c-prod').checked,maxPages:+$('c-max').value||30},'c',function(m){
        if(!m.ok){$('c-status').textContent='Certification failed: '+(m.error||'unknown');return;}
        $('c-pipe').querySelectorAll('span').forEach(function(s){s.className='done'});
        $('c-status').innerHTML='<b>'+m.verdict+'</b> — passed '+m.tally.passed+' · warnings '+m.tally.warning+' · failed '+m.tally.failed+' · manual '+m.tally.manual+' · approved '+m.tally.approved;
        showReport('c','/certify/'+m.id,'certification report');});}

    // 4 Reports — history list (left) + preview (right), filterable
    var R_DATA={runs:[],cases:[]},R_FILTER='all';
    function loadReports(){fetch('/api/reports').then(function(r){return r.json()}).then(function(d){R_DATA=d;renderReports();}).catch(function(e){$('r-list').innerHTML='<div class="hint">reports error: '+e+'</div>';});}
    function rfilter(f){R_FILTER=f;[].forEach.call(document.querySelectorAll('#r-filters button'),function(b){b.classList.toggle('on',b.dataset.f===f)});renderReports();}
    function renderReports(){
      var el=$('r-list'),rows=[],f=R_FILTER;
      if(f==='all'||f!=='case'){ (R_DATA.runs||[]).filter(function(x){return f==='all'||x.kind===f;}).forEach(function(x){
        var route=x.kind==='visual'?'/visual/'+x.id:(x.kind==='cert'?'/certify/'+x.id:'/report/'+x.id);
        rows.push('<div class="ritem" data-route="'+route+'" data-json="'+route+'/'+x.json+'" onclick="selectReport(this)"><span class="tag '+(x.kind==='visual'?'visual':x.kind==='cert'?'cert':'audit')+'">'+(x.kind==='visual'?'Visual':x.kind==='cert'?'Cert':'Audit')+'</span><span class="nm">'+x.host+'</span><span class="when">'+x.when+'</span></div>');});}
      if(f==='all'||f==='case'){ (R_DATA.cases||[]).forEach(function(c){rows.push('<div class="ritem"><span class="tag case">Case</span><span class="nm">'+c.name+'</span><span class="when">'+(c.verdict||'')+' · '+(c.metrics?c.metrics.pages+'p':'')+'</span></div>');});}
      el.innerHTML=rows.length?rows.join(''):'<div class="hint">No runs in this filter yet.</div>';
    }
    function selectReport(elm){
      [].forEach.call(document.querySelectorAll('#r-list .ritem'),function(i){i.classList.remove('sel')});elm.classList.add('sel');
      var route=elm.dataset.route,json=elm.dataset.json;
      $('r-ph').style.display='none';
      $('r-preview').innerHTML='<div class="cmplink"><a href="'+route+'" target="_blank">↗ Open HTML</a> &nbsp; <a href="'+json+'" target="_blank">Open JSON</a></div>';
      var fr=document.createElement('iframe');fr.src=route;fr.onload=function(){try{var dd=fr.contentWindow.document;var h=Math.max(dd.body.scrollHeight,dd.documentElement.scrollHeight)+40;fr.style.height=h+'px';var n=0,iv=setInterval(function(){try{fr.style.height=(Math.max(dd.body.scrollHeight,dd.documentElement.scrollHeight)+40)+'px'}catch(e){}if(++n>12)clearInterval(iv)},400);}catch(e){}};
      $('r-preview').appendChild(fr);
    }

    // First-use walkthrough (shown once per browser; reopen via ? Help)
    var WK_KEY='sgenqa_onboarded_v1',WK=0,WK_N=5;
    (function initDots(){var d=$('wk-dots');for(var i=0;i<WK_N;i++){var s=document.createElement('i');if(i===0)s.className='on';d.appendChild(s);}})();
    function renderWalk(){[].forEach.call(document.querySelectorAll('.wk-step'),function(s){s.classList.toggle('on',+s.dataset.w===WK)});[].forEach.call($('wk-dots').children,function(d,i){d.classList.toggle('on',i===WK)});$('wk-back').disabled=WK===0;$('wk-next').textContent=WK===WK_N-1?'Done':'Next';}
    function walkStep(dir){if(dir>0&&WK===WK_N-1){closeWalk();return;}WK=Math.max(0,Math.min(WK_N-1,WK+dir));renderWalk();}
    function openWalk(){WK=0;renderWalk();$('walk').classList.add('on');}
    function closeWalk(){$('walk').classList.remove('on');try{localStorage.setItem(WK_KEY,'1');}catch(e){}}
    try{if(!localStorage.getItem(WK_KEY))openWalk();}catch(e){}
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&$('walk').classList.contains('on'))closeWalk();});
  </script></body></html>`;
}

// ---- serving helpers ----------------------------------------------------------------------------
function send(res, code, type, body) { res.writeHead(code, { 'content-type': type }); res.end(body); }
function readBody(req) { return new Promise((resolve) => { let b = ''; req.on('data', c => b += c); req.on('end', () => resolve(b)); }); }
function serveReport(res, id, file, prefix) {
  const f = path.join(RUNS, id, file);
  if (!fs.existsSync(f)) return send(res, 404, 'text/plain', 'report not found');
  let html = fs.readFileSync(f, 'utf8');
  // UI-only serving fix: some frozen renderers emit Windows backslash separators in image paths
  // (path.relative on win32). Normalize \ -> / inside quoted image refs so the browser resolves them
  // under the injected <base>. Engine output on disk is untouched; only the served copy is normalized.
  html = html.replace(/((?:src|href)=")([^"]*\.(?:png|jpe?g|webp|gif|svg))(")/gi, (m, a, pth, z) => a + pth.replace(/\\/g, '/') + z);
  // inject <base> so relative asset paths (shots/…, screenshots/…) resolve under the run dir
  const base = `<base href="/${prefix}/${id}/">`;
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html;
  send(res, 200, 'text/html; charset=utf-8', html);
}
function serveAsset(res, id, rest) {
  try { rest = decodeURIComponent(rest); } catch (_) {} // filenames carry spaces + '·' → percent-encoded by the browser
  rest = rest.replace(/\\/g, '/').replace(/\.\.[/\\]/g, ''); // normalize + strip traversal
  const f = path.join(RUNS, id, rest);
  if (!f.startsWith(RUNS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'text/plain', 'not found');
  send(res, 200, MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', fs.readFileSync(f));
}
// pull an existing report route (id + trailing asset) apart: /prefix/<id>[/<asset...>]
function splitRoute(pathname, prefix) {
  const rest = pathname.slice(prefix.length).replace(/^\/+/, '');
  const slash = rest.indexOf('/');
  return slash < 0 ? { id: safe(rest), asset: '' } : { id: safe(rest.slice(0, slash)), asset: rest.slice(slash + 1) };
}

// ---- report history listing ---------------------------------------------------------------------
function listRuns() {
  if (!fs.existsSync(RUNS)) return [];
  return fs.readdirSync(RUNS).filter(d => !d.startsWith('_') && (() => { try { return fs.statSync(path.join(RUNS, d)).isDirectory(); } catch (_) { return false; } })()).map(id => {
    const dir = path.join(RUNS, id);
    let kind = 'audit', json = 'report.json';
    if (fs.existsSync(path.join(dir, 'visual-match.html'))) { kind = 'visual'; json = 'visual-match.json'; }
    else if (id.includes('-cert-')) { kind = 'cert'; json = 'report.json'; }
    let when = ''; try { when = new Date(fs.statSync(dir).mtimeMs).toISOString().replace('T', ' ').slice(0, 16); } catch (_) {}
    const host = id.replace(/-(vis|cert)-\d+$/, '').replace(/-\d{10,}$/, '');
    return { id, kind, host, when, json, mtime: (() => { try { return fs.statSync(dir).mtimeMs; } catch (_) { return 0; } })() };
  }).sort((a, b) => b.mtime - a.mtime).slice(0, 60);
}

// ---- server -------------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const p = u.pathname;
    if (req.method === 'GET' && p === '/') return send(res, 200, 'text/html; charset=utf-8', appPage());
    if (req.method === 'GET' && p === '/api/baselines') return send(res, 200, 'application/json', JSON.stringify({ baselines: listBaselines() }));
    if (req.method === 'GET' && p === '/api/reports') { let cases = []; try { cases = loadCases(path.join(DATA, 'portfolio.jsonl')); } catch (_) {} return send(res, 200, 'application/json', JSON.stringify({ runs: listRuns(), cases })); }

    for (const [prefix, file] of [['report', 'report.html'], ['compare', 'comparison.html'], ['visual', 'visual-match.html'], ['certify', 'report.html']]) {
      if (req.method === 'GET' && p.startsWith('/' + prefix + '/')) {
        const { id, asset } = splitRoute(p, '/' + prefix);
        return asset ? serveAsset(res, id, asset) : serveReport(res, id, file, prefix);
      }
    }

    if (req.method === 'POST' && p === '/api/run') return apiRun(req, res);
    if (req.method === 'POST' && p === '/api/visual') return apiVisual(req, res);
    if (req.method === 'POST' && p === '/api/certify') return apiCertify(req, res);
    return send(res, 404, 'text/plain', 'not found');
  } catch (e) { send(res, 500, 'text/plain', 'server error: ' + (e && e.message || e)); }
});

// 1 — Site Audit (unchanged engine path)
async function apiRun(req, res) {
  let opts; try { opts = JSON.parse(await readBody(req) || '{}'); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'bad json' })); }
  const url = norm(opts.url); if (!url) return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'pass a site URL' }));
  let host; try { host = new URL(url).host; } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'invalid URL' })); }
  const id = safe(host) + '-' + Date.now(), outDir = path.join(RUNS, id);
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
  const emit = (o) => { try { res.write(JSON.stringify(o) + '\n'); } catch (e) {} };
  try {
    const data = await runAudit(url, { maxPages: opts.maxPages || 30, render: opts.render !== false, renderSample: Math.min(opts.maxPages || 30, 25), screensDir: path.join(outDir, 'screenshots'), log: () => {}, progress: (pct, phase) => emit({ t: 'p', pct, phase }) });
    emit({ t: 'p', pct: 99, phase: 'writing report' });
    renderReport(data, outDir); recordScan(data);
    let comparison = false, cmp = null;
    if (opts.save) saveBaseline(data, opts.save);
    if (opts.baseline) { try { const base = loadResult(opts.baseline); base.data._label = opts.baseline; data._label = 'current'; const d = diff(base.data, data); renderCompare(d, outDir); comparison = true; cmp = d.counts; } catch (e) {} }
    emit({ t: 'done', ok: true, id, verdict: data.verdict, score: data.score, tally: data.tally, comparison, cmp }); res.end();
  } catch (e) { emit({ t: 'done', ok: false, error: String(e && e.message || e) }); res.end(); }
}

// 2 — Visual Comparison (frozen visual-match engine)
async function apiVisual(req, res) {
  let o; try { o = JSON.parse(await readBody(req) || '{}'); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'bad json' })); }
  const ref = norm(o.ref), tgt = norm(o.target);
  if (!ref || !tgt) return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'pass Reference and Target URLs' }));
  const SCOPE = { single: 1, multiple: o.maxPages || 8, sitemap: o.maxPages || 80, full: o.maxPages || 150 };
  const maxPages = SCOPE[o.scope] || o.maxPages || 8;
  const vps = Array.isArray(o.viewports) && o.viewports.length ? visualMatch.VIEWPORTS.filter(v => o.viewports.includes(v.label)) : null;
  const id = safe(H(ref)) + '-vis-' + Date.now(), outDir = path.join(RUNS, id);
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
  const emit = (o2) => { try { res.write(JSON.stringify(o2) + '\n'); } catch (e) {} };
  try {
    emit({ t: 'p', pct: 6, phase: 'discovering + rendering pages' });
    const data = await visualMatch.run(ref, tgt, { maxPages, outDir, viewports: vps, axes: o.axes, log: () => {}, progress: (pct, phase) => emit({ t: 'p', pct: Math.max(6, Math.min(96, pct || 0)), phase: phase || 'comparing' }) });
    emit({ t: 'p', pct: 98, phase: 'writing report' });
    renderVisual(data, outDir);
    emit({ t: 'done', ok: true, id, overall: data.overall, pairs: data.pairs, viewports: (data.viewports || []).length, sharp: data.sharp }); res.end();
  } catch (e) { emit({ t: 'done', ok: false, error: String(e && e.message || e) }); res.end(); }
}

// 3 — Migration Certification (frozen pipeline; mirrors sgen-qa-certify.js orchestration)
async function apiCertify(req, res) {
  let o; try { o = JSON.parse(await readBody(req) || '{}'); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'bad json' })); }
  const source = norm(o.source), target = norm(o.target);
  if (!source || !target) return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'pass Source and Target URLs' }));
  const maxPages = o.maxPages || 30, sitemapOnly = !!o.sitemapOnly;
  const id = safe(H(source)) + '-cert-' + Date.now(), outDir = path.join(RUNS, id);
  fs.mkdirSync(outDir, { recursive: true });
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
  const emit = (o2) => { try { res.write(JSON.stringify(o2) + '\n'); } catch (e) {} };
  try {
    emit({ t: 'p', pct: 8, phase: 'inventory — crawling source', stage: 'inventory' });
    const refCrawl = await discoverPages(source, { maxPages, sitemapOnly, log: () => {} });
    emit({ t: 'p', pct: 22, phase: 'inventory — crawling target', stage: 'inventory' });
    const tgtCrawl = await discoverPages(target, { maxPages, sitemapOnly, log: () => {} });
    const at = new Date().toISOString();
    let auditResult = null, visualResult = null;
    if (o.production !== false) { emit({ t: 'p', pct: 42, phase: 'production validation — auditing target', stage: 'production' }); try { auditResult = await runAudit(target, { maxPages, render: true, screensDir: path.join(outDir, 'shots'), log: () => {} }); } catch (e) {} }
    if (o.visual) { emit({ t: 'p', pct: 62, phase: 'visual comparison — SGEN breakpoints', stage: 'visual' }); try { visualResult = await visualMatch.run(source, target, { maxPages, outDir: path.join(outDir, 'visual'), log: () => {} }); } catch (e) {} }
    emit({ t: 'p', pct: 82, phase: 'certifying', stage: 'certification' });
    const idRegistry = new IdRegistry(path.join(DATA, 'inventory-ids.jsonl'));
    const r = certifyMigration(refCrawl.pages, tgtCrawl.pages, {
      idRegistry, source: H(source), target: H(target), sourceHost: H(source), targetHost: H(target),
      auditResult, visualResult, at, capped: refCrawl.capped || tgtCrawl.capped,
      meta: { gitCommit, build: 'ui', environment: `node ${process.version} · ${process.platform}` },
    });
    emit({ t: 'p', pct: 96, phase: 'writing report' });
    fs.writeFileSync(path.join(outDir, 'report.html'), r.report.html);
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(r.report.json, null, 2));
    emit({ t: 'done', ok: true, id, verdict: r.cert.verdict, tally: r.cert.tally }); res.end();
  } catch (e) { emit({ t: 'done', ok: false, error: String(e && e.stack || e) }); res.end(); }
}

server.requestTimeout = 0; server.headersTimeout = 0;
fs.mkdirSync(RUNS, { recursive: true }); fs.mkdirSync(DATA, { recursive: true });
server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`\nSGEN Migration QA Suite → http://127.0.0.1:${PORT}\n(4 tools: Site Audit · Visual Comparison · Migration Certification · Reports. Ctrl+C to stop.)\n`);
  if (arg('open', false)) { try { spawn(process.platform === 'win32' ? 'cmd' : 'sh', process.platform === 'win32' ? ['/c', 'start', '', `http://127.0.0.1:${PORT}`] : ['-c', `xdg-open http://127.0.0.1:${PORT}`], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {} }
});

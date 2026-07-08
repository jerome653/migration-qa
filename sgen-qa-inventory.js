#!/usr/bin/env node
'use strict';
// sgen qa-inventory <url> [--compare <target>] — the inventory-driven engine (P0 + P1).
//
//   sgen qa-inventory <url>                     build + print the site inventory (stable IDs + lifecycle)
//   sgen qa-inventory <ref> --compare <target>  completeness: what did the source have that target lost?
//   [--max-pages N] [--data <dir>] [--json]
//
// Deterministic, no AI. Stable IDs persist to <data>/inventory-ids.jsonl so a logical object keeps its
// ID across runs. exit 0 = PASS · 1 = FAIL / blocking missing · 2 = usage.
const path = require('path');
const { discoverPages } = require('./lib/migration-qa/crawl');
const { buildInventory } = require('./lib/site-qa/inventory');
const { certifyMigration } = require('./lib/site-qa/inventory/certify-pipeline');
const { IdRegistry } = require('./lib/site-qa/inventory/id-registry');

function args(argv) { const a = argv.slice(2); const o = { _: [] }; for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; o[k] = v; } else o._.push(a[i]); } return o; }
function usage(c) { process.stdout.write(`sgen qa-inventory <url> [--compare <target>] — inventory-driven audit/completeness\n\n  --compare <target>   diff this reference against a target (source→migrated completeness)\n  --max-pages N        crawl cap (default 60)\n  --data <dir>         persist stable inventory IDs (default .auditor-data)\n  --json               machine output\n\n  exit 0 = PASS · 1 = FAIL/blocking missing · 2 = usage\n`); process.exit(c); }
const host = u => { try { return new URL(u).host; } catch (_) { return ''; } };

(async () => {
  const o = args(process.argv);
  const url = o._[0];
  if (!url || o.help) usage(url ? 0 : 2);
  const maxPages = o['max-pages'] ? +o['max-pages'] : 60;
  const dataRoot = path.resolve(o.data || '.auditor-data');
  const idRegistry = new IdRegistry(path.join(dataRoot, 'inventory-ids.jsonl'));

  process.stderr.write(`▶ inventory ${url}\n`);
  const refCrawl = await discoverPages(url, { maxPages, log: m => process.stderr.write('  ' + m + '\n') });
  const ref = buildInventory(refCrawl.pages, { idRegistry, host: host(url) });

  if (o.compare) { process.stderr.write('Use `sgen qa-certify ' + url + ' --target ' + o.compare + '` for source→target completeness + certification.\n'); process.exit(2); }

  // single-site inventory (Tool 1 inventory view)
  if (o.json) { process.stdout.write(JSON.stringify({ counts: ref.counts, items: Object.fromEntries(Object.entries(ref.items).map(([t, l]) => [t, l.map(i => ({ id: i.id, key: i.identityKey, state: i.state, meta: i.meta }))])) }, null, 2) + '\n'); }
  else {
    process.stdout.write(`\n  INVENTORY  ${url}   (${ref.total} items, stable IDs)\n`);
    for (const [t, list] of Object.entries(ref.items)) {
      if (!list.length) continue;
      process.stdout.write(`\n  ${t.toUpperCase()}  (${list.length})\n`);
      for (const it of list.slice(0, 12)) process.stdout.write('    ' + it.id.padEnd(11) + (it.meta.key || it.meta.formType || it.meta.role || it.meta.heading || it.meta.path || it.identityKey.replace(/^[a-z]+:/, '')).toString().slice(0, 60) + '\n');
      if (list.length > 12) process.stdout.write(`    … +${list.length - 12} more\n`);
    }
  }
  process.exit(0);
})().catch(e => { process.stderr.write('qa-inventory error: ' + (e && e.stack || e) + '\n'); process.exit(1); });

#!/usr/bin/env node
// sgen — unified entrypoint for SGEN Migration QA. Routes `sgen <command> [args]` to the stage CLIs in
// this dir. Thin dispatcher: spawns the target with stdio inherited and forwards the exit code.
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const MAP = {
  'qa-migration': 'sgen-qa-migration.js',
  'qa-site': 'sgen-qa-site.js',
  'qa-full': 'sgen-qa-full.js',
  'qa-inventory': 'sgen-qa-inventory.js',
  'qa-certify': 'sgen-qa-certify.js',
  'qa-portfolio': 'sgen-qa-portfolio.js',
  'qa-compare': 'sgen-qa-compare.js',
  'qa-visual-match': 'sgen-qa-visual-match.js',
  'qa-serve': 'sgen-qa-serve.js',
  selftest: 'sgen-selftest.js',
  update: 'sgen-update.js',
  version: 'sgen-version.js',
  rollback: 'sgen-rollback.js',
};

function printHelp() {
  console.log([
    'SGEN Migration QA',
    '',
    'Usage: sgen <command> [args]',
    '',
    '  qa-serve     [--port N]          local web UI — four tools (127.0.0.1:7878)',
    '  qa-site      <url>               full-site QA tester (links, a11y, security, perf, cross-browser)',
    '  qa-certify   <src> --target <t>  Migration Certification (completeness + evidence + verdict)',
    '  qa-visual-match <old> <new>      visual comparison across the six SGEN breakpoints',
    '  qa-inventory <url>               inventory-driven site inventory (stable IDs + lifecycle)',
    '  qa-portfolio <src> --target <t>  record a certified case study',
    '  qa-compare   <A> <B>             diff two scans',
    '  qa-full / qa-migration <url>     wired scan / post-migration production-ready gate',
    '',
    '  selftest                         offline smoke test (deps, registry, unit tests, UI boots)',
    '  update                           git pull latest patch + reinstall if changed + re-verify',
    '  version                          shipped build + engine/registry versions',
    '  rollback [<tag>]                 revert to a previous release + verify',
    '',
    'Read OPERATOR-GUIDE-v1.0.md before signing off a migration.',
    'exit 0 = ok, 1 = fail, 2 = usage.',
  ].join('\n'));
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') { printHelp(); process.exit(cmd ? 0 : 1); }
  const script = MAP[cmd];
  if (!script) { console.error(`sgen: unknown command "${cmd}"`); printHelp(); process.exit(2); }
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...rest], { stdio: 'inherit' });
  process.exit(r.status == null ? 1 : r.status);
}
main();

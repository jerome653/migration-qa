'use strict';
// inventory/certify-pipeline.js — the ORCHESTRATOR (not a layer). Wires the frozen layers in order —
// Provider → Inventory → Comparison → Evidence → Certification → Reporting — for Tool 3 (Migration
// Certification). Each layer is called through its own module; none reaches across. Pure composition
// over inventory items; deterministic given the same crawl inputs + `at`.
const { buildInventory, IdRegistry } = require('./index');
const { compare } = require('./compare');
const { visualStage } = require('./visual-stage');
const { productionStage } = require('./audit-stage');
const { collectEvidence } = require('./evidence');
const { certify } = require('./certification');
const { renderMigrationReport } = require('./migration-report');

// certifyMigration(refPages, tgtPages, opts) — full frozen layer pipeline (Tool 3).
//   opts.visualResult  — output of visual-match run() (Phase 1: Visual Comparison stage)
//   opts.auditResult   — output of runAudit on the target (Phase 2: Production Validation stage)
//   opts.exceptions    — [{ relatedIds, reason, approver, date, evidence }] (Phase 4: Approved Exceptions)
function certifyMigration(refPages, tgtPages, opts = {}) {
  const at = opts.at || '';
  const idRegistry = opts.idRegistry || new IdRegistry(opts.persistPath || null);
  const refInv = buildInventory(refPages, { idRegistry, host: opts.sourceHost, target: opts.source });
  const tgtInv = buildInventory(tgtPages, { idRegistry, host: opts.targetHost, target: opts.target });

  // Comparison (completeness) — `capped` from either crawl downgrades "missing" to Manual Verification
  const diff = compare(refInv, tgtInv, { allowRemoved: opts.allowRemoved, capped: opts.capped, at });
  // Visual Comparison (Phase 1) — maps visual findings onto inventory items
  const visual = opts.visualResult ? visualStage(refInv, tgtInv, opts.visualResult, { at, matchThreshold: opts.matchThreshold, pixelThreshold: opts.pixelThreshold }) : { mapped: 0 };
  // Production Validation (Phase 2) — maps target audit findings onto inventory items
  const production = opts.auditResult ? productionStage(refInv, tgtInv, opts.auditResult, { at }) : { mapped: 0, orphan: 0 };
  // Evidence + Certification (consumes only inventory items + their cross-axis findings).
  // Target-only items participate too (Phase 6) — evidence + certification, never ignored.
  const ev = collectEvidence([...Object.values(refInv.items).flat(), ...diff.added], { at });
  const cert = certify(refInv, { at, exceptions: opts.exceptions, extraItems: diff.added });
  const report = renderMigrationReport(refInv, tgtInv, diff, cert, { source: opts.source, target: opts.target, generatedAt: at, visual, production, meta: opts.meta });

  return { refInv, tgtInv, diff, visual, production, evidence: ev, cert, report };
}

module.exports = { certifyMigration };

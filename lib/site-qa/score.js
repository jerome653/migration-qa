'use strict';
// score.js — SGEN Quality Score v2. Deterministic, explainable, no AI, no hidden math.
//
// Constitutional: this file hardcodes NO deductions and NO weights. Both come from the Rule
// Registry (rules/registry.js) — the single source of truth. Change a number there, re-run, done.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHY v2 (3.0.0) — v1 had two defects that made the number untrustworthy. Both measured, not guessed:
//
//  1. THE SCORE HAD A FLOOR OF 39. v1 was `category = 100 − Σdeductions`. Since each suite's total
//     available deductions differ wildly, most suites could never reach 0. Measured against the real
//     registry: a site where EVERY SINGLE CHECK FAILS scored 39/100. It could not express "disaster".
//
//  2. SECTIONS WERE NOT COMPARABLE. Under v1, a total failure of every check in a suite scored:
//        forms 93 · console 78 · performance 72 · crossbrowser 72 · responsive 53 · links 49
//        a11y 46 · functional 26 · seo 0 · security 0
//     "Forms: 93" could mean every form check failed. 10 of 12 suites could never reach 0, so a 72 in
//     Performance (total failure) and a 72 in SEO (moderate) meant completely different things.
//
// THE v2 MODEL — score the share of weighted risk RESOLVED, not an absolute deduction total:
//   • category_score = 100 × (1 − openRisk / totalRisk)   over that suite's scorable checks
//       openRisk  = Σ deductions of its non-pass, non-manual checks
//       totalRisk = Σ deductions of ALL its non-manual checks (the worst case for that suite)
//   • overall = Σ(category_score × weight) / Σ(weight), over suites that HAVE scorable checks
//   • Every suite now uses the full 0–100. All-pass = 100. All-fail = 0. Always.
//   • 50 means the same thing in every section: half that section's weighted risk is unresolved.
//   • A suite with no scorable checks is EXCLUDED from the average (it has no opinion) rather than
//     silently scoring 100 and inflating the overall.
//
// ⚠️ BREAKING: v2 scores are NOT comparable to v1 scores. This is why 3.0.0 is a major.
//    Re-baseline before comparing. Every scan records `model` — check it before diffing two runs.
//
// Manual + pass rows never deduct. Same input → same score, always. Every deduction still
// line-itemed with its rule id ("SEO-006 · −18 · Canonical points off").
// ─────────────────────────────────────────────────────────────────────────────────────────────

const { WEIGHTS, getById, RULES } = require('./rules/registry');

const MODEL = 'sgen-quality-v2';

// Native identity: deduction resolves ONLY by the row's ruleId (WP-001). No title lookup.
function deductionFor(row) {
  const rule = row.ruleId ? getById(row.ruleId) : null;
  if (rule) return { points: rule.manual ? 0 : rule.deduction, ruleId: rule.id };
  return { points: 0, ruleId: null };
}

// ── THE DENOMINATOR MUST COME FROM THE REGISTRY, NOT FROM THE ROWS ──────────────────────────
// Caught by a live scan of sgen.com: v2 first shipped summing totalRisk over the rows present.
// That returns **0 for every suite on every real site**, because the engine emits per-rule rows
// ONLY for violations — a passing check is a generic summary row with `ruleId: null, deduction: 0`
// ("Every page has a title tag"). So the rows carrying deductions were exactly the failing ones:
// totalRisk == openRisk → score 0. sgen.com scored quality 0 with 33 passes and 4 failures.
//
// It survived unit tests because those built suites from the FULL registry — every row had a
// ruleId. Real audit data never looks like that. Synthetic fixtures agreed with the bug.
//
// The denominator is therefore the suite's TOTAL KNOWN RISK from the registry: every non-manual
// rule that could fire in it. A suite's score is then "the share of this suite's known risk that
// is currently open" — all-pass → 100, all-fail → 0, and it still cannot floor, because it is a
// ratio (v1's floor came from the ABSOLUTE `100 − Σded`, which most suites could never drive to 0).
const TOTAL_RISK_BY_SUITE = (() => {
  const t = {};
  for (const r of (RULES || [])) {
    if (r.manual || !(r.deduction > 0)) continue;
    t[r.suite] = (t[r.suite] || 0) + r.deduction;
  }
  return t;
})();

function compute(suitesOut) {
  const categories = suitesOut.map(s => {
    const deductions = [];
    let openRisk = 0;

    for (const row of s.checks) {
      if (row.status === 'pass' || row.status === 'manual') continue;
      const d = deductionFor(row);
      if (!(d.points > 0)) continue;
      openRisk += d.points;
      deductions.push({ label: row.name, points: d.points, ruleId: d.ruleId, status: row.status });
    }

    deductions.sort((a, b) => b.points - a.points);

    const totalRisk = TOTAL_RISK_BY_SUITE[s.key] || 0;
    // A suite the registry knows no scorable rules for has no opinion → null, and is EXCLUDED from
    // the overall rather than defaulting to 100 (which would inflate the average with a suite that
    // measured nothing). Clamp: openRisk can exceed totalRisk if one rule fires on many pages.
    const score = totalRisk > 0
      ? Math.max(0, Math.round(100 * (1 - Math.min(openRisk, totalRisk) / totalRisk)))
      : null;

    return {
      key: s.key,
      name: s.name,
      weight: WEIGHTS[s.key] || 0,
      score,
      deductions,
      openRisk,
      totalRisk,
    };
  });

  // Weighted mean over suites that actually measured something AND carry weight.
  const scored = categories.filter(c => c.score !== null && c.weight > 0);
  const wsum = scored.reduce((a, c) => a + c.weight, 0);
  const overall = wsum > 0
    ? Math.round(scored.reduce((a, c) => a + c.score * c.weight, 0) / wsum)
    : null;

  return { overall, categories, model: MODEL };
}

module.exports = { compute, WEIGHTS, deductionFor, MODEL };

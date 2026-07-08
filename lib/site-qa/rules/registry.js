'use strict';
// registry.js — SGEN Site Auditor Rule Registry (Phase 1).
//
// The single source of truth. Every deterministic check the auditor performs is a RULE with a
// permanent ID. IDs never change and are never reused. Scoring, reporting, docs, analytics and the
// engine all derive from this registry — nothing hardcodes a deduction or a suite anywhere else.
//
// Fields (all required):
//   id            permanent, immutable  (e.g. "SEO-014")
//   slug          stable kebab-case handle
//   title         canonical finding title (MUST equal the string the check emits — the engine maps by it)
//   suite         exactly one of the 10 suites (one-check-one-suite is constitutional)
//   category      grouping within the suite (docs/UX only)
//   severity      critical | high | medium | low | manual   (classifies; does NOT set the score)
//   deduction     points off the suite's 100 when this rule fires (0 for manual)
//   method        static | render | network | cert | engine | manual
//   deterministic true for every rule here (constitutional)
//   manual        true = never affects score (Unknown, not Failed)
//   autofix       reserved for the future Autofix engine (all false today)
//   introduced    auditor version the rule first shipped in
//
// SEVERITY classifies the finding; DEDUCTION reflects real impact per Jerome's model. They are
// independent on purpose (a "high" TLS-expired hurts more than a "high" placeholder).

const REGISTRY_VERSION = '1.3.1'; // bump on ANY rule metadata change; every scan records this. 1.1.0: +SEO-029/030. 1.2.0: +Suite 11 Best Practices (advisory, weight 0 — provably score-neutral; WP-007). 1.2.1: +FUNC-008 content-artifacts. 1.3.0: +Suite 12 Visual Match (advisory, weight 0 — VIS-001/002; folded from qa-visual-match into the pipeline). 1.3.1: +FUNC-009 common-misspelling.

// 10 SCORED suites + 1 ADVISORY suite (best-practices). Best Practices carries weight 0: it has its
// own sub-score for reporting, but contributes NOTHING to the SGEN Quality Score. This keeps every
// historical overall score byte-identical (proven by golden parity) — additive, not a scoring change.
const SUITES = ['functional', 'links', 'forms', 'responsive', 'a11y', 'seo', 'performance', 'security', 'crossbrowser', 'console', 'best-practices', 'visual'];
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'manual'];
const METHODS = ['static', 'render', 'network', 'cert', 'engine', 'manual'];

// Suite category weights (scored suites sum = 100; best-practices = 0 advisory). Overall = Σ(suiteScore × weight)/Σweight.
const WEIGHTS = { functional: 18, links: 8, forms: 6, responsive: 8, a11y: 14, seo: 16, performance: 14, security: 10, crossbrowser: 3, console: 3, 'best-practices': 0, visual: 0 };

const V1 = '1.0';
const R = (id, slug, title, suite, category, severity, deduction, method, extra = {}) => ({
  id, slug, title, suite, category, severity, deduction, method,
  deterministic: true, manual: severity === 'manual', autofix: false, introduced: V1,
  docs: `/docs/rules/${id.toLowerCase()}`, ...extra,
});

const RULES = [
  // ---------------- FUNCTIONAL ----------------
  R('FUNC-001', 'page-status-server-error', 'Page returns server error', 'functional', 'availability', 'critical', 25, 'network'),
  R('FUNC-002', 'page-status-client-error', 'Page returns client error', 'functional', 'availability', 'critical', 18, 'network'),
  R('FUNC-003', 'page-status-redirect', 'Page in sitemap/nav redirects', 'functional', 'availability', 'medium', 4, 'network'),
  R('FUNC-004', 'placeholder-content', 'Placeholder / lorem text in visible copy', 'functional', 'content', 'high', 6, 'static'),
  R('FUNC-005', 'global-components', 'Global landmark(s) not detected', 'functional', 'components', 'low', 2, 'static'),
  R('FUNC-006', 'empty-code-block', 'Empty code block', 'functional', 'content', 'low', 2, 'static'),
  R('FUNC-007', 'empty-table', 'Empty/structureless table', 'functional', 'content', 'low', 2, 'static'),
  R('FUNC-008', 'content-artifacts', 'Loose symbols / unresolved tokens / mojibake in visible copy', 'functional', 'content', 'high', 6, 'static', { introduced: '1.2.1' }),
  R('FUNC-009', 'misspelling-common', 'Common misspelling / typo in visible copy', 'functional', 'content', 'medium', 4, 'static', { introduced: '1.3.1' }),
  R('FUNC-900', 'visual-design-intent', 'Visual design matches the intended design', 'functional', 'manual', 'manual', 0, 'manual'),

  // ---------------- LINKS & REDIRECTS ----------------
  R('LINK-001', 'broken-internal-link', 'Broken internal link(s)', 'links', 'integrity', 'high', 12, 'network'),
  R('LINK-002', 'broken-external-link', 'Broken external link(s)', 'links', 'integrity', 'medium', 4, 'network'),
  R('LINK-003', 'redirect-chain', 'Redirect chain(s) / loop(s)', 'links', 'integrity', 'high', 6, 'network'),
  R('LINK-004', 'soft-404', 'Soft 404 (unknown URL returns 200)', 'links', 'integrity', 'medium', 5, 'network'),
  R('LINK-005', 'anchor-target', 'In-page anchor links point to missing IDs', 'links', 'integrity', 'low', 2, 'static'),

  // ---------------- FORMS ----------------
  R('FORM-001', 'form-structure', 'Form structure issue', 'forms', 'structure', 'medium', 5, 'static'),
  R('FORM-900', 'form-submission-delivery', 'Form submission → email / CRM delivery', 'forms', 'manual', 'manual', 0, 'manual'),

  // ---------------- RESPONSIVE ----------------
  R('RESP-001', 'viewport-meta', 'No <meta name="viewport">', 'responsive', 'meta', 'critical', 20, 'static'),
  R('RESP-002', 'horizontal-overflow', 'Page scrolls horizontally', 'responsive', 'overflow', 'high', 10, 'render'),
  R('RESP-003', 'overflow-element', 'Element bleeds past right edge', 'responsive', 'overflow', 'high', 10, 'render'),
  R('RESP-004', 'element-wider-than-viewport', 'Element wider than viewport', 'responsive', 'overflow', 'high', 10, 'render'),
  R('RESP-005', 'tap-target-small', 'Tap target < 44px', 'responsive', 'touch', 'medium', 4, 'render'),
  R('RESP-006', 'input-font-small', 'Input font < 16px', 'responsive', 'touch', 'low', 2, 'render'),
  R('RESP-900', 'multi-device-eyeball', 'Multi-device eyeball pass (Responsive Viewer)', 'responsive', 'manual', 'manual', 0, 'manual'),

  // ---------------- ACCESSIBILITY ----------------
  R('A11Y-001', 'axe-wcag', 'axe-core WCAG 2.1 A/AA violation', 'a11y', 'wcag', 'high', 12, 'render', { titleMatch: /axe|WCAG/i }),
  R('A11Y-002', 'low-contrast', 'Text below AA contrast', 'a11y', 'contrast', 'medium', 6, 'render'),
  R('A11Y-003', 'no-h1', 'No <h1> on page', 'a11y', 'headings', 'high', 6, 'static'),
  R('A11Y-004', 'multiple-h1', 'Multiple <h1> on page', 'a11y', 'headings', 'low', 2, 'static'),
  R('A11Y-005', 'heading-skip', 'Heading level skipped', 'a11y', 'headings', 'low', 2, 'static'),
  R('A11Y-006', 'img-missing-alt', 'Images missing alt text', 'a11y', 'images', 'medium', 6, 'static'),
  R('A11Y-007', 'img-missing-src', '<img> without a src', 'a11y', 'images', 'medium', 6, 'static'),
  R('A11Y-008', 'img-missing-dimensions', 'Images without width/height', 'a11y', 'images', 'low', 2, 'static'),
  R('A11Y-009', 'html-lang', '<html> missing lang attribute', 'a11y', 'semantics', 'low', 2, 'static'),

  // ---------------- SEO ----------------
  R('SEO-001', 'title-missing', 'Missing <title>', 'seo', 'metadata', 'high', 10, 'static'),
  R('SEO-002', 'title-length', 'Title length outside 10–70 chars', 'seo', 'metadata', 'low', 2, 'static'),
  R('SEO-003', 'meta-description-missing', 'Missing meta description', 'seo', 'metadata', 'medium', 6, 'static'),
  R('SEO-004', 'meta-description-length', 'Meta description length outside 50–170', 'seo', 'metadata', 'low', 2, 'static'),
  R('SEO-005', 'canonical-missing', 'Missing canonical URL', 'seo', 'canonical', 'medium', 8, 'static'),
  R('SEO-006', 'canonical-offdomain', 'Canonical points off the production domain', 'seo', 'canonical', 'critical', 18, 'static'),
  R('SEO-007', 'indexability-noindex-live', 'Live page is set to NOINDEX', 'seo', 'indexability', 'critical', 22, 'static'),
  R('SEO-008', 'indexability-staging-indexable', 'Staging page is indexable', 'seo', 'indexability', 'medium', 5, 'static'),
  R('SEO-009', 'duplicate-title', 'Duplicate title across pages', 'seo', 'duplication', 'medium', 5, 'static'),
  R('SEO-010', 'duplicate-description', 'Duplicate description across pages', 'seo', 'duplication', 'medium', 4, 'static'),
  R('SEO-011', 'social-og-incomplete', 'Incomplete Open Graph tags', 'seo', 'social', 'medium', 4, 'static'),
  R('SEO-012', 'social-twitter-missing', 'Missing twitter:card', 'seo', 'social', 'low', 2, 'static'),
  R('SEO-013', 'ogimage-no-load', 'og:image does not load', 'seo', 'social', 'medium', 4, 'network'),
  R('SEO-014', 'favicon-missing', 'No favicon declared', 'seo', 'metadata', 'low', 1, 'static'),
  R('SEO-015', 'favicon-no-load', 'Favicon does not load', 'seo', 'metadata', 'low', 1, 'network'),
  R('SEO-016', 'schema-none', 'No JSON-LD structured data', 'seo', 'structured-data', 'low', 3, 'static'),
  R('SEO-017', 'schema-invalid', 'Invalid JSON-LD', 'seo', 'structured-data', 'medium', 3, 'static'),
  R('SEO-018', 'schema-no-type', 'JSON-LD item missing @type', 'seo', 'structured-data', 'low', 3, 'static'),
  R('SEO-019', 'schema-bad-context', 'JSON-LD @context is not schema.org', 'seo', 'structured-data', 'low', 3, 'static'),
  R('SEO-020', 'robots-blocks-site', 'robots.txt blocks the whole site on live', 'seo', 'crawlability', 'critical', 20, 'network'),
  R('SEO-021', 'robots-no-sitemap', 'robots.txt has no Sitemap: line', 'seo', 'crawlability', 'low', 2, 'network'),
  R('SEO-022', 'sitemap-missing', 'No XML sitemap found', 'seo', 'crawlability', 'medium', 6, 'network'),
  R('SEO-023', 'sitemap-dead-url', 'Dead URL(s) in sitemap', 'seo', 'crawlability', 'medium', 4, 'network'),
  R('SEO-024', 'orphan-page', 'Orphan page(s) (not in sitemap)', 'seo', 'crawlability', 'medium', 4, 'network'),
  R('SEO-025', 'analytics-missing', 'No analytics/tracking detected on live page', 'seo', 'analytics', 'medium', 5, 'static'),
  R('SEO-026', 'analytics-staging-present', 'Tracking present on staging — verify target', 'seo', 'analytics', 'low', 2, 'static'),
  R('SEO-027', 'mobile-web-metadata', 'Mobile web-app metadata missing', 'seo', 'mobile', 'low', 2, 'static'),
  R('SEO-028', 'privacy-signals', 'Privacy / cookie signals incomplete', 'seo', 'compliance', 'low', 2, 'static'),
  R('SEO-029', 'robots-missing', 'No robots.txt', 'seo', 'crawlability', 'medium', 4, 'network'),
  R('SEO-030', 'staging-leak', 'Staging/preview host referenced on live page', 'seo', 'indexability', 'critical', 20, 'static'),

  // ---------------- PERFORMANCE ----------------
  R('PERF-001', 'cwv-lcp', 'Largest Contentful Paint', 'performance', 'core-web-vitals', 'medium', 6, 'render', { titleMatch: /Largest Contentful Paint|LCP needs/i }),
  R('PERF-002', 'cwv-cls', 'Cumulative Layout Shift', 'performance', 'core-web-vitals', 'medium', 6, 'render', { titleMatch: /Cumulative Layout Shift|CLS needs/i }),
  R('PERF-003', 'image-perf-lazy', 'Little/no image lazy-loading', 'performance', 'assets', 'low', 2, 'static'),
  R('PERF-004', 'image-perf-modern', 'No WebP/AVIF images detected', 'performance', 'assets', 'low', 2, 'static'),
  R('PERF-005', 'render-blocking', 'Render-blocking resources in <head>', 'performance', 'delivery', 'low', 2, 'static'),
  R('PERF-006', 'page-weight', 'Heavy page (many requests / large transfer)', 'performance', 'weight', 'medium', 5, 'render'),
  R('PERF-007', 'compression', 'HTML served without compression', 'performance', 'delivery', 'low', 2, 'static'),

  // ---------------- SECURITY ----------------
  R('SEC-001', 'tls-expired', 'TLS certificate has expired', 'security', 'tls', 'high', 18, 'cert'),
  R('SEC-002', 'tls-handshake-failed', 'TLS handshake failed', 'security', 'tls', 'high', 18, 'cert'),
  R('SEC-003', 'tls-untrusted', 'TLS certificate not fully trusted', 'security', 'tls', 'medium', 8, 'cert'),
  R('SEC-004', 'tls-host-mismatch', 'TLS certificate hostname mismatch', 'security', 'tls', 'medium', 8, 'cert'),
  R('SEC-005', 'tls-expiring', 'TLS certificate expiring soon', 'security', 'tls', 'medium', 8, 'cert'),
  R('SEC-006', 'tls-protocol', 'Outdated TLS protocol', 'security', 'tls', 'medium', 8, 'cert'),
  R('SEC-007', 'https-not-origin', 'Origin is not HTTPS', 'security', 'transport', 'high', 14, 'network'),
  R('SEC-008', 'https-not-enforced', 'HTTP not redirected to HTTPS', 'security', 'transport', 'high', 14, 'network'),
  R('SEC-009', 'mixed-content', 'Mixed content (http on https page)', 'security', 'transport', 'high', 12, 'static'),
  R('SEC-010', 'security-headers', 'Security headers missing', 'security', 'headers', 'medium', 6, 'static'),

  // ---------------- CROSS-BROWSER ----------------
  R('XBR-001', 'firefox-fail', 'Firefox failed to load the page', 'crossbrowser', 'render', 'high', 12, 'engine', { titleMatch: /Firefox failed to load/i }),
  R('XBR-002', 'webkit-fail', 'WebKit (Safari engine) failed to load the page', 'crossbrowser', 'render', 'high', 12, 'engine', { titleMatch: /WebKit.*failed to load/i }),
  R('XBR-003', 'engine-console-errors', 'Cross-browser console error(s)', 'crossbrowser', 'render', 'medium', 4, 'engine', { titleMatch: /(Firefox|WebKit).*console error/i }),

  // ---------------- CONSOLE & NETWORK ----------------
  R('CON-001', 'console-errors', 'JavaScript / console errors', 'console', 'runtime', 'high', 10, 'render'),
  R('CON-002', 'failed-requests', 'Failed / broken asset requests', 'console', 'network', 'high', 8, 'render'),

  // ---------------- BEST PRACTICES (Suite 11 — ADVISORY, weight 0; own sub-score, no overall impact) ----------------
  // Deterministic, static, non-overlapping with the 10 scored suites. Deductions shape the advisory
  // sub-score only. `introduced` = 1.2 (first shipped after the Architecture Freeze, additive).
  R('BP-001', 'doctype-missing', 'No <!DOCTYPE html> (quirks-mode risk)', 'best-practices', 'standards', 'medium', 5, 'static', { introduced: '1.2' }),
  R('BP-002', 'charset-missing', 'No character encoding declared', 'best-practices', 'standards', 'low', 3, 'static', { introduced: '1.2' }),
  R('BP-003', 'deprecated-html-tags', 'Deprecated HTML tag(s) in markup', 'best-practices', 'standards', 'low', 3, 'static', { introduced: '1.2' }),
  R('BP-004', 'target-blank-no-rel', 'target="_blank" without rel="noopener"', 'best-practices', 'safety', 'medium', 4, 'static', { introduced: '1.2' }),
  R('BP-005', 'generic-link-text', 'Non-descriptive link text ("click here")', 'best-practices', 'clarity', 'low', 2, 'static', { introduced: '1.2' }),
  R('BP-006', 'meta-generator-exposed', 'Platform/version exposed via <meta generator>', 'best-practices', 'hygiene', 'low', 2, 'static', { introduced: '1.2' }),
  R('BP-007', 'inline-event-handlers', 'Inline on*="" event handler(s)', 'best-practices', 'hygiene', 'low', 2, 'static', { introduced: '1.2' }),
  R('BP-008', 'legacy-doctype', 'Legacy/quirks DOCTYPE (not HTML5)', 'best-practices', 'standards', 'low', 2, 'static', { introduced: '1.2' }),

  // ---------------- VISUAL MATCH (Suite 12 — ADVISORY, weight 0; live vs staging, own sub-score) ----------------
  R('VIS-001', 'visual-mismatch', 'Visual mismatch vs reference exceeds threshold', 'visual', 'match', 'medium', 10, 'render', { introduced: '1.3' }),
  R('VIS-002', 'unmatched-page', 'Reference page has no match on the candidate site', 'visual', 'coverage', 'medium', 8, 'render', { introduced: '1.3' }),
];

// ---- runtime validation: fail fast, never run on an invalid registry (Phase 2 item 8) ----
const ID_RE = /^[A-Z0-9]+-\d{3}$/;
const byId = new Map();
const bySlug = new Map();
function validate() {
  for (const r of RULES) {
    if (!ID_RE.test(r.id)) throw new Error(`registry: bad id format ${r.id} (want SUITE-NNN)`);
    if (byId.has(r.id)) throw new Error(`registry: duplicate rule id ${r.id}`);
    if (bySlug.has(r.slug)) throw new Error(`registry: duplicate slug ${r.slug}`);
    if (!r.slug || !/^[a-z0-9-]+$/.test(r.slug)) throw new Error(`registry: ${r.id} bad slug "${r.slug}"`);
    if (!r.title) throw new Error(`registry: ${r.id} missing title`);
    if (!SUITES.includes(r.suite)) throw new Error(`registry: ${r.id} unknown suite ${r.suite}`);
    if (!SEVERITIES.includes(r.severity)) throw new Error(`registry: ${r.id} invalid severity ${r.severity}`);
    if (!METHODS.includes(r.method)) throw new Error(`registry: ${r.id} invalid method ${r.method}`);
    if (typeof r.deduction !== 'number' || r.deduction < 0 || r.deduction > 100) throw new Error(`registry: ${r.id} invalid deduction ${r.deduction}`);
    if (r.deterministic !== true) throw new Error(`registry: ${r.id} must be deterministic`);
    if ((r.severity === 'manual') !== r.manual) throw new Error(`registry: ${r.id} manual flag must match severity`);
    if (r.manual && r.deduction !== 0) throw new Error(`registry: manual rule ${r.id} must have deduction 0`);
    if (!r.manual && r.deduction === 0) throw new Error(`registry: non-manual rule ${r.id} must deduct > 0`);
    if (typeof r.docs !== 'string' || !r.docs.startsWith('/docs/rules/')) throw new Error(`registry: ${r.id} bad docs path`);
    if (!r.category) throw new Error(`registry: ${r.id} missing category`);
    byId.set(r.id, r); bySlug.set(r.slug, r);
  }
  const wsum = SUITES.reduce((a, s) => a + (WEIGHTS[s] || 0), 0);
  if (wsum !== 100) throw new Error(`registry: suite weights must total 100 (got ${wsum})`);
  for (const s of SUITES) if (!RULES.some(r => r.suite === s)) throw new Error(`registry: suite ${s} has no rules`);
}
validate();

// ---- rule lookup service (Phase 2 item 7) — the ONLY place rule queries live ----
function getById(id) { return byId.get(id) || null; }
function getBySlug(slug) { return bySlug.get(slug) || null; }
function bySuite(suite) { return RULES.filter(r => r.suite === suite); }
function getRules() { return RULES.slice(); }
function getManualRules() { return RULES.filter(r => r.manual); }
function getDeterministicRules() { return RULES.filter(r => r.deterministic); }
function getRulesByMethod(m) { return RULES.filter(r => r.method === m); }
function getRulesBySeverity(sev) { return RULES.filter(r => r.severity === sev); }
function getRulesByCategory(c) { return RULES.filter(r => r.category === c); }
function getSuiteOf(id) { const r = byId.get(id); return r ? r.suite : null; }

module.exports = {
  REGISTRY_VERSION, RULES, SUITES, SEVERITIES, METHODS, WEIGHTS,
  getById, getBySlug, bySuite, getSuiteOf,
  getRules, getManualRules, getDeterministicRules, getRulesByMethod, getRulesBySeverity, getRulesByCategory,
};

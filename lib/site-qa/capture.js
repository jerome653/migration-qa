'use strict';
// site-qa/capture.js — ONE canonical, deterministic screenshot pipeline, reused by every capture site
// (visual-match, cross-browser, production audit). The caller navigates first (waitUntil:'networkidle');
// this module then settles fonts + image decode, runs a deterministic lazy-load scroll pass, stabilizes,
// takes the screenshot, and returns additive capture metadata.
//
// Backward-compatible: same file path + same fullPage semantics as before — only the pixels are more
// complete (lazy content in, fonts settled) and a metadata object is returned for the evidence record.
// v1.0.1 evidence-capture hardening. Modifies capture ONLY — no certification / registry / algorithm change.

const CAPTURE_SCHEMA = '1.0';
let ENGINE_VERSION = '1.0.1';
try { ENGINE_VERSION = require('./inventory/versions').SCHEMA.migrationQaEngine; } catch (_) {}

// document.fonts.ready — resolves when all @font-face are loaded; false if the API is unavailable.
async function settleFonts(page) {
  try { return await page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready.then(() => true).catch(() => false) : false); }
  catch (_) { return false; }
}

// Wait for image decoding where supported (img.decode()); safe fallback + 3s cap so a stuck image can't hang.
async function decodeImages(page) {
  try {
    return await page.evaluate(async () => {
      if (!('decode' in HTMLImageElement.prototype)) return false;
      const imgs = [...document.images].filter(i => i.src && !i.complete);
      await Promise.race([
        Promise.allSettled(imgs.map(i => i.decode().catch(() => {}))),
        new Promise(r => setTimeout(r, 3000)),
      ]);
      return true;
    });
  } catch (_) { return false; }
}

// Deterministic lazy-load activation: top → incremental (≈0.85 viewport steps) → bottom → back to top.
// Small fixed steps (never one giant jump) so IntersectionObserver / loading="lazy" images fire in order.
async function lazyScroll(page) {
  try {
    const vp = (page.viewportSize && page.viewportSize()) || {};
    const vpH = vp.height || 900;
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    const step = Math.max(200, Math.floor(vpH * 0.85));
    for (let y = 0; y <= total; y += step) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(60); }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(90);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(60);
    return true;
  } catch (_) { return false; }
}

// Canonical capture. Caller must have already navigated (networkidle). Returns additive metadata.
async function stableCapture(page, { fullPage = true, path: shotPath, engine = 'chromium', navigation = 'networkidle', settleMs = 400 } = {}) {
  const t0 = Date.now();
  const fontsLoaded = await settleFonts(page);
  const imageDecode = await decodeImages(page);
  const lazyLoadPass = await lazyScroll(page);
  await page.waitForTimeout(settleMs);                 // final stabilization (≈300–500ms)
  let documentHeight = 0;
  try { documentHeight = await page.evaluate(() => document.documentElement.scrollHeight); } catch (_) {}
  const vp = (page.viewportSize && page.viewportSize()) || {};
  if (shotPath) await page.screenshot({ path: shotPath, fullPage });
  return {
    browser: engine,
    viewport: `${vp.width || '?'}x${vp.height || '?'}`,
    viewportWidth: vp.width || null,
    viewportHeight: vp.height || null,
    captureMode: fullPage ? 'full-page' : 'viewport',
    fullPage: !!fullPage,
    navigationStrategy: navigation,
    fontsLoaded,
    lazyLoadPass,
    imageDecode,
    documentHeight,
    capturedAt: new Date().toISOString(),
    captureDurationMs: Date.now() - t0,
    engineVersion: ENGINE_VERSION,
    captureSchema: CAPTURE_SCHEMA,
  };
}

module.exports = { stableCapture, CAPTURE_SCHEMA };

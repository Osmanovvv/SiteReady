"use strict";

// Optional real-performance module (PLAN-v2 §1, "самый тяжёлый шаг"). Runs Google
// Lighthouse against the START page (in Playwright's Chromium) to get REAL Core Web
// Vitals instead of the static "estimated" perf signals. Heavy and optional: lazily
// imported; if lighthouse / chrome-launcher aren't installed it's skipped and the
// audit is entirely unaffected.

const { URL } = require("url");
const { assertHostAllowed } = require("./net-guard");

function isLighthouseAvailable() {
  try {
    require.resolve("lighthouse");
    require.resolve("chrome-launcher");
    require.resolve("playwright");
    return true;
  } catch (_) {
    return false;
  }
}

// Run Lighthouse (performance only) on one URL → { score, lcp, cls, tbt, fcp, si }
// (ms except score/cls) or null on any failure — never throws to sink the audit.
// NOTE: Lighthouse launches its OWN Chrome, so its sub-resource requests are not
// covered by the deep egress guard (residual risk, documented in CONTRACT.md). The
// start URL itself is still validated here.
async function runLighthouse(url, opts = {}) {
  const { allowPrivate = false } = opts;
  let lighthouse, chromeLauncher, pw;
  try {
    lighthouse = (await import("lighthouse")).default;
    chromeLauncher = await import("chrome-launcher");
    pw = require("playwright");
  } catch (_) {
    return null;
  }

  assertHostAllowed(new URL(url), allowPrivate); // metadata/private start URL is refused

  let chrome;
  try {
    chrome = await chromeLauncher.launch({
      chromePath: pw.chromium.executablePath(),
      chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
    });
    const result = await lighthouse(url, {
      port: chrome.port,
      onlyCategories: ["performance"],
      output: "json",
      logLevel: "silent",
      maxWaitForLoad: 30000,
    });
    const lhr = result && result.lhr;
    if (!lhr) return null;
    const a = lhr.audits || {};
    const ms = (id) => (a[id] && typeof a[id].numericValue === "number" ? Math.round(a[id].numericValue) : null);
    const clsRaw = a["cumulative-layout-shift"] && a["cumulative-layout-shift"].numericValue;
    return {
      score: lhr.categories && lhr.categories.performance ? Math.round(lhr.categories.performance.score * 100) : null,
      lcp: ms("largest-contentful-paint"),
      cls: typeof clsRaw === "number" ? Number(clsRaw.toFixed(3)) : null,
      tbt: ms("total-blocking-time"),
      fcp: ms("first-contentful-paint"),
      si: ms("speed-index"),
    };
  } catch (_) {
    return null;
  } finally {
    // chrome-launcher can throw EPERM (sync) during temp cleanup on Windows — a throw
    // here would override the computed return, so swallow it with a real try/catch.
    if (chrome) { try { await chrome.kill(); } catch (_) { /* ignore cleanup errors */ } }
  }
}

module.exports = { isLighthouseAvailable, runLighthouse };

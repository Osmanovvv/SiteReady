"use strict";

// Deep mode (PLAN-v2 §1): render pages in a real browser (Playwright/Chromium) so
// client-rendered (SPA / React / Vue) sites stop being a blind spot. The rendered
// DOM is fed through the SAME 5-category checks as the static path — deep just
// produces the same per-page object shape, so the whole engine is reused.
//
// Playwright is NOT a dependency of the zero-dep engine. It is lazy-required; if it
// (or the browser) isn't installed, deep degrades with a clear DEEP_UNAVAILABLE error
// and the static path is entirely unaffected.

const net = require("net");
const dns = require("dns");
const fs = require("fs");
const { URL } = require("url");
const { parseHtml } = require("./html");
const { fetch } = require("./fetcher");
const { normalizeLink, hostKey, canonicalize } = require("./crawler");
const { assertHostAllowed, isAddressBlocked } = require("./net-guard");

// Deep renders in a real browser (heavy) → one page budget shared by the server
// clamp and the audit cap, so the limit is defined in exactly one place.
const DEEP_MAX_PAGES = 25;

// Documents/binaries: a headless browser DOWNLOADS these instead of navigating, so
// page.goto yields no response (status 0). Probe them with the static fetcher
// instead — that returns the real status/size (e.g. a 200 5 MB PDF).
const DOC_EXT = /\.(pdf|zip|rar|7z|gz|tar|docx?|xlsx?|pptx?|csv|rtf|odt|ods|mp4|webm|mov|avi|mp3|wav|ogg|dmg|exe|msi|apk|iso|bin)$/i;
function isDocLink(url) {
  try { return DOC_EXT.test(new URL(url).pathname); } catch (_) { return false; }
}
async function probeStatic(url, opts = {}) {
  const { allowPrivate = false, timeout = 25000 } = opts;
  const t = Math.min(timeout, 12000);
  const record = (r) => ({ url, finalUrl: r.finalUrl || url, status: r.status, redirectChain: r.redirectChain || [], ttfbMs: r.ttfbMs || 0, bytes: r.bytes || 0, contentType: r.contentType || null, contentEncoding: r.contentEncoding || null, page: null, consoleErrors: [], error: null });
  try {
    let r = await fetch(url, { method: "HEAD", allowPrivate, timeout: t });
    if (r.status === 403 || r.status === 405 || r.status === 501) {
      // many servers/CDNs reject HEAD (403/405/501) though GET is 200 — confirm with GET
      try { r = await fetch(url, { method: "GET", allowPrivate, timeout: t }); } catch (_) { /* keep HEAD result */ }
    }
    return record(r);
  } catch (e) {
    return { url, finalUrl: url, status: 0, redirectChain: [], ttfbMs: 0, bytes: 0, contentType: null, contentEncoding: null, page: null, consoleErrors: [], error: e.code || "UNREACHABLE" };
  }
}

function getPlaywright() {
  try {
    return require("playwright");
  } catch (_) {
    const e = new Error(
      "Глубокий режим недоступен: не установлен Playwright. Выполните: npm i playwright && npx playwright install chromium"
    );
    e.code = "DEEP_UNAVAILABLE";
    throw e;
  }
}

// Available only when BOTH the package and a downloaded browser binary are present —
// so the UI can truthfully enable/disable the deep toggle.
function isDeepAvailable() {
  if (process.env.SITEREADY_NO_DEEP === "1") return false; // test/ops override
  try {
    const pw = require("playwright");
    return fs.existsSync(pw.chromium.executablePath());
  } catch (_) {
    return false;
  }
}

// axe-core (optional, like Playwright) for REAL a11y measurement in the browser —
// primarily colour contrast, which is impossible statically. Lazy-read once; if the
// package isn't installed, deep still works (the axe checks are simply skipped).
let AXE_SOURCE;
function getAxeSource() {
  if (AXE_SOURCE !== undefined) return AXE_SOURCE;
  try { AXE_SOURCE = fs.readFileSync(require.resolve("axe-core"), "utf8"); }
  catch (_) { AXE_SOURCE = false; }
  return AXE_SOURCE;
}
function isAxeAvailable() { return getAxeSource() !== false; }

async function runAxe(page, status) {
  const src = getAxeSource();
  if (!src || status < 200 || status >= 300) return null;
  try {
    await page.addScriptTag({ content: src });
    return await page.evaluate(async () => {
      // color-contrast only: it's the deep-unique signal (static can't compute it),
      // and it avoids double-counting alt/lang rules the static checks already cover.
      const r = await window.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
      return {
        violations: (r.violations || []).map((v) => ({
          id: v.id,
          impact: v.impact || "",
          nodes: v.nodes.length,
          sample: (v.nodes[0] && v.nodes[0].target && String(v.nodes[0].target[0] || "")) || "",
        })),
      };
    });
  } catch (_) {
    return null; // axe failed on this page — skip, don't sink the render
  }
}

// Browser-side egress guard — the analogue of net-guard's lookup pin. Chromium does
// its own DNS, so we enforce the same policy at the request-interception layer:
// abort any request that resolves to a metadata IP (ALWAYS) or a private IP (unless
// allowPrivate). Applied to the navigation AND every sub-resource the page fetches.
function lookupAll(host, ms) {
  return Promise.race([
    dns.promises.lookup(host, { all: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("dns timeout")), ms)),
  ]);
}

// True = the host may be contacted. Mirrors net-guard: a literal IP is classified
// directly; a name is resolved with {all:true} and BLOCKED if ANY of its addresses
// is blocked (closes the multi-A-record gap).
async function hostAllowed(host, allowPrivate) {
  const bare = String(host).replace(/^\[/, "").replace(/\]$/, "");
  const fam = net.isIP(bare);
  if (fam) return !isAddressBlocked(bare, fam, allowPrivate);
  const addrs = await lookupAll(bare, 5000);
  return !addrs.some((a) => isAddressBlocked(a.address, a.family, allowPrivate));
}

async function installEgressGuard(context, allowPrivate, authOpts) {
  await context.route("**/*", async (route) => {
    let u;
    try { u = new URL(route.request().url()); } catch (_) { return route.continue(); }
    const proto = u.protocol;
    // Inline/internal schemes make no external connection — allow them (blocking would
    // break legit inline images/fonts/blank frames).
    if (proto === "data:" || proto === "blob:" || proto === "about:" || proto === "filesystem:") return route.continue();
    if (proto !== "http:" && proto !== "https:") return route.abort("blockedbyclient"); // file:/ftp:/…
    try {
      if (!(await hostAllowed(u.hostname, allowPrivate))) return route.abort("blockedbyclient");
      // Inject auth headers ONLY for the start origin — never leak them cross-origin.
      if (authOpts && authOpts.headers && u.origin === authOpts.origin) {
        return route.continue({ headers: { ...route.request().headers(), ...authOpts.headers } });
      }
      return route.continue();
    } catch (_) {
      return route.abort("failed");
    }
  });

  // WebSocket handshakes are NOT covered by context.route — guard them separately.
  if (typeof context.routeWebSocket === "function") {
    try {
      await context.routeWebSocket(/.*/, async (ws) => {
        let host;
        try { host = new URL(ws.url()).hostname; } catch (_) { return ws.close(); }
        try {
          if (await hostAllowed(host, allowPrivate)) return ws.connectToServer();
        } catch (_) { /* fall through to close */ }
        return ws.close();
      });
    } catch (_) { /* older Playwright without routeWebSocket — HTTP guard still applies */ }
  }
}

function ttfbFromTiming(timing) {
  if (!timing) return 0;
  const t = timing.responseStart - timing.requestStart;
  return t > 0 ? Math.round(t) : 0;
}

// Hops in {url, status} form to match the static fetcher's redirectChain (CONTRACT §3).
async function buildRedirectChain(request) {
  const chain = [];
  let r = request.redirectedFrom && request.redirectedFrom();
  while (r) {
    let status = 0;
    try { const resp = await r.response(); if (resp) status = resp.status(); } catch (_) { /* keep 0 */ }
    chain.unshift({ url: r.url(), status });
    r = r.redirectedFrom && r.redirectedFrom();
  }
  return chain;
}

// Render one URL → a page object shaped exactly like the static crawler's record,
// so checks run unchanged. Network failures yield a status-0 record (never throws).
async function renderOne(context, url, opts = {}) {
  const { timeout = 25000 } = opts;
  const page = await context.newPage();
  const consoleErrors = [];
  const pushErr = (e) => { if (consoleErrors.length < 50) consoleErrors.push(e); }; // cap: don't hoard on chatty pages
  page.on("console", (m) => { if (m.type() === "error") pushErr({ type: "console", text: m.text() }); });
  page.on("pageerror", (err) => pushErr({ type: "pageerror", text: String((err && err.message) || err) }));
  try {
    let response = null;
    try {
      response = await page.goto(url, { waitUntil: "networkidle", timeout });
    } catch (_) {
      // networkidle can stall on chatty/streaming pages — fall back to a lighter wait.
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout }).catch(() => null);
    }
    if (!response) {
      return { url, finalUrl: url, status: 0, error: "UNREACHABLE", redirectChain: [], ttfbMs: 0, bytes: 0, contentType: null, contentEncoding: null, page: null, consoleErrors };
    }
    const html = await page.content().catch(() => "");
    const headers = response.headers();
    const req = response.request();
    let timing = null;
    try { timing = req.timing(); } catch (_) { /* not always available */ }
    const status = response.status();
    const axe = await runAxe(page, status);
    return {
      url,
      finalUrl: page.url(),
      status,
      redirectChain: await buildRedirectChain(req),
      ttfbMs: ttfbFromTiming(timing),
      bytes: Buffer.byteLength(html || "", "utf8"),
      contentType: headers["content-type"] || "text/html",
      contentEncoding: headers["content-encoding"] || null,
      page: status >= 200 && status < 300 && html ? parseHtml(html) : null,
      consoleErrors,
      axe,
      error: null,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

// BFS over the start host using the browser. Sequential (one nav at a time) — the
// browser is heavy, so deep defaults to a smaller page budget than static.
function parseCookiePairs(cookieStr) {
  return String(cookieStr)
    .split(";")
    .map((p) => { const i = p.indexOf("="); return i < 0 ? null : [p.slice(0, i).trim(), p.slice(i + 1).trim()]; })
    .filter((x) => x && x[0]);
}
function lowerHeaders(headers) {
  const out = {};
  if (headers && typeof headers === "object") for (const [k, v] of Object.entries(headers)) if (k && v != null) out[String(k).toLowerCase()] = String(v);
  return out;
}

async function deepCrawl(startUrl, opts = {}) {
  const { maxPages = 10, allowPrivate = false, auth = null, onProgress = null, signal = null, timeout = 25000 } = opts;

  let start;
  try {
    start = new URL(startUrl);
  } catch (_) {
    throw Object.assign(new Error("Bad start URL"), { code: "BAD_URL" });
  }
  assertHostAllowed(start, allowPrivate); // literal-IP pre-check (metadata/private)

  // Name hosts: pre-resolve and apply the static egress policy up front, so a blocked
  // or unresolvable start URL fails fast with a clean code (matches the static path).
  const bareHost = start.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (!net.isIP(bareHost)) {
    let resolved;
    try {
      resolved = await dns.promises.lookup(bareHost);
    } catch (_) {
      throw Object.assign(new Error("DNS lookup failed"), { code: "DNS_FAIL" });
    }
    if (isAddressBlocked(resolved.address, resolved.family, allowPrivate)) {
      throw Object.assign(new Error("Адрес заблокирован egress-защитой"), {
        code: allowPrivate ? "SSRF_BLOCKED" : "PRIVATE_BLOCKED",
      });
    }
  }

  const pw = getPlaywright(); // throws DEEP_UNAVAILABLE if the package is missing
  let browser;
  try {
    browser = await pw.chromium.launch({ headless: true });
  } catch (_) {
    throw Object.assign(new Error("Не удалось запустить браузер для глубокого режима. Установите: npx playwright install chromium"), { code: "DEEP_UNAVAILABLE" });
  }
  try {
    const context = await browser.newContext({ userAgent: "SiteReadyBot/1.0 (+deep)", ...(opts.contextOptions || {}) });
    // Auth (same-origin only): cookies go into the browser jar (scoped to the host),
    // custom headers are injected by the guard for the start origin only.
    if (auth && auth.cookie) {
      const cookies = parseCookiePairs(auth.cookie).map(([name, value]) => ({ name, value, url: start.origin }));
      if (cookies.length) await context.addCookies(cookies).catch(() => {});
    }
    const authOpts = auth && auth.headers ? { origin: start.origin, headers: lowerHeaders(auth.headers) } : null;
    await installEgressGuard(context, allowPrivate, authOpts);

    const baseHost = hostKey(start.hostname);
    const startHost = start.hostname.toLowerCase();
    const startHref = canonicalize(start);
    const queue = [startHref];
    const seen = new Set(queue);
    const results = [];
    const crawledFinal = new Set();
    let discovered = 1;

    while (queue.length && results.length < maxPages) {
      if (signal && signal()) break;
      const url = queue.shift();
      if (onProgress) onProgress({ crawled: results.length, discovered, current: url });
      let rec = isDocLink(url)
        ? await probeStatic(url, { allowPrivate, timeout })
        : await renderOne(context, url, { timeout });
      // A non-doc URL that came back status 0 was likely a browser DOWNLOAD (a binary
      // served without a doc extension) — reprobe statically for the real status.
      if (!isDocLink(url) && rec.status === 0) {
        const alt = await probeStatic(url, { allowPrivate, timeout });
        if (alt.status > 0) rec = alt;
      }
      // Dedup by resolved final URL so redirect aliases aren't rendered/recorded twice.
      let finalKey = url;
      try { finalKey = canonicalize(new URL(rec.finalUrl)); } catch (_) { /* keep url */ }
      if (crawledFinal.has(finalKey)) continue;
      crawledFinal.add(finalKey);
      if (finalKey !== url) seen.add(finalKey);
      results.push(rec);

      if (rec.page) {
        const baseUrl = rec.finalUrl;
        for (const a of rec.page.anchors) {
          let norm = normalizeLink(a.href, baseUrl);
          if (!norm) continue;
          let lu;
          try { lu = new URL(norm); } catch (_) { continue; }
          if (hostKey(lu.hostname) !== baseHost) continue;
          if (lu.hostname.toLowerCase() !== startHost) { lu.hostname = startHost; norm = canonicalize(lu); }
          if (seen.has(norm)) continue;
          seen.add(norm);
          discovered += 1;
          if (results.length + queue.length < maxPages) queue.push(norm);
        }
      }
    }

    if (onProgress) onProgress({ crawled: results.length, discovered, current: null, phase: "done" });
    return {
      startUrl: startHref,
      host: baseHost,
      pagesCrawled: results.length,
      pagesDiscovered: discovered,
      sampled: results.length < discovered,
      pages: results,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { isDeepAvailable, isAxeAvailable, getPlaywright, deepCrawl, renderOne, installEgressGuard, hostAllowed, ttfbFromTiming, buildRedirectChain, isDocLink, probeStatic, DEEP_MAX_PAGES };

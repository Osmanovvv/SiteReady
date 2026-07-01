"use strict";

// BFS crawler (PLAN §5.2): same host (+ www variant) only, link normalization,
// page limit, bounded concurrency, per-host throttle + jitter, progress callback.

const { URL } = require("url");
const { fetch, decodeBody } = require("./fetcher");
const { parseHtml } = require("./html");

function hostKey(hostname) {
  return String(hostname).replace(/^www\./i, "").toLowerCase();
}

// Canonical identity for dedup: drop hash, lower-case host, collapse default
// index files and trailing slashes so '/', '/index.html', '/about/' don't double-crawl.
function canonicalize(u) {
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  let p = u.pathname || "/";
  p = p.replace(/\/(index|default)\.(html?|aspx?|php)$/i, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "") || "/";
  u.pathname = p;
  return u.href;
}

function normalizeLink(href, baseUrl) {
  if (!href) return null;
  const t = href.trim();
  if (!t || t.startsWith("#")) return null;
  if (/^(mailto:|tel:|javascript:|data:|blob:)/i.test(t)) return null;
  let u;
  try { u = new URL(t, baseUrl); } catch (_) { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return canonicalize(u);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function looksHtml(res) {
  const ct = res.contentType || "";
  if (/text\/html|application\/xhtml/i.test(ct)) return true;
  if (res.body && /^\s*<(!doctype|html|head|body)/i.test(res.body.subarray(0, 256).toString("latin1"))) return true;
  return false;
}

async function crawl(startUrl, opts = {}) {
  const {
    maxPages = 50,
    concurrency = 5,
    throttleMs = 150,
    timeout = 15000,
    allowPrivate = false,
    auth = null, // { cookie, headers } — sent to the start host only (same-origin)
    onProgress = null,
    signal = null, // () => boolean — when true, stop crawling (client disconnected)
    // Soft aggregate byte budget. It's checked after each fetch, so under
    // concurrency>1 the crawl can overshoot by up to ~concurrency × per-page cap
    // before in-flight fetches settle — it bounds runaway crawls, not exact memory.
    maxTotalBytes = 50 * 1024 * 1024,
  } = opts;

  let start;
  try { start = new URL(startUrl); } catch (_) {
    throw Object.assign(new Error("Bad start URL"), { code: "BAD_URL" });
  }
  const baseHost = hostKey(start.hostname);
  const startHost = start.hostname.toLowerCase();
  const startHref = canonicalize(start);

  const queue = [startHref];
  const seen = new Set(queue);
  const crawledFinal = new Set();
  const results = [];
  let discovered = 1;
  let active = 0;
  let lastHit = 0;
  let totalBytes = 0;
  let budgetExceeded = false; // tripped when the aggregate byte budget is spent

  function emit(current) {
    if (onProgress) onProgress({ crawled: results.length, discovered, current });
  }

  async function processOne(url) {
    if ((signal && signal()) || budgetExceeded) return;
    // Serialize requests to one host with a throttle + jitter (be polite).
    const now = Date.now();
    const wait = Math.max(0, lastHit + throttleMs + Math.floor(Math.random() * 80) - now);
    lastHit = now + wait;
    if (wait) await delay(wait);

    emit(url);

    let res;
    try {
      // Pin auth to the immutable start origin (scheme+host+port). A discovered
      // same-host link that downgrades to http:// then gets NO credentials.
      res = await fetch(url, { allowPrivate, timeout, auth, authOrigin: start.origin });
    } catch (e) {
      if (results.length < maxPages) {
        results.push({ url, finalUrl: url, status: 0, error: e.code || "UNREACHABLE", redirectChain: [], page: null });
      }
      return;
    }

    // Collapse redirect aliases: if the resolved final URL was already crawled, drop this dup.
    let finalKey = url;
    try { finalKey = canonicalize(new URL(res.finalUrl)); } catch (_) { /* keep url */ }
    if (crawledFinal.has(finalKey)) return;
    crawledFinal.add(finalKey);
    if (finalKey !== url) seen.add(finalKey);

    // Account this page against the aggregate budget; the page that trips it is
    // still recorded, but no further pages are fetched (clean partial report).
    totalBytes += res.bytes || 0;
    if (totalBytes >= maxTotalBytes) budgetExceeded = true;

    let page = null;
    if (res.status >= 200 && res.status < 300 && res.body && looksHtml(res)) {
      const html = decodeBody(res.body, res.contentType);
      page = parseHtml(html);

      const baseUrl = page.base ? (() => { try { return new URL(page.base, res.finalUrl).href; } catch (_) { return res.finalUrl; } })() : res.finalUrl;
      for (const a of page.anchors) {
        let norm = normalizeLink(a.href, baseUrl);
        if (!norm) continue;
        let lu;
        try { lu = new URL(norm); } catch (_) { continue; }
        if (hostKey(lu.hostname) !== baseHost) continue;
        // Pin same-host links to the start host's exact hostname so www/apex
        // variants collapse to one identity (and one fetch), without rewriting
        // the host we actually request for www-only sites.
        if (lu.hostname.toLowerCase() !== startHost) { lu.hostname = startHost; norm = canonicalize(lu); }
        if (seen.has(norm)) continue;
        seen.add(norm);
        discovered += 1;
        if (results.length + queue.length < maxPages) queue.push(norm);
      }
    }

    if (results.length >= maxPages) return; // hard cap on reported pages
    results.push({
      url: finalKey,
      finalUrl: res.finalUrl,
      status: res.status,
      redirectChain: res.redirectChain,
      ttfbMs: res.ttfbMs,
      bytes: res.bytes,
      contentType: res.contentType,
      page,
      error: null,
    });
  }

  async function worker() {
    while (results.length < maxPages && !budgetExceeded) {
      if (signal && signal()) return;
      const url = queue.shift();
      if (url === undefined) {
        if (active === 0) return; // queue empty and no in-flight worker can still enqueue
        await delay(5);
        continue;
      }
      active += 1;
      try { await processOne(url); } finally { active -= 1; }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i += 1) workers.push(worker());
  await Promise.all(workers);

  if (onProgress) onProgress({ crawled: results.length, discovered, current: null, phase: "done" });

  return {
    startUrl: startHref,
    host: baseHost,
    pagesCrawled: results.length,
    pagesDiscovered: discovered,
    sampled: results.length < discovered,
    pages: results,
  };
}

module.exports = { crawl, normalizeLink, hostKey, canonicalize };

"use strict";

// HTTP(S) fetcher (PLAN §5.1). Realistic UA; manual redirect following with a
// recorded chain + hop limit + loop detection; TTFB/total timing; a HARD total
// time deadline (not just idle); gzip/deflate(raw+zlib)/br decompression with an
// inflated-size cap (anti gzip-bomb) that yields a partial body on a corrupt
// trailer instead of dropping the page; raw Buffer body; egress guard per hop.

const http = require("http");
const https = require("https");
const zlib = require("zlib");
const { URL } = require("url");
const { makeLookup, assertHostAllowed } = require("./net-guard");

const UA = "Mozilla/5.0 (compatible; SiteReadyBot/1.0; +https://siteready.local/bot)";
const DEFAULTS = { timeout: 15000, maxHops: 5, maxBytes: 8 * 1024 * 1024 };
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function elapsedMs(startBig) {
  return Number(process.hrtime.bigint() - startBig) / 1e6;
}

function makeError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Read the raw response, capped at maxBytes. Resolves partial+truncated on cap or
// on a recoverable stream error once any bytes arrived.
function readRaw(res, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let truncated = false;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve({ buf: Buffer.concat(chunks), truncated });
    };
    res.on("data", (c) => {
      if (size >= maxBytes) return;
      if (size + c.length > maxBytes) {
        chunks.push(c.subarray(0, maxBytes - size));
        size = maxBytes;
        truncated = true;
        try { res.destroy(); } catch (_) { /* noop */ }
        done();
        return;
      }
      size += c.length;
      chunks.push(c);
    });
    res.on("end", done);
    res.on("close", done);
    res.on("error", (e) => {
      if (size > 0 || truncated || settled) done(); // keep partial bytes
      else reject(e);
    });
  });
}

// Decompress a buffer through a streaming decoder with an output cap. Resolves a
// partial body (lossy=true) on decode error after any output — mirrors browsers.
function decodeWith(makeStream, buf, maxBytes) {
  return new Promise((resolve) => {
    const ds = makeStream();
    const chunks = [];
    let size = 0;
    let got = false;
    let lossy = false;
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      resolve({ body: Buffer.concat(chunks), lossy, erroredEarly: !got });
    };
    ds.on("data", (c) => {
      got = true;
      if (size + c.length > maxBytes) {
        chunks.push(c.subarray(0, maxBytes - size));
        size = maxBytes;
        lossy = true;
        try { ds.destroy(); } catch (_) { /* noop */ }
        fin();
        return;
      }
      size += c.length;
      chunks.push(c);
    });
    ds.on("end", fin);
    ds.on("close", fin);
    ds.on("error", () => { lossy = true; fin(); });
    ds.end(buf);
  });
}

async function decodeBodyBuffer(buf, encoding, maxBytes) {
  const enc = (encoding || "").toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return decodeWith(() => zlib.createGunzip(), buf, maxBytes);
  if (enc === "br") return decodeWith(() => zlib.createBrotliDecompress(), buf, maxBytes);
  if (enc === "deflate") {
    const r = await decodeWith(() => zlib.createInflate(), buf, maxBytes);
    // RAW deflate (RFC1951, no zlib header) errors immediately — retry without the header.
    if (r.erroredEarly) return decodeWith(() => zlib.createInflateRaw(), buf, maxBytes);
    return r;
  }
  return { body: buf, lossy: false };
}

async function readBodyCapped(res, encoding, maxBytes) {
  const raw = await readRaw(res, maxBytes);
  const dec = await decodeBodyBuffer(raw.buf, encoding, maxBytes);
  return { body: dec.body, truncated: raw.truncated || dec.lossy };
}

// Build the auth headers (custom headers + Cookie) from an { cookie, headers } object.
function buildAuthHeaders(auth) {
  if (!auth || typeof auth !== "object") return null;
  const h = {};
  if (auth.headers && typeof auth.headers === "object") {
    for (const [k, v] of Object.entries(auth.headers)) if (k && v != null) h[k] = String(v);
  }
  if (auth.cookie) h.Cookie = String(auth.cookie);
  return Object.keys(h).length ? h : null;
}

function rawRequest(urlObj, { method, timeout, allowPrivate, extraHeaders }) {
  return new Promise((resolve, reject) => {
    assertHostAllowed(urlObj, allowPrivate);
    const mod = urlObj.protocol === "https:" ? https : http;
    const ac = new AbortController();
    // Abort at the caller's REMAINING time budget (independent of socket activity),
    // so a slow-drip server cannot hold the socket past the shared total deadline.
    const hard = setTimeout(() => ac.abort(), timeout);
    const startBig = process.hrtime.bigint();
    const req = mod.request(
      urlObj,
      {
        method,
        signal: ac.signal,
        lookup: makeLookup(allowPrivate),
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "ru,en;q=0.8",
          ...(extraHeaders || {}),
        },
      },
      (res) => resolve({ res, ttfbMs: elapsedMs(startBig), ac, hard })
    );
    req.on("error", (e) => {
      clearTimeout(hard);
      if (e.code === "ABORT_ERR" || ac.signal.aborted) { e.code = "TIMEOUT"; e.message = "Request exceeded time budget"; }
      else if (e.code === "ENOTFOUND") e.code = "DNS_FAIL";
      else if (e.code === "ECONNREFUSED") e.code = "UNREACHABLE";
      reject(e);
    });
    req.end();
  });
}

async function fetch(rawUrl, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const method = (o.method || "GET").toUpperCase();
  const allowPrivate = !!o.allowPrivate;

  let urlObj;
  try { urlObj = new URL(rawUrl); } catch (_) { throw makeError(`Invalid URL: ${rawUrl}`, "BAD_URL"); }

  const chain = [];
  const visited = new Set();
  let hops = 0;
  const totalStart = process.hrtime.bigint();
  // HARD total-time budget shared across ALL redirect hops (not reset per hop),
  // so a slow redirect chain cannot multiply the caller's timeout.
  const deadline = Date.now() + o.timeout;

  // Auth (cookie/headers) is sent ONLY to the START origin it was issued for — pinned
  // by the caller (o.authOrigin), NOT recomputed per request. Origin includes the
  // SCHEME, so a same-host link that downgrades https→http (or any cross-origin
  // redirect) fails the check and the credentials are dropped — never leaked.
  const authHeaders = buildAuthHeaders(o.auth);
  const authOrigin = o.authOrigin || urlObj.origin;

  while (true) {
    if (visited.has(urlObj.href)) throw makeError(`Redirect loop at ${urlObj.href}`, "REDIRECT_LOOP");
    visited.add(urlObj.href);

    const extraHeaders = urlObj.origin === authOrigin ? authHeaders : null;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw makeError("Request exceeded time budget", "TIMEOUT");
    const { res, ttfbMs, ac, hard } = await rawRequest(urlObj, { method, timeout: remaining, allowPrivate, extraHeaders });
    const status = res.statusCode;
    const headers = res.headers;

    if (REDIRECT_STATUSES.has(status) && headers.location) {
      res.resume();
      clearTimeout(hard);
      if (hops >= o.maxHops) throw makeError(`Too many redirects (>${o.maxHops})`, "REDIRECT_LOOP");
      chain.push({ url: urlObj.href, status });
      let next;
      try { next = new URL(headers.location, urlObj); } catch (_) { throw makeError("Bad redirect target", "BAD_URL"); }
      urlObj = next;
      hops += 1;
      continue;
    }

    let body = null;
    let truncated = false;
    if (method === "GET") {
      try {
        const r = await readBodyCapped(res, headers["content-encoding"], o.maxBytes);
        body = r.body;
        truncated = r.truncated;
      } catch (e) {
        clearTimeout(hard);
        if (ac.signal.aborted) throw makeError("Request exceeded time budget", "TIMEOUT");
        throw e;
      }
    } else {
      res.resume();
    }
    clearTimeout(hard);

    return {
      requestedUrl: rawUrl,
      finalUrl: urlObj.href,
      status,
      redirectChain: chain,
      headers,
      contentType: headers["content-type"] || null,
      contentEncoding: headers["content-encoding"] || null,
      ttfbMs,
      totalMs: elapsedMs(totalStart),
      body,
      bytes: body ? body.length : Number(headers["content-length"] || 0),
      truncated,
    };
  }
}

// Charset detection: Content-Type → <meta charset> / http-equiv (sniff ~2KB) → utf-8.
function detectCharset(buffer, contentType) {
  let cs = null;
  if (contentType) {
    const m = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType);
    if (m) cs = m[1].toLowerCase();
  }
  if (!cs && buffer && buffer.length) {
    const head = buffer.subarray(0, 2048).toString("latin1");
    let m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
    if (!m) m = /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w-]+)/i.exec(head);
    if (m) cs = m[1].toLowerCase();
  }
  return cs || "utf-8";
}

function decodeBody(buffer, contentType) {
  if (!buffer || !buffer.length) return "";
  const cs = detectCharset(buffer, contentType);
  try {
    return new TextDecoder(cs).decode(buffer);
  } catch (_) {
    try { return new TextDecoder("utf-8").decode(buffer); } catch (_2) { return buffer.toString("utf8"); }
  }
}

module.exports = { fetch, decodeBody, detectCharset, UA };

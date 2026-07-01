"use strict";

// Stage-2 engine tests (PLAN §10). Hermetic: everything runs against a local
// fixture server on 127.0.0.1, no outbound network. Gate: crawl yields pages +
// parsed data, and net/fetcher/parser behave correctly.

const assert = require("node:assert");
const { createServer } = require("./serve-fixtures");
const { fetch, decodeBody } = require("../src/fetcher");
const { parseHtml } = require("../src/html");
const { crawl } = require("../src/crawler");
const { isAddressBlocked, assertHostAllowed } = require("../src/net-guard");
const { audit } = require("../src/audit");
const { URL } = require("node:url");
const { gradeFromScore } = require("../src/score");
const http = require("node:http");
const { createServer: createEngineServer } = require("../server");

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log("  ✓ " + name);
    pass += 1;
  } catch (e) {
    console.log("  ✗ " + name + "\n      " + (e && e.message));
    fail += 1;
  }
}

async function main() {
  const server = createServer();
  // Dual-stack so "localhost" (used as an external host in the external-link test) resolves to it too.
  await new Promise((r) => server.listen(0, "::", r));
  const port = server.address().port;
  const base = "http://127.0.0.1:" + port;
  const AP = { allowPrivate: true };

  console.log("net-guard (egress / SSRF):");
  await test("blocks 127.0.0.1 without allowPrivate", () => assert.strictEqual(isAddressBlocked("127.0.0.1", 4, false), true));
  await test("allows 127.0.0.1 with allowPrivate", () => assert.strictEqual(isAddressBlocked("127.0.0.1", 4, true), false));
  await test("blocks metadata 169.254.169.254 even with allowPrivate", () => assert.strictEqual(isAddressBlocked("169.254.169.254", 4, true), true));
  await test("blocks RFC1918 (10/8, 172.16/12, 192.168/16)", () => {
    assert.strictEqual(isAddressBlocked("10.1.2.3", 4, false), true);
    assert.strictEqual(isAddressBlocked("172.16.5.5", 4, false), true);
    assert.strictEqual(isAddressBlocked("192.168.0.1", 4, false), true);
  });
  await test("blocks IPv6 ::1 and ULA/link-local", () => {
    assert.strictEqual(isAddressBlocked("::1", 6, false), true);
    assert.strictEqual(isAddressBlocked("fd12::1", 6, false), true);
    assert.strictEqual(isAddressBlocked("fe80::1", 6, false), true);
  });
  await test("allows a public address", () => assert.strictEqual(isAddressBlocked("8.8.8.8", 4, false), false));

  console.log("fetcher:");
  await test("fetches index 200 with body + timing", async () => {
    const r = await fetch(base + "/", AP);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body && r.body.length > 0);
    assert.ok(r.ttfbMs >= 0 && r.totalMs >= 0);
  });
  await test("rejects loopback without allowPrivate (SSRF_BLOCKED)", async () => {
    await assert.rejects(() => fetch(base + "/", {}), (e) => e.code === "SSRF_BLOCKED");
  });
  await test("decompresses gzip", async () => {
    const r = await fetch(base + "/gzip", AP);
    assert.ok(decodeBody(r.body, r.contentType).includes("Сжатая страница"));
  });
  await test("follows redirect chain and records it", async () => {
    const r = await fetch(base + "/redirect-chain", AP);
    assert.ok(r.finalUrl.endsWith("/index.html"));
    assert.strictEqual(r.redirectChain.length, 2);
  });
  await test("breaks redirect loop gracefully", async () => {
    await assert.rejects(() => fetch(base + "/redirect-loop", AP), (e) => e.code === "REDIRECT_LOOP");
  });
  await test("times out on a slow endpoint", async () => {
    await assert.rejects(() => fetch(base + "/slow", { allowPrivate: true, timeout: 300 }), (e) => e.code === "TIMEOUT");
  });
  await test("blocks SSRF redirect to metadata IP even with allowPrivate", async () => {
    await assert.rejects(() => fetch(base + "/private-redirect", AP), (e) => e.code === "SSRF_BLOCKED");
  });
  await test("decodes windows-1251 without mojibake", async () => {
    const r = await fetch(base + "/cp1251", AP);
    assert.ok(decodeBody(r.body, r.contentType).includes("Привет"));
  });

  console.log("html parser:");
  const idx = await fetch(base + "/index.html", AP);
  const page = parseHtml(decodeBody(idx.body, idx.contentType));
  await test("extracts the title", () => assert.strictEqual(page.title, "Тестовая страница SiteReady"));
  await test("reads html lang", () => assert.strictEqual(page.lang, "ru"));
  await test("finds exactly one h1", () => assert.strictEqual(page.headings.filter((h) => h.level === 1).length, 1));
  await test("collects anchors", () => assert.ok(page.anchors.length >= 5));
  await test("detects an image missing alt", () => assert.ok(page.images.filter((im) => !im.hasAlt).length >= 1));
  await test("parses valid JSON-LD", () => assert.ok(page.jsonLd.length >= 1 && page.jsonLd[0].ok === true));
  await test("flags a duplicate id", () => assert.ok(Object.values(page.idCounts).some((c) => c > 1)));
  await test("reads viewport meta", () => assert.ok(page.viewport && /width=device-width/.test(page.viewport)));
  await test("does not turn script '<' into tags (anchor count stays 5)", () => assert.strictEqual(page.anchors.length, 5));

  console.log("parser robustness:");
  await test("broken HTML does not throw and still yields a heading", async () => {
    const rb = await fetch(base + "/broken.html", AP);
    const pb = parseHtml(decodeBody(rb.body, rb.contentType));
    assert.ok(pb.headings.length >= 1);
  });

  console.log("crawler:");
  const c = await crawl(base + "/", { allowPrivate: true, maxPages: 10 });
  await test("crawls more than one page", () => assert.ok(c.pagesCrawled >= 2));
  await test("stays on the same host", () => assert.ok(c.pages.every((p) => {
    try { return new URL(p.url).hostname === "127.0.0.1"; } catch (_) { return false; }
  })));
  await test("captures the broken internal link as a 404 result", () => assert.ok(c.pages.some((p) => p.status === 404)));
  await test("does not follow the external link", () => assert.ok(!c.pages.some((p) => /example\.com/.test(p.url))));
  await test("respects maxPages", () => assert.ok(c.pagesCrawled <= 10));
  await test("returns parsed page data for HTML pages", () => assert.ok(c.pages.some((p) => p.page && p.page.title)));

  console.log("audit + scoring (CONTRACT report):");
  const report = await audit(base + "/", { allowPrivate: true, maxPages: 10 });
  const VALID_CAT = ["seo", "tech", "performance", "accessibility", "responsive"];
  const VALID_SEV = ["critical", "warning", "info"];
  const VALID_GRADE = ["A", "B", "C", "D", "F"];

  await test("report.meta is well-formed", () => {
    const m = report.meta;
    assert.ok(typeof m.startUrl === "string" && typeof m.finalUrl === "string");
    assert.ok(typeof m.generatedAt === "string" && !Number.isNaN(Date.parse(m.generatedAt)));
    assert.ok(typeof m.pagesCrawled === "number" && typeof m.pagesDiscovered === "number");
    assert.strictEqual(typeof m.sampled, "boolean");
    assert.strictEqual(typeof m.flags.spa, "boolean");
  });
  await test("score: overall in 0..100, grade valid, 5 categories", () => {
    assert.ok(report.score.overall >= 0 && report.score.overall <= 100);
    assert.ok(VALID_GRADE.includes(report.score.grade));
    assert.strictEqual(report.score.categories.length, 5);
    const keys = report.score.categories.map((c) => c.key);
    for (const k of VALID_CAT) assert.ok(keys.includes(k), "missing category " + k);
  });
  await test("category weights sum to 1.0", () => {
    const sum = report.score.categories.reduce((s, c) => s + c.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });
  await test("every category has all CONTRACT fields", () => {
    for (const c of report.score.categories) {
      assert.ok(typeof c.label === "string" && typeof c.score === "number" && typeof c.weight === "number");
      assert.ok(VALID_GRADE.includes(c.grade));
      assert.ok(["full", "static", "estimated"].includes(c.confidence));
      assert.strictEqual(typeof c.confidenceNote, "string");
      for (const s of VALID_SEV) assert.strictEqual(typeof c.issueCounts[s], "number");
    }
  });
  await test("every issue has the CONTRACT fields", () => {
    for (const i of report.issues) {
      assert.ok(typeof i.id === "string" && i.id);
      assert.ok(VALID_CAT.includes(i.category), "bad category " + i.category);
      assert.ok(VALID_SEV.includes(i.severity));
      assert.ok(typeof i.title === "string" && typeof i.detail === "string" && typeof i.fix === "string");
      assert.ok(["prevalence", "count"].includes(i.mode));
      assert.strictEqual(typeof i.scored, "boolean");
      assert.strictEqual(typeof i.penalty, "number");
      assert.ok(typeof i.affectedCount === "number" && Array.isArray(i.affectedPages) && Array.isArray(i.sample));
      assert.ok(i.affectedPages.length <= 20);
    }
  });
  await test("issueCounts reconcile with issues[] (no drift)", () => {
    const derived = {};
    for (const k of VALID_CAT) derived[k] = { critical: 0, warning: 0, info: 0 };
    for (const i of report.issues) derived[i.category][i.severity] += 1;
    for (const c of report.score.categories) {
      for (const s of VALID_SEV) assert.strictEqual(c.issueCounts[s], derived[c.key][s], `${c.key}.${s}`);
    }
  });
  await test("prevalence affectedCount never exceeds pagesCrawled", () => {
    for (const i of report.issues) {
      if (i.mode === "prevalence") assert.ok(i.affectedCount <= report.meta.pagesCrawled, i.id);
    }
  });
  await test("pages[] are well-formed", () => {
    for (const p of report.pages) {
      assert.ok(typeof p.url === "string" && typeof p.status === "number" && typeof p.score === "number");
      for (const s of VALID_SEV) assert.strictEqual(typeof p.issueCounts[s], "number");
      assert.ok(typeof p.ttfbMs === "number" && typeof p.bytes === "number" && Array.isArray(p.redirectChain));
    }
  });
  await test("detects missing-alt, duplicate-id, broken internal link on fixtures", () => {
    const ids = new Set(report.issues.map((i) => i.id));
    assert.ok(ids.has("a11y.img-alt.missing"), "missing alt");
    assert.ok(ids.has("a11y.duplicate-id"), "duplicate id");
    assert.ok(ids.has("tech.broken-link.internal"), "broken internal link");
  });
  await test("broken-link finding points at SOURCE page, with target in sample", () => {
    const f = report.issues.find((i) => i.id === "tech.broken-link.internal");
    assert.ok(f.affectedPages.includes("/") || f.affectedPages.includes("/index.html"));
    assert.ok(f.sample.some((s) => /missing-page/.test(s)));
  });
  await test("TTFB finding (if present) is info-only, scored:false", () => {
    const t = report.issues.find((i) => i.id === "perf.ttfb");
    if (t) assert.strictEqual(t.scored, false);
  });

  console.log("calibration (§6 / §10):");
  await test("grade bands map exactly at the A/B/C/D/F thresholds", () => {
    assert.strictEqual(gradeFromScore(90), "A");
    assert.strictEqual(gradeFromScore(89), "B");
    assert.strictEqual(gradeFromScore(75), "B");
    assert.strictEqual(gradeFromScore(74), "C"); // boundary: just under B → C
    assert.strictEqual(gradeFromScore(60), "C");
    assert.strictEqual(gradeFromScore(59), "D");
    assert.strictEqual(gradeFromScore(40), "D");
    assert.strictEqual(gradeFromScore(39), "F");
  });

  const cleanRep = await audit(base + "/clean.html", { allowPrivate: true, maxPages: 5 });
  const badRep = await audit(base + "/bad.html", { allowPrivate: true, maxPages: 5 });

  await test("clean reference page scores A/B", () => {
    assert.ok(["A", "B"].includes(cleanRep.score.grade), `clean grade=${cleanRep.score.grade} (${cleanRep.score.overall})`);
  });
  await test("obviously-bad page scores D/F", () => {
    assert.ok(["D", "F"].includes(badRep.score.grade), `bad grade=${badRep.score.grade} (${badRep.score.overall})`);
  });
  await test("bad page scores well below clean page", () => {
    assert.ok(badRep.score.overall + 20 <= cleanRep.score.overall, `bad ${badRep.score.overall} vs clean ${cleanRep.score.overall}`);
  });
  await test("clean page produces no content-level false positives", () => {
    const ids = new Set(cleanRep.issues.map((i) => i.id));
    for (const id of ["seo.title.missing", "seo.h1.missing", "seo.meta-description.missing", "seo.og.missing", "a11y.img-alt.missing", "a11y.duplicate-id", "a11y.html-lang.missing", "responsive.viewport.missing", "tech.broken-anchor", "tech.noopener.missing"]) {
      assert.ok(!ids.has(id), "false positive on clean page: " + id);
    }
  });
  await test("bad page detects all planted defects", () => {
    const ids = new Set(badRep.issues.map((i) => i.id));
    for (const id of ["seo.title.missing", "seo.h1.missing", "a11y.img-alt.missing", "a11y.duplicate-id", "responsive.viewport.missing", "tech.broken-anchor", "tech.noopener.missing"]) {
      assert.ok(ids.has(id), "missed defect: " + id);
    }
  });
  await test("no-HTTPS is a full-cap critical (prevalence over all pages)", () => {
    const f = cleanRep.issues.find((i) => i.id === "tech.https.missing");
    assert.ok(f && f.mode === "prevalence" && f.penalty >= 29.9, "https penalty=" + (f && f.penalty));
  });

  console.log("SPA handling:");
  const spaRep = await audit(base + "/spa.html", { allowPrivate: true, maxPages: 3 });
  await test("SPA page is flagged", () => assert.strictEqual(spaRep.meta.flags.spa, true));
  await test("content critical on SPA is reclassified to warning", () => {
    const h1 = spaRep.issues.find((i) => i.id === "seo.h1.missing");
    if (h1) assert.strictEqual(h1.severity, "warning");
  });

  console.log("robustness (decompression cap):");
  await test("oversized body is truncated at maxBytes", async () => {
    const r = await fetch(base + "/big", { allowPrivate: true, maxBytes: 1000 });
    assert.strictEqual(r.truncated, true);
    assert.ok(r.body.length <= 1000);
  });

  console.log("SSRF IPv6 (root-cause fixes):");
  await test("blocks IPv6 literals incl. metadata, mapped & NAT64 forms", () => {
    for (const ip of ["::1", "fe80::1", "fc00::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1"]) {
      assert.strictEqual(isAddressBlocked(ip, 6, false), true, ip);
    }
    // cloud metadata is blocked ALWAYS, even under allowPrivate
    assert.strictEqual(isAddressBlocked("fd00:ec2::254", 6, true), true);
    assert.strictEqual(isAddressBlocked("::ffff:a9fe:a9fe", 6, true), true);
  });
  await test("allows a public IPv6", () => assert.strictEqual(isAddressBlocked("2606:4700:4700::1111", 6, false), false));
  await test("assertHostAllowed rejects bracketed IPv6 literal hosts", () => {
    for (const u of ["http://[::1]/", "http://[fd00:ec2::254]/", "http://[::ffff:127.0.0.1]/", "http://[fe80::1]/"]) {
      assert.throws(() => assertHostAllowed(new URL(u), false), (e) => e.code === "SSRF_BLOCKED", u);
    }
  });

  console.log("decompression (deflate / raw-deflate / brotli):");
  await test("zlib-wrapped deflate decodes", async () => { const r = await fetch(base + "/deflate", AP); assert.ok(decodeBody(r.body, r.contentType).includes("Zlib deflate работает")); });
  await test("RAW deflate decodes via inflateRaw fallback", async () => { const r = await fetch(base + "/raw-deflate", AP); assert.ok(decodeBody(r.body, r.contentType).includes("Raw deflate работает")); });
  await test("brotli decodes", async () => { const r = await fetch(base + "/brotli", AP); assert.ok(decodeBody(r.body, r.contentType).includes("Brotli работает")); });
  await test("slow-drip body is bounded by the total deadline (no socket hang)", async () => {
    const t0 = Date.now();
    await fetch(base + "/drip", { allowPrivate: true, timeout: 400 }).catch(() => {});
    assert.ok(Date.now() - t0 < 2500, "drip fetch was not bounded by the deadline");
  });

  console.log("reachability gate (dead site ≠ A):");
  await test("all-error (500) site scores F", async () => { const r = await audit(base + "/dead", { allowPrivate: true, maxPages: 5 }); assert.strictEqual(r.score.grade, "F"); });
  await test("unreachable start URL rejects with a coded error (not an F report)", async () => {
    await assert.rejects(
      audit("http://127.0.0.1:1/", { allowPrivate: true, maxPages: 3 }),
      (e) => ["UNREACHABLE", "DNS_FAIL", "TIMEOUT"].includes(e.code)
    );
  });
  await test("dead/4xx page rows are never scored 100", async () => { const r = await audit(base + "/dead", { allowPrivate: true, maxPages: 5 }); assert.ok(r.pages.every((p) => p.score === 0)); });
  await test("soft-404: a linked 404 that serves a full HTML body is flagged", async () => {
    const r = await audit(base + "/soft-host", { allowPrivate: true, maxPages: 5 });
    const f = r.issues.find((i) => i.id === "tech.soft-error-status");
    assert.ok(f, "no soft-error finding");
    assert.ok(f.affectedCount >= 1 && f.sample.some((s) => /\/soft404 → 404/.test(s)));
  });

  console.log("parser robustness (root-cause fixes):");
  await test("unclosed <h1> yields its text and non-zero textLength", () => {
    const pg = parseHtml("<html lang=ru><body><h1>Welcome<p>Body text long enough to count.</p></body></html>");
    assert.ok(pg.headings.some((h) => h.level === 1 && /Welcome/.test(h.text)));
    assert.ok(pg.textLength > 0);
  });
  await test("abrupt comment <!--> does not swallow the document", () => {
    const pg = parseHtml("<!--><h1>Visible Heading</h1><p>real body</p>");
    assert.ok(pg.headings.some((h) => h.level === 1 && /Visible/.test(h.text)));
  });
  await test("title strips inner markup and decodes entities", () => {
    assert.strictEqual(parseHtml("<title>Buy <b>Now</b> &amp; Save</title>").title, "Buy Now & Save");
  });
  await test("heading text decodes entities", () => {
    assert.strictEqual(parseHtml("<h1>Tom &amp; Jerry</h1>").headings[0].text, "Tom & Jerry");
  });

  console.log("crawler (canonicalization + hard cap):");
  await test("'/' and '/index.html' are one page (no double-crawl)", async () => {
    const c = await crawl(base + "/", { allowPrivate: true, maxPages: 20 });
    const homes = c.pages.filter((p) => { try { return new URL(p.url).pathname === "/"; } catch (_) { return false; } });
    assert.strictEqual(homes.length, 1);
  });
  await test("hard maxPages cap is never exceeded on a wide hub", async () => {
    for (let rep = 0; rep < 3; rep += 1) {
      const c = await crawl(base + "/hub", { allowPrivate: true, maxPages: 10, concurrency: 5 });
      assert.ok(c.pagesCrawled <= 10, "crawled " + c.pagesCrawled);
      assert.ok(c.pagesDiscovered > 10 && c.sampled === true);
    }
  });
  await test("aggregate byte budget accumulates across pages, records the tripping page, then stops", async () => {
    // Budget large enough to admit several /n pages before tripping (hub ~1.3 KB,
    // each node ~0.13 KB). concurrency=1 → deterministic stop, no overshoot.
    const c = await crawl(base + "/hub", { allowPrivate: true, maxPages: 50, concurrency: 1, maxTotalBytes: 2500 });
    assert.ok(c.pagesCrawled > 1 && c.pagesCrawled < 31, "crawled " + c.pagesCrawled);
    const sum = c.pages.reduce((s, p) => s + (p.bytes || 0), 0);
    assert.ok(sum >= 2500, "cumulative recorded bytes " + sum + " must reach the budget (tripping page is recorded)");
    assert.ok(c.pagesDiscovered > c.pagesCrawled && c.sampled === true);
  });

  console.log("scoring (count-mode dedup):");
  await test("one broken target linked N times counts once", async () => {
    const r = await audit(base + "/multibroken", { allowPrivate: true, maxPages: 5 });
    const f = r.issues.find((i) => i.id === "tech.broken-link.internal");
    assert.ok(f && f.affectedCount === 1, "affectedCount=" + (f && f.affectedCount));
  });

  console.log("external link checking (opt-in):");
  const { classify: classifyExt } = require("../src/checks/external");
  await test("classify: 404/410/DNS/refused = broken; 403/405/429/timeout = unverified", () => {
    assert.strictEqual(classifyExt(404, null), "broken");
    assert.strictEqual(classifyExt(410, null), "broken");
    assert.strictEqual(classifyExt(0, "DNS_FAIL"), "broken");
    assert.strictEqual(classifyExt(0, "UNREACHABLE"), "broken");
    assert.strictEqual(classifyExt(403, null), "unverified");
    assert.strictEqual(classifyExt(429, null), "unverified");
    assert.strictEqual(classifyExt(0, "TIMEOUT"), "unverified");
  });
  await test("external check flags only the truly-broken link (404), not the 403", async () => {
    const r = await audit(base + "/ext-test", { allowPrivate: true, checkExternal: true, maxPages: 3 });
    const f = r.issues.find((i) => i.id === "tech.broken-link.external");
    assert.ok(f, "no external-link finding");
    assert.strictEqual(f.affectedCount, 1);
    assert.ok(f.sample.some((s) => /missing-page/.test(s)));
  });
  await test("external check is off by default", async () => {
    const r = await audit(base + "/ext-test", { allowPrivate: true, maxPages: 3 });
    assert.ok(!r.issues.some((i) => i.id === "tech.broken-link.external"));
  });

  console.log("deep mode (PLAN-v2 §1):");
  const { isDeepAvailable, isAxeAvailable, ttfbFromTiming, buildRedirectChain, deepCrawl, isDocLink, hostAllowed } = require("../src/deep");
  await test("hostAllowed: metadata always blocked, public allowed, private gated by allowLocal", async () => {
    assert.strictEqual(await hostAllowed("169.254.169.254", true), false); // metadata even under allowLocal
    assert.strictEqual(await hostAllowed("8.8.8.8", false), true);
    assert.strictEqual(await hostAllowed("10.0.0.5", false), false);
    assert.strictEqual(await hostAllowed("10.0.0.5", true), true);
  });
  await test("ttfbFromTiming: positive delta rounds; non-positive/missing → 0", () => {
    assert.strictEqual(ttfbFromTiming({ requestStart: 10, responseStart: 35.6 }), 26);
    assert.strictEqual(ttfbFromTiming({ requestStart: 50, responseStart: 50 }), 0);
    assert.strictEqual(ttfbFromTiming(null), 0);
  });
  await test("isDocLink flags documents/binaries (probed statically, not rendered)", () => {
    assert.ok(isDocLink("https://x/report.pdf"));
    assert.ok(isDocLink("https://x/a/b/file.docx?v=2"));
    assert.ok(isDocLink("https://x/archive.zip"));
    assert.ok(!isDocLink("https://x/solutions"));
    assert.ok(!isDocLink("https://x/page.html"));
  });
  await test("buildRedirectChain → ordered {url,status} hops (matches static redirectChain shape)", async () => {
    const mk = (url, from, st) => ({ url: () => url, redirectedFrom: () => from, response: async () => (st ? { status: () => st } : null) });
    const a = mk("https://a/", null, 301), b = mk("https://b/", a, 302), c = mk("https://c/", b, null);
    assert.deepStrictEqual(await buildRedirectChain(c), [{ url: "https://a/", status: 301 }, { url: "https://b/", status: 302 }]);
    assert.deepStrictEqual(await buildRedirectChain(a), []);
  });
  if (isDeepAvailable()) {
    await test("[deep] renders a fixture in a real browser → mode=deep, no SPA flag, 5 categories", async () => {
      const r = await audit(base + "/", { deep: true, allowPrivate: true, maxPages: 2 });
      assert.strictEqual(r.meta.mode, "deep");
      assert.strictEqual(r.meta.flags.spa, false);
      assert.ok(r.pages[0].status === 200 && r.score.categories.length === 5);
    });
    await test("[deep] crawl yields static-shaped page records (page/contentType/bytes/status)", async () => {
      const c = await deepCrawl(base + "/about.html", { allowPrivate: true, maxPages: 1, timeout: 20000 });
      const p = c.pages[0];
      assert.ok(p.page && typeof p.contentType === "string" && typeof p.bytes === "number" && p.status === 200);
    });
    await test("[deep] JS-error page → tech.js-error (uncaught) + tech.js-console", async () => {
      const r = await audit(base + "/js-error", { deep: true, allowPrivate: true, maxPages: 1 });
      assert.ok(r.issues.some((i) => i.id === "tech.js-error"), "no js-error finding");
      assert.ok(r.issues.some((i) => i.id === "tech.js-console"), "no js-console finding");
    });
    if (isAxeAvailable()) {
      await test("[deep+axe] bad-contrast page → a11y.contrast + accessibility confidence=full", async () => {
        const r = await audit(base + "/bad-contrast", { deep: true, allowPrivate: true, maxPages: 1 });
        const f = r.issues.find((i) => i.id === "a11y.contrast");
        assert.ok(f && f.affectedCount >= 1, "no contrast finding");
        assert.strictEqual(r.score.categories.find((c) => c.key === "accessibility").confidence, "full");
      });
    } else {
      console.log("  (axe tests skipped — axe-core not installed)");
    }
  } else {
    console.log("  (browser tests skipped — Playwright not installed)");
  }

  console.log("backend (server.js SSE wire format):");
  const engine = createEngineServer();
  await new Promise((r) => engine.listen(0, "127.0.0.1", r));
  const ePort = engine.address().port;

  function collectSSE(streamUrl, maxMs = 20000) {
    return new Promise((resolve, reject) => {
      const events = [];
      const r = http.get(streamUrl, (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const ev = {};
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) ev.event = line.slice(6).trim();
              else if (line.startsWith("data:")) ev.data = line.slice(5).trim();
            }
            if (ev.event) {
              try { ev.parsed = JSON.parse(ev.data); } catch (_) { ev.parsed = null; }
              events.push(ev);
              if (ev.event === "done" || ev.event === "error") { res.destroy(); return resolve(events); }
            }
          }
        });
        res.on("end", () => resolve(events));
        res.on("error", reject);
      });
      r.on("error", reject);
      setTimeout(() => { try { r.destroy(); } catch (_) { /* noop */ } resolve(events); }, maxMs);
    });
  }

  await test("SSE emits meta → progress → done with a contract-valid report", async () => {
    const evs = await collectSSE(`http://127.0.0.1:${ePort}/api/audit/stream?url=${encodeURIComponent(base + "/")}&allowLocal=true&limit=5`);
    const types = evs.map((e) => e.event);
    assert.ok(types.includes("meta"), "no meta event");
    assert.ok(types.includes("progress"), "no progress event");
    assert.strictEqual(types[types.length - 1], "done", "stream did not end on done");
    const meta = evs.find((e) => e.event === "meta").parsed;
    assert.ok(typeof meta.normalizedUrl === "string" && typeof meta.startedAt === "string");
    const prog = evs.find((e) => e.event === "progress").parsed;
    assert.ok(["Обход", "Проверка ссылок", "Анализ", "Готово"].includes(prog.phase), "bad phase " + prog.phase);
    assert.ok(typeof prog.pagesCrawled === "number" && typeof prog.pagesDiscovered === "number" && "currentUrl" in prog);
    const done = evs.find((e) => e.event === "done").parsed;
    assert.ok(done.meta && done.score && Array.isArray(done.issues) && Array.isArray(done.pages));
    assert.strictEqual(done.score.categories.length, 5);
  });
  await test("SSE event field shapes match CONTRACT §1 (meta/progress/done/error)", async () => {
    const evs = await collectSSE(`http://127.0.0.1:${ePort}/api/audit/stream?url=${encodeURIComponent(base + "/")}&allowLocal=true&limit=5`);
    const meta = evs.find((e) => e.event === "meta").parsed;
    assert.ok(
      typeof meta.startUrl === "string" && typeof meta.normalizedUrl === "string" &&
      typeof meta.startedAt === "string" && typeof meta.pagesDiscovered === "number",
      "meta fields"
    );
    const prog = evs.find((e) => e.event === "progress").parsed;
    assert.deepStrictEqual(
      Object.keys(prog).sort(),
      ["currentUrl", "pagesCrawled", "pagesDiscovered", "phase"],
      "progress must carry exactly the CONTRACT fields"
    );
    const done = evs.find((e) => e.event === "done").parsed;
    assert.strictEqual(done.report, undefined, "done must be the Report directly, not { report }");
    assert.ok(done.meta && done.meta.finalUrl && done.meta.generatedAt && done.score, "done report shape");
    const errEvs = await collectSSE(`http://127.0.0.1:${ePort}/api/audit/stream?url=`);
    const err = errEvs.find((e) => e.event === "error").parsed;
    assert.ok(typeof err.code === "string" && typeof err.message === "string" && err.message.length > 0, "error needs code+message");
  });
  await test("SSE progress reaches phase 'Готово'", async () => {
    const evs = await collectSSE(`http://127.0.0.1:${ePort}/api/audit/stream?url=${encodeURIComponent(base + "/")}&allowLocal=true&limit=5`);
    assert.ok(evs.some((e) => e.event === "progress" && e.parsed.phase === "Готово"));
  });
  await test("SSE blocks a private host without allowLocal (PRIVATE_BLOCKED)", async () => {
    const evs = await collectSSE(`http://127.0.0.1:${ePort}/api/audit/stream?url=${encodeURIComponent("http://127.0.0.1:9/")}`);
    const err = evs.find((e) => e.event === "error");
    assert.ok(err && err.parsed.code === "PRIVATE_BLOCKED", "code=" + (err && err.parsed.code));
  });
  await test("SSE rejects an empty URL (BAD_URL)", async () => {
    const evs = await collectSSE(`http://127.0.0.1:${ePort}/api/audit/stream?url=`);
    const err = evs.find((e) => e.event === "error");
    assert.ok(err && err.parsed.code === "BAD_URL");
  });
  await test("GET /api/capabilities reports deep availability as a boolean", async () => {
    const body = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${ePort}/api/capabilities`, (r) => { let s = ""; r.setEncoding("utf8"); r.on("data", (d) => (s += d)); r.on("end", () => resolve(s)); });
    });
    assert.strictEqual(typeof JSON.parse(body).deep, "boolean");
  });
  await test("SSE with deep=1 but no browser → DEEP_UNAVAILABLE, audit never starts", async () => {
    process.env.SITEREADY_NO_DEEP = "1";
    try {
      const evs = await collectSSE(`http://127.0.0.1:${ePort}/api/audit/stream?url=${encodeURIComponent(base + "/")}&deep=1&allowLocal=true`);
      const err = evs.find((e) => e.event === "error");
      assert.ok(err && err.parsed.code === "DEEP_UNAVAILABLE", "code=" + (err && err.parsed.code));
      assert.ok(!evs.some((e) => e.event === "progress"), "audit must not start when deep is unavailable");
    } finally {
      delete process.env.SITEREADY_NO_DEEP;
    }
  });
  await test("server serves the engine placeholder at /", async () => {
    const html = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${ePort}/`, (r) => { let s = ""; r.setEncoding("utf8"); r.on("data", (d) => (s += d)); r.on("end", () => resolve(s)); });
    });
    assert.ok(/SiteReady/.test(html));
  });

  engine.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

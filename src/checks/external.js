"use strict";

// External-link check (PLAN §4.2, §5.4). Opt-in (the audit must be asked for it).
// Distinguishes REAL breakage (404/410/DNS/refused → penalized) from "could not
// verify" (403/405/429/503/timeout — a bot was simply refused → NOT penalized),
// so a site isn't dinged for third-party servers that block crawlers.

const { URL } = require("url");
const { fetch } = require("../fetcher");
const { relPath, htmlPages, uniq } = require("./util");

function classify(status, errorCode) {
  if (errorCode) {
    if (errorCode === "DNS_FAIL" || errorCode === "UNREACHABLE") return "broken";
    return "unverified"; // TIMEOUT, SSRF_BLOCKED, etc.
  }
  if (status === 404 || status === 410) return "broken";
  return "unverified"; // 403/405/429/503/999/other — bot-blocked or temporary
}

async function checkExternalLinks(ctx, opts = {}) {
  const { allowPrivate = false, externalLimit = 150, externalTimeout = 8000 } = opts;
  const html = htmlPages(ctx.pages);

  let startHost = "";
  try { startHost = new URL(ctx.startUrl).hostname.replace(/^www\./i, "").toLowerCase(); } catch (_) { /* noop */ }

  const ext = new Map(); // distinct external URL -> source page path
  for (const p of html) {
    for (const a of p.page.anchors) {
      if (!a.href) continue;
      let u;
      try { u = new URL(a.href, p.finalUrl || p.url); } catch (_) { continue; }
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      const h = u.hostname.replace(/^www\./i, "").toLowerCase();
      if (h === startHost) continue; // internal — handled by the internal check
      u.hash = "";
      if (!ext.has(u.href)) ext.set(u.href, relPath(p.url));
      if (ext.size >= externalLimit) break;
    }
    if (ext.size >= externalLimit) break;
  }
  if (ext.size === 0) return [];

  const entries = [...ext.entries()];
  const broken = [];
  let idx = 0;
  async function worker() {
    while (idx < entries.length) {
      const [url, src] = entries[idx++];
      let verdict;
      try {
        const r = await fetch(url, { method: "HEAD", allowPrivate, timeout: externalTimeout });
        verdict = classify(r.status, null);
        if (r.status === 405 || r.status === 501) {
          // server refuses HEAD — confirm with GET before trusting the status
          try { const g = await fetch(url, { method: "GET", allowPrivate, timeout: externalTimeout }); verdict = classify(g.status, null); }
          catch (e2) { verdict = classify(0, e2.code); }
        }
      } catch (e) {
        verdict = classify(0, e.code);
      }
      if (verdict === "broken") broken.push({ url, src });
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, entries.length) }, () => worker()));

  if (!broken.length) return [];
  return [{
    id: "tech.broken-link.external",
    category: "tech",
    severity: "warning",
    title: "Битые внешние ссылки",
    detail: `Найдено ${broken.length} внешних ссылок, ведущих на ошибки (404/410/DNS/отказ). Временные блокировки (403/405/429/таймаут) не учитывались.`,
    fix: "Обновите или удалите внешние ссылки, ведущие на ошибки.",
    mode: "count",
    scored: true,
    penalty: 0,
    affectedCount: broken.length,
    affectedPages: uniq(broken.map((b) => b.src)).slice(0, 20),
    sample: uniq(broken.map((b) => b.url)).slice(0, 5),
  }];
}

module.exports = { checkExternalLinks, classify };

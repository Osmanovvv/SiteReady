"use strict";

// Orchestrator (PLAN §5/§6): crawl → site-level probes → checks → scoring →
// a report object that matches CONTRACT.md exactly (meta / score / issues / pages).

const { URL } = require("url");
const { crawl } = require("./crawler");
const { deepCrawl, DEEP_MAX_PAGES } = require("./deep");
const { fetch } = require("./fetcher");
const { buildScore, gradeFromScore } = require("./score");
const { relPath, htmlPages } = require("./checks/util");
const { checkExternalLinks } = require("./checks/external");

const CHECKS = [
  require("./checks/seo"),
  require("./checks/tech"),
  require("./checks/performance"),
  require("./checks/accessibility"),
  require("./checks/responsive"),
];

// Content-based criticals that are unreliable on a client-rendered SPA — reclassified.
const SPA_DOWNGRADE = new Set(["seo.h1.missing", "seo.title.missing", "a11y.img-alt.missing", "seo.meta-description.missing"]);

async function probe(url, opts) {
  try {
    const r = await fetch(url, { allowPrivate: opts.allowPrivate, timeout: opts.probeTimeout || 8000 });
    return { exists: r.status >= 200 && r.status < 400, status: r.status };
  } catch (_) {
    return { exists: false, status: 0 };
  }
}

async function gatherSite(startUrl, opts) {
  let origin;
  try { origin = new URL(startUrl).origin; } catch (_) { return { robots: { exists: false }, sitemap: { exists: false } }; }
  const [robots, sitemap] = await Promise.all([
    probe(origin + "/robots.txt", opts),
    probe(origin + "/sitemap.xml", opts),
  ]);
  return { origin, robots, sitemap };
}

function detectSpa(pages) {
  const first = pages.find((p) => p.page);
  if (!first) return false;
  const pg = first.page;
  const hasBundle = pg.scripts.some((s) => s.src);
  return pg.textLength < 200 && hasBundle && pg.headings.length <= 1;
}

function reclassifyForSpa(findings) {
  for (const f of findings) {
    if (SPA_DOWNGRADE.has(f.id) && f.severity === "critical") {
      f.severity = "warning";
      f.detail += " (статический аудит ограничен — сайт рендерится на клиенте; уточняется в deep-режиме).";
    }
  }
  return findings;
}

function perPage(pages, findings) {
  return pages.map((p) => {
    const pp = relPath(p.url);
    const counts = { critical: 0, warning: 0, info: 0 };
    for (const f of findings) {
      if (f.affectedPages.includes(pp) && counts[f.severity] != null) counts[f.severity] += 1;
    }
    const dead = p.status >= 400 || p.status === 0 || !p.page;
    const score = dead ? 0 : Math.max(0, Math.min(100, 100 - counts.critical * 15 - counts.warning * 6 - counts.info * 2));
    return {
      url: pp,
      status: p.status,
      score,
      issueCounts: counts,
      ttfbMs: p.ttfbMs != null ? Math.round(p.ttfbMs) : 0,
      bytes: p.bytes || 0,
      redirectChain: (p.redirectChain || []).map((h) => ({ url: relPath(h.url), status: h.status })),
    };
  });
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

async function audit(startUrl, opts = {}) {
  const o = { allowPrivate: false, maxPages: 50, timeout: 15000, ...opts };
  const onProgress = typeof o.onProgress === "function" ? o.onProgress : null;
  // CONTRACT progress: phase is a Russian UI string the frontend matches exactly.
  const emit = (phase, crawled, discovered, current) => {
    if (onProgress) onProgress({ phase, pagesCrawled: crawled, pagesDiscovered: discovered, currentUrl: current || null });
  };
  const t0 = Date.now();

  // Deep mode renders each page in a real browser (PLAN-v2 §1) and reuses the same
  // checks on the rendered DOM. It's heavier, so it crawls a smaller page budget.
  const crawler = o.deep ? deepCrawl : crawl;
  const crawlMaxPages = o.deep ? Math.min(o.maxPages, DEEP_MAX_PAGES) : o.maxPages;
  const crawlRes = await crawler(startUrl, {
    ...o,
    maxPages: crawlMaxPages,
    onProgress: (p) => emit("Обход", p.crawled, p.discovered, p.current),
  });
  const finalUrl = (crawlRes.pages.find((p) => p.page) || crawlRes.pages[0] || {}).finalUrl || crawlRes.startUrl;

  // If the start URL never connected (DNS/refused/timeout) and nothing at all was
  // reachable, fail fast with the network code — there is nothing to audit, so the
  // UI shows a clear "site not found / unreachable" message instead of an F report.
  // (An HTTP response — even 4xx/5xx — counts as reachable and proceeds to a report.)
  if (!crawlRes.pages.some((p) => p.status > 0)) {
    const first = crawlRes.pages[0];
    if (first && first.status === 0 && first.error) {
      throw Object.assign(new Error("Сайт недоступен для анализа"), { code: first.error });
    }
  }

  emit("Проверка ссылок", crawlRes.pagesCrawled, crawlRes.pagesDiscovered, null);
  const site = await gatherSite(crawlRes.startUrl, o);
  emit("Анализ", crawlRes.pagesCrawled, crawlRes.pagesDiscovered, null);
  // In deep mode the DOM is real — SPA detection/reclassification is unnecessary.
  const spa = o.deep ? false : detectSpa(crawlRes.pages);

  const ctx = {
    pages: crawlRes.pages,
    site,
    spa,
    startUrl: crawlRes.startUrl,
    finalUrl,
    pagesCrawled: crawlRes.pagesCrawled,
    sampled: crawlRes.sampled,
  };

  let findings = [];
  for (const check of CHECKS) {
    try { findings = findings.concat(check(ctx) || []); } catch (e) { /* a failing check must not sink the audit */ }
  }
  if (spa) findings = reclassifyForSpa(findings);

  // External link checking is opt-in (network to third parties, slower).
  if (o.checkExternal) {
    try { findings = findings.concat(await checkExternalLinks(ctx, o)); } catch (_) { /* best-effort */ }
  }

  findings.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || a.category.localeCompare(b.category));

  // Reachability gate: if nothing analyzable came back, the site is down — never
  // hand a paying client an "A" for a dead site. Emit a critical and force F.
  const htmlCount = htmlPages(crawlRes.pages).length;
  if (htmlCount === 0) {
    const startStatus = (crawlRes.pages[0] || {}).status || 0;
    findings.push({
      id: "tech.site.unreachable",
      category: "tech",
      severity: "critical",
      title: "Сайт недоступен для анализа",
      detail: `Ни одна страница не вернула пригодный HTML (стартовый статус: ${startStatus || "нет ответа"}). Аудит контента невозможен.`,
      fix: "Убедитесь, что сайт доступен и отдаёт HTML.",
      mode: "count",
      scored: true,
      penalty: 0,
      affectedCount: crawlRes.pages.length || 1,
      affectedPages: crawlRes.pages.slice(0, 20).map((p) => relPath(p.url)),
      sample: [],
    });
  }

  // Prevalence is scored over analyzable (HTML) pages, not raw crawl count.
  const analyzable = Math.max(1, htmlCount);
  const score = buildScore(findings, analyzable);
  if (htmlCount === 0) {
    score.overall = 0;
    score.grade = "F";
    for (const c of score.categories) { c.score = 0; c.grade = "F"; }
  }

  emit("Готово", crawlRes.pagesCrawled, crawlRes.pagesDiscovered, null);

  return {
    meta: {
      startUrl: crawlRes.startUrl,
      finalUrl,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      pagesCrawled: crawlRes.pagesCrawled,
      pagesDiscovered: crawlRes.pagesDiscovered,
      sampled: crawlRes.pagesCrawled < crawlRes.pagesDiscovered,
      mode: o.deep ? "deep" : "static",
      flags: { spa },
    },
    score,
    issues: findings,
    pages: perPage(crawlRes.pages, findings),
  };
}

module.exports = { audit, gradeFromScore };

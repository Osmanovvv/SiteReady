"use strict";

const { URL } = require("url");
const { relPath, prevalence, count, htmlPages, uniq } = require("./util");
const { canonicalize } = require("../crawler");

module.exports = function tech(ctx) {
  const out = [];
  const pages = ctx.pages;
  const html = htmlPages(pages);
  const path = (p) => relPath(p.url);

  let startHttps = false;
  try { startHttps = new URL(ctx.finalUrl || ctx.startUrl).protocol === "https:"; } catch (_) { /* noop */ }

  if (!startHttps) {
    // Site-wide critical: every page is served over http, so it weighs the full cap.
    const allHtml = html.map(path);
    out.push(prevalence({ id: "tech.https.missing", category: "tech", severity: "critical", title: "Сайт без HTTPS", detail: (n) => `Сайт отдаётся по http:// (${n} стр.) — небезопасно и понижается в выдаче.`, fix: "Установите TLS-сертификат и переведите сайт на https." }, allHtml.length ? allHtml : [relPath(ctx.startUrl)]));
  }

  // Broken internal links: pages that returned 4xx/5xx (or no response), attributed
  // to the SOURCE pages that link to them (affectedPages = where the link lives,
  // sample = the broken targets).
  const brokenStatus = new Map();
  for (const p of pages) if (p.status >= 400 || p.status === 0) brokenStatus.set(relPath(p.url), p.status);
  if (brokenStatus.size) {
    const brokenTargets = new Set(); // distinct broken target URLs — the penalty basis
    const srcPages = new Set();
    const samples = [];
    for (const p of html) {
      for (const a of p.page.anchors) {
        if (!a.href) continue;
        let absUrl;
        try { absUrl = new URL(a.href, p.finalUrl || p.url); } catch (_) { continue; }
        // Canonicalize the target the SAME way the crawler keys pages, so a link
        // written "/team/" or "/blog/index.html" matches the stored "/team"/"/blog".
        const tp = relPath(canonicalize(absUrl));
        if (brokenStatus.has(tp)) {
          brokenTargets.add(tp);
          srcPages.add(relPath(p.url));
          samples.push(`${tp} → ${brokenStatus.get(tp) || "нет ответа"}`);
        }
      }
    }
    const cov = ctx.sampled ? " (проверены только среди обойдённых страниц)" : "";
    if (brokenTargets.size) out.push(count({ id: "tech.broken-link.internal", category: "tech", severity: "critical", title: "Битые внутренние ссылки (4xx/5xx)", detail: (n) => `Найдено ${n} битых целей внутренних ссылок${cov}.`, fix: "Исправьте или удалите ссылки, ведущие на 4xx/5xx." }, brokenTargets.size, [...srcPages], uniq(samples)));
  }

  // Soft errors: a page returns 4xx/5xx but still serves a full HTML body (typically
  // an SPA shell rendered client-side). Humans see content in the browser, but
  // crawlers/search engines get the error status — so the page won't be indexed.
  const softErrors = pages.filter((p) => p.status >= 400 && /text\/html/i.test(p.contentType || "") && (p.bytes || 0) > 1500);
  if (softErrors.length) {
    out.push(count({ id: "tech.soft-error-status", category: "tech", severity: "warning", title: "Контент со статусом ошибки (soft 404)", detail: (n) => `${n} стр. отдают полноценный HTML, но со статусом 4xx/5xx. В браузере (особенно SPA) контент виден, а поисковики и прямые заходы получают ошибку — страницы не индексируются.`, fix: "Настройте сервер/SPA-fallback: существующие страницы должны отдавать статус 200 (или серверный рендер маршрутов)." }, softErrors.length, softErrors.map(path), uniq(softErrors.map((p) => `${relPath(p.url)} → ${p.status}`))));
  }

  if (startHttps) {
    const mixedResources = new Set(); // distinct http:// resource URLs — the penalty basis
    const mixedPages = [];
    for (const p of html) {
      const res = [];
      for (const im of p.page.images) if (im.src && /^http:\/\//i.test(im.src)) res.push(im.src);
      for (const s of p.page.scripts) if (s.src && /^http:\/\//i.test(s.src)) res.push(s.src);
      for (const l of p.page.stylesheets) if (/^http:\/\//i.test(l)) res.push(l);
      if (res.length) { for (const r of res) mixedResources.add(r); mixedPages.push(path(p)); }
    }
    if (mixedResources.size) out.push(count({ id: "tech.mixed-content", category: "tech", severity: "critical", title: "Mixed content", detail: (n) => `${n} ресурсов по http:// на HTTPS-страницах — браузер их заблокирует.`, fix: "Замените http:// на https:// у всех ресурсов." }, mixedResources.size, mixedPages, [...mixedResources]));
  }

  const noCharset = html.filter((p) => !/charset=/i.test(p.contentType || "") && !p.page.charsetMeta).map(path);
  if (noCharset.length) out.push(prevalence({ id: "tech.charset.missing", category: "tech", severity: "warning", title: "Не объявлена кодировка", detail: (n) => `На ${n} стр. нет ни meta charset, ни charset в Content-Type.`, fix: 'Добавьте <meta charset="utf-8"> в начало <head>.' }, noCharset));

  let anchorDefects = 0;
  const anchorPages = [];
  const anchorSamples = [];
  for (const p of html) {
    const targets = new Set(Object.keys(p.page.idCounts));
    for (const n of p.page.names || []) targets.add(n); // <a name="…"> anchors are valid fragment targets too
    const bad = p.page.anchors.filter((a) => {
      if (!a.href || !a.href.startsWith("#") || a.href.length <= 1) return false;
      const frag = a.href.slice(1);
      if (frag.toLowerCase() === "top") return false; // "#top" = top of document per HTML spec
      if (targets.has(frag)) return false;
      let dec = frag; try { dec = decodeURIComponent(frag); } catch (_) { /* keep raw */ }
      return !targets.has(dec); // non-ASCII ids are often percent-encoded in the href
    });
    if (bad.length) { anchorDefects += bad.length; anchorPages.push(path(p)); anchorSamples.push(...bad.map((b) => b.href)); }
  }
  if (anchorDefects) out.push(count({ id: "tech.broken-anchor", category: "tech", severity: "warning", title: "Битые якоря (#id)", detail: (n) => `${n} ссылок-якорей ведут на несуществующий id/name на странице.`, fix: "Проверьте id/name целевых блоков или поправьте ссылки оглавления." }, anchorDefects, anchorPages, uniq(anchorSamples)));

  let tbDefects = 0;
  const tbPages = [];
  for (const p of html) {
    const bad = p.page.anchors.filter((a) => a.target === "_blank" && !(a.rel || "").toLowerCase().includes("noopener"));
    if (bad.length) { tbDefects += bad.length; tbPages.push(path(p)); }
  }
  if (tbDefects) out.push(count({ id: "tech.noopener.missing", category: "tech", severity: "warning", title: "target=_blank без rel=noopener", detail: (n) => `${n} ссылок открываются в новой вкладке без rel="noopener".`, fix: 'Добавьте rel="noopener" к ссылкам с target="_blank".' }, tbDefects, tbPages));

  // Deep-only: JS runtime errors captured while rendering in a real browser
  // (severity by type — uncaught exception vs console.error). Present only in deep.
  const jsWarn = { pages: [], count: 0, samples: [] };
  const jsInfo = { pages: [], count: 0, samples: [] };
  for (const p of pages) {
    const errs = p.consoleErrors || [];
    const uncaught = errs.filter((e) => e.type === "pageerror");
    const logged = errs.filter((e) => e.type === "console");
    if (uncaught.length) { jsWarn.pages.push(relPath(p.url)); jsWarn.count += uncaught.length; jsWarn.samples.push(...uncaught.map((e) => e.text)); }
    if (logged.length) { jsInfo.pages.push(relPath(p.url)); jsInfo.count += logged.length; jsInfo.samples.push(...logged.map((e) => e.text)); }
  }
  if (jsWarn.count) out.push(count({ id: "tech.js-error", category: "tech", severity: "warning", title: "Ошибки JavaScript при рендере", detail: (n) => `${n} необработанных JS-ошибок в браузере — часть функционала может не работать.`, fix: "Исправьте исключения (DevTools → Console)." }, jsWarn.count, jsWarn.pages, uniq(jsWarn.samples)));
  if (jsInfo.count) out.push(count({ id: "tech.js-console", category: "tech", severity: "info", title: "Ошибки в консоли (console.error)", detail: (n) => `${n} сообщений console.error при рендере — возможные проблемы страницы.`, fix: "Проверьте сообщения в консоли браузера." }, jsInfo.count, jsInfo.pages, uniq(jsInfo.samples)));

  return out;
};

"use strict";

const { URL } = require("url");
const { relPath, prevalence, count, htmlPages, uniq } = require("./util");

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
        let abs;
        try { abs = new URL(a.href, p.finalUrl || p.url).href; } catch (_) { continue; }
        const tp = relPath(abs);
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
    const ids = new Set(Object.keys(p.page.idCounts));
    const bad = p.page.anchors.filter((a) => a.href && a.href.startsWith("#") && a.href.length > 1 && !ids.has(a.href.slice(1)));
    if (bad.length) { anchorDefects += bad.length; anchorPages.push(path(p)); anchorSamples.push(...bad.map((b) => b.href)); }
  }
  if (anchorDefects) out.push(count({ id: "tech.broken-anchor", category: "tech", severity: "warning", title: "Битые якоря (#id)", detail: (n) => `${n} ссылок-якорей ведут на несуществующий id на странице.`, fix: "Проверьте id целевых блоков или поправьте ссылки оглавления." }, anchorDefects, anchorPages, uniq(anchorSamples)));

  let tbDefects = 0;
  const tbPages = [];
  for (const p of html) {
    const bad = p.page.anchors.filter((a) => a.target === "_blank" && !(a.rel || "").toLowerCase().includes("noopener"));
    if (bad.length) { tbDefects += bad.length; tbPages.push(path(p)); }
  }
  if (tbDefects) out.push(count({ id: "tech.noopener.missing", category: "tech", severity: "warning", title: "target=_blank без rel=noopener", detail: (n) => `${n} ссылок открываются в новой вкладке без rel="noopener".`, fix: 'Добавьте rel="noopener" к ссылкам с target="_blank".' }, tbDefects, tbPages));

  return out;
};

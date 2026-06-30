"use strict";

const { relPath, prevalence, htmlPages } = require("./util");

module.exports = function performance(ctx) {
  const out = [];
  const html = htmlPages(ctx.pages);
  const path = (p) => relPath(p.url);

  // TTFB — informational only (network-dependent, scored:false per §6).
  const ttfbs = html.map((p) => p.ttfbMs).filter((t) => typeof t === "number");
  if (ttfbs.length) {
    const avg = Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length);
    const slow = html.filter((p) => p.ttfbMs > 600).map(path);
    if (avg > 200) {
      out.push({
        id: "perf.ttfb",
        category: "performance",
        severity: avg > 600 ? "warning" : "info",
        title: "Время до первого байта (TTFB)",
        detail: `Среднее TTFB ~${avg} мс (оценочно, с точки замера)${slow.length ? ` — медленно на ${slow.length} стр.` : ""}.`,
        fix: "Кэширование на сервере/CDN, оптимизация бэкенда.",
        mode: "prevalence",
        scored: false,
        affectedCount: slow.length || html.length,
        affectedPages: (slow.length ? slow : html.map(path)).slice(0, 20),
        sample: [`~${avg} мс`],
      });
    }
  }

  const noComp = html.filter((p) => !/gzip|br|deflate/i.test(p.contentEncoding || "")).map(path);
  if (noComp.length) out.push(prevalence({ id: "perf.no-compression", category: "performance", severity: "warning", title: "Нет сжатия (gzip/br)", detail: (n) => `На ${n} стр. HTML отдаётся без сжатия.`, fix: "Включите gzip или brotli на сервере для текстовых ресурсов." }, noComp));

  const bigHtml = html.filter((p) => (p.bytes || 0) > 100 * 1024).map(path);
  if (bigHtml.length) out.push(prevalence({ id: "perf.html-size", category: "performance", severity: "warning", title: "Большой HTML-документ", detail: (n) => `На ${n} стр. HTML больше 100 КБ.`, fix: "Сократите разметку и инлайн, выносите данные в отдельные запросы." }, bigHtml));

  const clsPages = [];
  for (const p of html) { if (p.page.images.some((im) => !(im.hasWidth && im.hasHeight))) clsPages.push(path(p)); }
  if (clsPages.length) out.push(prevalence({ id: "perf.img-dimensions", category: "performance", severity: "warning", title: "Картинки без width/height", detail: (n) => `На ${n} стр. есть картинки без размеров — риск скачков верстки (CLS).`, fix: "Проставьте width и height у <img> (или aspect-ratio в CSS)." }, clsPages));

  const lazyPages = [];
  for (const p of html) { if (p.page.images.some((im) => im.loading !== "lazy")) lazyPages.push(path(p)); }
  if (lazyPages.length) out.push(prevalence({ id: "perf.img-no-lazy", category: "performance", severity: "info", title: "Картинки без lazy-load", detail: (n) => `На ${n} стр. есть картинки без loading="lazy".`, fix: 'Добавьте loading="lazy" к изображениям ниже первого экрана.' }, lazyPages));

  return out;
};

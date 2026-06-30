"use strict";

const { relPath, prevalence, count, htmlPages } = require("./util");

module.exports = function seo(ctx) {
  const out = [];
  const pages = htmlPages(ctx.pages);
  const path = (p) => relPath(p.url);

  const noTitle = pages.filter((p) => !p.page.title || !p.page.title.trim()).map(path);
  if (noTitle.length) out.push(prevalence({ id: "seo.title.missing", category: "seo", severity: "critical", title: "Отсутствует <title>", detail: (n) => `На ${n} ${n === 1 ? "странице" : "страницах"} нет тега <title> или он пустой.`, fix: "Добавьте уникальный <title> длиной 30–60 символов на каждую страницу." }, noTitle));

  const badLen = pages.filter((p) => { const t = (p.page.title || "").trim(); return t && (t.length < 30 || t.length > 60); }).map(path);
  if (badLen.length) out.push(prevalence({ id: "seo.title.length", category: "seo", severity: "warning", title: "Неоптимальная длина <title>", detail: (n) => `На ${n} стр. длина title вне диапазона 30–60 символов.`, fix: "Подгоните длину title под 30–60 символов." }, badLen));

  const titleMap = {};
  for (const p of pages) { const t = (p.page.title || "").trim(); if (t) (titleMap[t] = titleMap[t] || []).push(path(p)); }
  const dupTitle = [];
  for (const t in titleMap) if (titleMap[t].length > 1) dupTitle.push(...titleMap[t]);
  if (dupTitle.length) out.push(prevalence({ id: "seo.title.duplicate", category: "seo", severity: "warning", title: "Дублирующиеся <title>", detail: (n) => `Одинаковый title используется на ${n} страницах.`, fix: "Сделайте title уникальным на каждой странице." }, dupTitle));

  const descOf = (p) => { const m = p.page.metas.find((x) => x.name === "description"); return m && m.content ? m.content.trim() : ""; };
  const noDesc = pages.filter((p) => !descOf(p)).map(path);
  if (noDesc.length) out.push(prevalence({ id: "seo.meta-description.missing", category: "seo", severity: "warning", title: "Нет meta description", detail: (n) => `На ${n} стр. отсутствует meta description.`, fix: "Добавьте уникальное описание 70–160 символов." }, noDesc));

  const descMap = {};
  for (const p of pages) { const d = descOf(p); if (d) (descMap[d] = descMap[d] || []).push(path(p)); }
  const dupDesc = [];
  let dupDescSample = "";
  for (const d in descMap) if (descMap[d].length > 1) { dupDesc.push(...descMap[d]); dupDescSample = dupDescSample || d; }
  if (dupDesc.length) out.push(prevalence({ id: "seo.meta-description.duplicate", category: "seo", severity: "warning", title: "Дублирующиеся meta description", detail: (n) => `Одинаковое описание используется на ${n} страницах.`, fix: "Сделайте описание уникальным под содержание каждой страницы." }, dupDesc, [dupDescSample]));

  const noH1 = pages.filter((p) => p.page.headings.filter((h) => h.level === 1).length === 0).map(path);
  if (noH1.length) out.push(prevalence({ id: "seo.h1.missing", category: "seo", severity: "critical", title: "Нет <h1>", detail: (n) => `На ${n} стр. отсутствует заголовок <h1>.`, fix: "Добавьте ровно один <h1> на страницу." }, noH1));
  const multiH1 = pages.filter((p) => p.page.headings.filter((h) => h.level === 1).length > 1).map(path);
  if (multiH1.length) out.push(prevalence({ id: "seo.h1.multiple", category: "seo", severity: "warning", title: "Несколько <h1>", detail: (n) => `На ${n} стр. больше одного <h1>.`, fix: "Оставьте один <h1> на странице." }, multiH1));

  const noCanon = pages.filter((p) => !p.page.links.some((l) => (l.rel || "").split(/\s+/).includes("canonical"))).map(path);
  if (noCanon.length) out.push(prevalence({ id: "seo.canonical.missing", category: "seo", severity: "warning", title: "Нет canonical", detail: (n) => `На ${n} стр. отсутствует <link rel="canonical">.`, fix: "Добавьте canonical с абсолютным URL." }, noCanon));

  const noOg = pages.filter((p) => { const props = p.page.metas.filter((m) => m.property).map((m) => m.property); return !props.includes("og:title") || !props.includes("og:image"); }).map(path);
  if (noOg.length) out.push(prevalence({ id: "seo.og.missing", category: "seo", severity: "warning", title: "Нет Open Graph разметки", detail: (n) => `На ${n} стр. нет og:title/og:image — кривые превью в соцсетях и мессенджерах.`, fix: "Добавьте og:title, og:description и og:image в <head>." }, noOg));

  const badLd = pages.filter((p) => p.page.jsonLd.some((j) => !j.ok)).map(path);
  if (badLd.length) out.push(prevalence({ id: "seo.jsonld.invalid", category: "seo", severity: "warning", title: "Битый JSON-LD", detail: (n) => `На ${n} стр. микроразметка JSON-LD не парсится.`, fix: "Исправьте синтаксис JSON-LD." }, badLd));

  if (ctx.site && ctx.site.robots && ctx.site.robots.exists === false) out.push(count({ id: "seo.robots.missing", category: "seo", severity: "warning", title: "Нет robots.txt", detail: "Файл robots.txt не найден на сайте.", fix: "Добавьте /robots.txt." }, 1, ["/robots.txt"]));
  if (ctx.site && ctx.site.sitemap && ctx.site.sitemap.exists === false) out.push(count({ id: "seo.sitemap.missing", category: "seo", severity: "warning", title: "Нет sitemap.xml", detail: "Файл sitemap.xml не найден.", fix: "Добавьте /sitemap.xml и укажите его в robots.txt." }, 1, ["/sitemap.xml"]));

  return out;
};

"use strict";

const { relPath, prevalence, htmlPages } = require("./util");

const GENERIC = new Set(["тут", "здесь", "подробнее", "читать далее", "ссылка", "сюда", "click here", "here", "подробно", "далее"]);

module.exports = function accessibility(ctx) {
  const out = [];
  const html = htmlPages(ctx.pages);
  const path = (p) => relPath(p.url);

  const altPages = [];
  let altImgs = 0;
  for (const p of html) { const bad = p.page.images.filter((im) => !im.hasAlt); if (bad.length) { altPages.push(path(p)); altImgs += bad.length; } }
  if (altPages.length) out.push(prevalence({ id: "a11y.img-alt.missing", category: "accessibility", severity: "critical", title: "Картинки без alt", detail: () => `На ${altPages.length} стр. есть изображения без alt (всего ${altImgs}) — недоступны для скринридеров.`, fix: 'Добавьте осмысленный alt; для декоративных — пустой alt="".' }, altPages));

  const noLang = html.filter((p) => !p.page.lang).map(path);
  if (noLang.length) out.push(prevalence({ id: "a11y.html-lang.missing", category: "accessibility", severity: "warning", title: "Нет lang у <html>", detail: (n) => `На ${n} стр. у <html> не задан атрибут lang.`, fix: 'Укажите язык страницы, например <html lang="ru">.' }, noLang));

  const zoom = html.filter((p) => p.page.viewport && /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?!\d)/i.test(p.page.viewport)).map(path);
  if (zoom.length) out.push(prevalence({ id: "a11y.viewport.zoom-blocked", category: "accessibility", severity: "warning", title: "Заблокирован зум", detail: (n) => `На ${n} стр. viewport запрещает масштабирование (user-scalable=no).`, fix: "Уберите user-scalable=no и maximum-scale из meta viewport." }, zoom));

  const dupId = html.filter((p) => Object.values(p.page.idCounts).some((c) => c > 1)).map(path);
  if (dupId.length) out.push(prevalence({ id: "a11y.duplicate-id", category: "accessibility", severity: "warning", title: "Дублирующиеся id", detail: (n) => `На ${n} стр. повторяющиеся id — ломают label, якоря и ARIA.`, fix: "Сделайте все id на странице уникальными." }, dupId));

  const generic = html.filter((p) => p.page.anchors.some((a) => a.text && GENERIC.has(a.text.toLowerCase()))).map(path);
  if (generic.length) out.push(prevalence({ id: "a11y.link-generic-text", category: "accessibility", severity: "info", title: "Неинформативные тексты ссылок", detail: (n) => `На ${n} стр. есть ссылки с текстом «тут»/«подробнее».`, fix: "Используйте осмысленный текст ссылки, описывающий её цель." }, generic));

  return out;
};

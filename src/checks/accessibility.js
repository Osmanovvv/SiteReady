"use strict";

const { relPath, prevalence, count, htmlPages, uniq } = require("./util");

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

  // Deep-only: REAL colour contrast measured in the browser by axe-core (impossible
  // statically). Pages carry p.axe.violations only when the audit ran in deep mode.
  const contrastPages = [];
  let contrastNodes = 0;
  const contrastSamples = [];
  for (const p of html) {
    const v = p.axe && p.axe.violations && p.axe.violations.find((x) => x.id === "color-contrast");
    if (v && v.nodes) { contrastPages.push(path(p)); contrastNodes += v.nodes; if (v.sample) contrastSamples.push(v.sample); }
  }
  if (contrastNodes) out.push(count({ id: "a11y.contrast", category: "accessibility", severity: "warning", title: "Недостаточный контраст текста", detail: (n) => `Найдено ${n} элементов с низким контрастом текста к фону (замерено в браузере). Плохо читается при слабом зрении и на ярком свете.`, fix: "Повысьте контраст до ≥4.5:1 для обычного текста и ≥3:1 для крупного." }, contrastNodes, contrastPages, uniq(contrastSamples)));

  return out;
};

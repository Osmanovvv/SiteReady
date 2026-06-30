"use strict";

const { relPath, prevalence, htmlPages } = require("./util");

module.exports = function responsive(ctx) {
  const out = [];
  const html = htmlPages(ctx.pages);
  const path = (p) => relPath(p.url);

  const noViewport = html.filter((p) => !p.page.viewport).map(path);
  if (noViewport.length) out.push(prevalence({ id: "responsive.viewport.missing", category: "responsive", severity: "critical", title: "Нет meta viewport", detail: (n) => `На ${n} стр. отсутствует <meta name="viewport"> — сайт не адаптируется под мобильные.`, fix: 'Добавьте <meta name="viewport" content="width=device-width, initial-scale=1">.' }, noViewport));

  const noDeviceWidth = html.filter((p) => p.page.viewport && !/width\s*=\s*device-width/i.test(p.page.viewport)).map(path);
  if (noDeviceWidth.length) out.push(prevalence({ id: "responsive.viewport.device-width", category: "responsive", severity: "warning", title: "viewport без width=device-width", detail: (n) => `На ${n} стр. в meta viewport нет width=device-width.`, fix: "Добавьте width=device-width в meta viewport." }, noDeviceWidth));

  return out;
};

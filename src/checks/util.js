"use strict";

// Helpers shared by the five check modules. Findings match the CONTRACT issue
// shape (minus `penalty`, which score.js fills in).

const { URL } = require("url");

const MAX_AFFECTED = 20; // CONTRACT: affectedPages capped; full count in affectedCount

// Site-relative path used as the page identity everywhere (matches sample style).
function relPath(absUrl) {
  try {
    const u = new URL(absUrl);
    return (u.pathname || "/") + (u.search || "");
  } catch (_) {
    return absUrl;
  }
}

// prevalence finding: affectedCount = number of pages with the issue.
function prevalence(base, pagePaths, sample) {
  return {
    id: base.id,
    category: base.category,
    severity: base.severity,
    title: base.title,
    detail: typeof base.detail === "function" ? base.detail(pagePaths.length) : base.detail,
    fix: base.fix,
    mode: "prevalence",
    scored: base.scored !== false,
    affectedCount: pagePaths.length,
    affectedPages: pagePaths.slice(0, MAX_AFFECTED),
    sample: (sample || base.sample || []).slice(0, 5),
  };
}

// count finding: affectedCount = number of discrete defects (may exceed pages).
function count(base, defects, pagePaths, sample) {
  return {
    id: base.id,
    category: base.category,
    severity: base.severity,
    title: base.title,
    detail: typeof base.detail === "function" ? base.detail(defects) : base.detail,
    fix: base.fix,
    mode: "count",
    scored: base.scored !== false,
    affectedCount: defects,
    affectedPages: (pagePaths || []).slice(0, MAX_AFFECTED),
    sample: (sample || base.sample || []).slice(0, 5),
  };
}

// Only pages that returned HTML we could parse.
function htmlPages(pages) {
  return pages.filter((p) => p.page && p.status >= 200 && p.status < 300);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

module.exports = { relPath, prevalence, count, htmlPages, uniq, MAX_AFFECTED };

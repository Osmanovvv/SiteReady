"use strict";

// Scoring model (PLAN §6). Each finding penalizes exactly ONE category, capped by
// severity. Two penalty modes: prevalence (share of pages) and count (discrete
// defects, saturating at ~8). Category = clamp(0, 100 − Σ penalties). Overall =
// weighted average. Network-dependent perf signals are carried as scored:false.

const CAPS = { critical: 30, warning: 12, info: 4 };

const CATEGORIES = [
  { key: "seo", label: "SEO", weight: 0.3, confidence: "full", note: "" },
  { key: "tech", label: "Тех/QA", weight: 0.3, confidence: "full", note: "" },
  {
    key: "performance",
    label: "Производительность",
    weight: 0.18,
    confidence: "estimated",
    note: "Скоростные метрики (TTFB, время) оценочны — с точки замера, в балл не идут.",
  },
  {
    key: "accessibility",
    label: "Доступность",
    weight: 0.12,
    confidence: "static",
    note: "Проверено статически; контраст и клавиатурная навигация — в deep-режиме (Фаза 2).",
  },
  { key: "responsive", label: "Адаптивность", weight: 0.1, confidence: "full", note: "" },
];

function clamp(min, max, v) {
  return Math.max(min, Math.min(max, v));
}
function round1(v) {
  return Math.round(v * 10) / 10;
}

function gradeFromScore(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function penaltyFor(finding, analyzablePages) {
  if (finding.scored === false) return 0;
  const cap = CAPS[finding.severity] || 0;
  if (finding.mode === "count") {
    const perUnit = cap / 8; // ~8 defects saturate the cap
    return Math.min(cap, perUnit * finding.affectedCount);
  }
  // prevalence: share of ANALYZABLE (HTML) pages affected — 404/non-HTML pages
  // are not part of the denominator, so one bad page among errors still weighs full.
  const denom = Math.max(1, analyzablePages);
  return cap * Math.min(1, finding.affectedCount / denom);
}

// Computes the report `score` block and mutates each finding's `penalty` field.
function buildScore(findings, analyzablePages) {
  const acc = {};
  for (const c of CATEGORIES) acc[c.key] = { penalty: 0, counts: { critical: 0, warning: 0, info: 0 } };

  for (const f of findings) {
    const a = acc[f.category];
    if (!a) continue;
    f.penalty = round1(penaltyFor(f, analyzablePages));
    a.penalty += f.penalty;
    if (a.counts[f.severity] != null) a.counts[f.severity] += 1;
  }

  const categories = CATEGORIES.map((c) => {
    const score = clamp(0, 100, Math.round(100 - acc[c.key].penalty));
    return {
      key: c.key,
      label: c.label,
      score,
      grade: gradeFromScore(score),
      weight: c.weight,
      confidence: c.confidence,
      confidenceNote: c.note,
      issueCounts: acc[c.key].counts,
    };
  });

  const overall = Math.round(categories.reduce((s, c) => s + c.score * c.weight, 0));
  return { overall, grade: gradeFromScore(overall), categories };
}

module.exports = { buildScore, gradeFromScore, penaltyFor, CAPS, CATEGORIES };

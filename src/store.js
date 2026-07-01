"use strict";

// History store (PLAN-v2 §2). Zero-dependency: each audit is one JSON file under
// data/audits/<host>/<ISO>.json. Diff matches issues by id → fixed/added/unchanged,
// with overall + per-category score deltas. Credentials are scrubbed before write.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data", "audits");

function hostSlug(url) {
  let h;
  try { h = new URL(url).hostname; } catch (_) { h = String(url || "unknown"); }
  return h.replace(/^www\./i, "").toLowerCase().replace(/[^a-z0-9.-]/g, "_") || "unknown";
}

function isoSlug(iso) {
  return String(iso).replace(/[:.]/g, "-");
}

// Never persist auth material (Phase 5 adds cookie/headers) — strip any secrets.
function scrubReport(report) {
  const r = JSON.parse(JSON.stringify(report));
  if (r && r.meta) {
    delete r.meta.auth;
    delete r.meta.cookie;
    delete r.meta.headers;
  }
  return r;
}

// Resolve an id ("<host>/<isoSlug>") to a file path, refusing anything that escapes
// DATA_DIR (path-traversal guard).
function idToFile(id) {
  if (!id || typeof id !== "string") return null;
  const fp = path.normalize(path.join(DATA_DIR, id + ".json"));
  if (fp !== DATA_DIR && !fp.startsWith(DATA_DIR + path.sep)) return null;
  return fp;
}

async function saveAudit(report) {
  try {
    if (!report || !report.meta || !report.score) return null;
    const slug = hostSlug(report.meta.finalUrl || report.meta.startUrl);
    const iso = report.meta.generatedAt || new Date().toISOString();
    const dir = path.join(DATA_DIR, slug);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, isoSlug(iso) + ".json"), JSON.stringify(scrubReport(report)));
    return `${slug}/${isoSlug(iso)}`;
  } catch (_) {
    return null; // history is best-effort — never sink an audit
  }
}

function summarize(id, r) {
  return {
    id,
    url: r.meta.finalUrl || r.meta.startUrl,
    generatedAt: r.meta.generatedAt,
    overall: r.score.overall,
    grade: r.score.grade,
    mode: r.meta.mode || "static",
    issues: r.issues ? r.issues.length : 0,
  };
}

async function listHistory(url) {
  const slug = hostSlug(url);
  const dir = path.join(DATA_DIR, slug);
  let files;
  try { files = await fs.promises.readdir(dir); } catch (_) { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const r = JSON.parse(await fs.promises.readFile(path.join(dir, f), "utf8"));
      out.push(summarize(`${slug}/${f.replace(/\.json$/, "")}`, r));
    } catch (_) { /* skip unreadable */ }
  }
  out.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1)); // newest first
  return out;
}

async function getAudit(id) {
  const fp = idToFile(id);
  if (!fp) return null;
  try { return JSON.parse(await fs.promises.readFile(fp, "utf8")); } catch (_) { return null; }
}

function minIssue(i) {
  return { id: i.id, title: i.title, severity: i.severity, category: i.category, affectedCount: i.affectedCount, mode: i.mode };
}

// Diff of two reports (a = older, b = newer). Issues matched by id.
function diffReports(a, b) {
  const A = new Map((a.issues || []).map((i) => [i.id, i]));
  const B = new Map((b.issues || []).map((i) => [i.id, i]));
  const fixed = [];
  const added = [];
  let unchanged = 0;
  for (const [id, ia] of A) { if (B.has(id)) unchanged += 1; else fixed.push(minIssue(ia)); }
  for (const [id, ib] of B) { if (!A.has(id)) added.push(minIssue(ib)); }

  const CA = new Map((a.score.categories || []).map((c) => [c.key, c]));
  const categories = (b.score.categories || []).map((cb) => {
    const ca = CA.get(cb.key);
    return { key: cb.key, label: cb.label, before: ca ? ca.score : null, after: cb.score, delta: ca ? cb.score - ca.score : null };
  });

  return {
    a: { generatedAt: a.meta.generatedAt, overall: a.score.overall, grade: a.score.grade, mode: a.meta.mode || "static" },
    b: { generatedAt: b.meta.generatedAt, overall: b.score.overall, grade: b.score.grade, mode: b.meta.mode || "static" },
    url: b.meta.finalUrl || b.meta.startUrl,
    overallDelta: b.score.overall - a.score.overall,
    categories,
    fixed,
    added,
    unchangedCount: unchanged,
  };
}

module.exports = { saveAudit, listHistory, getAudit, diffReports, hostSlug, idToFile, DATA_DIR };

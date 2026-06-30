import type { Report } from "@/types/report";

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/**
 * Minimal structural guard for a Report parsed from an UNTRUSTED source
 * (the SSE backend or sessionStorage). TypeScript's `as Report` is erased at
 * runtime, so without this a shape that drifts from CONTRACT.md crashes deep in
 * render. We check exactly the shapes the UI dereferences and fail safe instead.
 */
export function isReport(x: unknown): x is Report {
  if (!isObj(x)) return false;

  const meta = x.meta;
  if (!isObj(meta)) return false;
  if (!isObj(meta.flags) || typeof (meta.flags as Record<string, unknown>).spa !== "boolean") return false;
  if (typeof meta.pagesCrawled !== "number" || typeof meta.pagesDiscovered !== "number") return false;

  if (typeof meta.finalUrl !== "string" || typeof meta.generatedAt !== "string") return false;

  const score = x.score;
  if (!isObj(score)) return false;
  if (typeof score.overall !== "number" || typeof score.grade !== "string" || !Array.isArray(score.categories)) return false;

  if (!Array.isArray(x.issues) || !Array.isArray(x.pages)) return false;

  return true;
}

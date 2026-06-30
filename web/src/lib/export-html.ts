import type { Report } from "@/types/report";
import { affectedLabel, categoryRu, formatDate, severityLabel } from "@/lib/format";

/**
 * Build a fully self-contained HTML document of the client report.
 * Inline styles only — no external CSS.
 */
export function buildStandaloneHtml(report: Report): string {
  const sevColor = { critical: "#dc2626", warning: "#d97706", info: "#2563eb" } as const;
  const gradeColor: Record<string, string> = {
    A: "#16a34a",
    B: "#16a34a",
    C: "#ca8a04",
    D: "#ea580c",
    F: "#dc2626",
  };
  // Untrusted report data: only ever emit a color from our own whitelist.
  const gc = (g: string): string => gradeColor[g] ?? "#6b7280";

  const counts = {
    critical: report.issues.filter((i) => i.severity === "critical").length,
    warning: report.issues.filter((i) => i.severity === "warning").length,
    info: report.issues.filter((i) => i.severity === "info").length,
  };

  const issuesBySeverity = (["critical", "warning", "info"] as const)
    .map((sev) => {
      const list = report.issues.filter((i) => i.severity === sev);
      if (!list.length) return "";
      return `
        <section style="margin: 32px 0;">
          <h2 style="font-size:18px;border-left:4px solid ${sevColor[sev]};padding-left:10px;margin:0 0 12px;">
            ${severityLabel(sev)} — ${list.length}
          </h2>
          ${list
            .map(
              (i) => `
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;gap:8px;">
                <strong>${escapeHtml(i.title)}</strong>
                <span style="color:#6b7280;font-size:12px;">${escapeHtml(categoryRu(i.category))} · ${escapeHtml(affectedLabel(i.mode, i.affectedCount))}</span>
              </div>
              <p style="margin:6px 0;color:#4b5563;font-size:14px;">${escapeHtml(i.detail)}</p>
              <div style="border-left:4px solid ${sevColor[sev]};background:#f9fafb;padding:10px;border-radius:6px;font-size:14px;">
                <strong>Что делать:</strong> ${escapeHtml(i.fix)}
              </div>
            </div>`
            )
            .join("")}
        </section>`;
    })
    .join("");

  const categories = report.score.categories
    .map(
      (c) => `
      <div style="display:flex;align-items:center;gap:10px;border:1px solid #e5e7eb;border-radius:8px;padding:10px;">
        <span style="flex:1;font-size:14px;">${escapeHtml(c.label)}</span>
        <span style="font-weight:600;">${Number(c.score) || 0}</span>
        <span style="display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:4px;font-size:12px;font-weight:700;color:white;background:${gc(c.grade)};">${escapeHtml(String(c.grade))}</span>
      </div>`
    )
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>SiteReady — отчёт ${escapeHtml(report.meta.finalUrl)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color:#0f172a; background:#f8fafc; margin:0; padding:24px; }
  .wrap { max-width: 880px; margin: 0 auto; background:white; border:1px solid #e5e7eb; border-radius:16px; padding:36px; }
  h1 { margin: 0 0 8px; font-size: 26px; }
  .muted { color:#6b7280; font-size: 14px; }
  .summary { display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; margin: 24px 0; }
  .summary > div { border:1px solid #e5e7eb; border-radius:10px; padding:14px; }
  .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
  .score-big { font-size: 44px; font-weight: 700; }
  footer { text-align:center; color:#9ca3af; font-size:12px; border-top:1px solid #e5e7eb; padding-top:16px; margin-top:24px; }
</style>
</head>
<body>
  <div class="wrap">
    <div style="display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #e5e7eb;padding-bottom:20px;">
      <div>
        <div style="display:inline-flex;width:44px;height:44px;align-items:center;justify-content:center;border-radius:10px;background:#1d4ed8;color:white;font-weight:700;margin-bottom:10px;">SR</div>
        <h1>Аудит сайта</h1>
        <div class="muted"><strong style="color:#0f172a;">${escapeHtml(report.meta.finalUrl)}</strong></div>
        <div class="muted">Отчёт сформирован: ${escapeHtml(formatDate(report.meta.generatedAt))}</div>
        <div class="muted">Просканировано ${Number(report.meta.pagesCrawled) || 0} из ${Number(report.meta.pagesDiscovered) || 0} страниц</div>
      </div>
      <div style="text-align:center;">
        <div class="score-big" style="color:${gc(report.score.grade)};">${Number(report.score.overall) || 0}</div>
        <div style="display:inline-block;padding:2px 8px;border-radius:6px;color:white;font-weight:700;background:${gc(report.score.grade)};">${escapeHtml(String(report.score.grade))}</div>
        <div class="muted" style="margin-top:4px;">из 100</div>
      </div>
    </div>

    <div class="summary">
      <div><div class="muted">Критично</div><div class="score-big" style="color:${sevColor.critical};font-size:30px;">${counts.critical}</div></div>
      <div><div class="muted">Важно</div><div class="score-big" style="color:${sevColor.warning};font-size:30px;">${counts.warning}</div></div>
      <div><div class="muted">Инфо</div><div class="score-big" style="color:${sevColor.info};font-size:30px;">${counts.info}</div></div>
    </div>

    <h2 style="font-size:16px;margin:0 0 10px;">Оценки по разделам</h2>
    <div class="grid2">${categories}</div>

    ${issuesBySeverity}

    <footer>Сделано в SiteReady</footer>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function downloadHtml(report: Report) {
  const html = buildStandaloneHtml(report);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = report.meta.finalUrl.replace(/[^a-z0-9.-]+/gi, "_").slice(0, 60);
  a.download = `siteready-${safe}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

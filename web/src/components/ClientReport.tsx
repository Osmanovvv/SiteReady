import { ScoreDial } from "@/components/ScoreDial";
import { affectedLabel, categoryRu, formatDate, gradeColor, severityColor, severityLabel } from "@/lib/format";
import type { Report, Severity } from "@/types/report";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

const ICONS = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const ORDER: Severity[] = ["critical", "warning", "info"];

export function ClientReport({ report }: { report: Report }) {
  const counts = {
    critical: report.issues.filter((i) => i.severity === "critical").length,
    warning: report.issues.filter((i) => i.severity === "warning").length,
    info: report.issues.filter((i) => i.severity === "info").length,
  };

  return (
    <article className="print-area max-w-4xl mx-auto bg-card rounded-2xl border shadow-sm p-5 sm:p-8 lg:p-10 print:shadow-none print:border-0 print:p-0">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6 pb-6 border-b">
        <div className="min-w-0">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground font-bold text-lg mb-3">
            SR
          </div>
          <h1 className="text-2xl font-bold">Аудит сайта</h1>
          <div className="mt-2 text-sm text-muted-foreground">
            <div className="font-medium text-foreground break-all">{report.meta.finalUrl}</div>
            <div>Отчёт сформирован: {formatDate(report.meta.generatedAt)}</div>
            <div>
              Просканировано {report.meta.pagesCrawled} из {report.meta.pagesDiscovered} страниц
            </div>
          </div>
        </div>
        <ScoreDial score={report.score.overall} grade={report.score.grade} size={140} label="Итог" />
      </header>

      {/* Summary */}
      <section className="grid grid-cols-3 gap-3 sm:gap-4 my-6 sm:my-8">
        {ORDER.map((sev) => {
          const Icon = ICONS[sev];
          return (
            <div key={sev} className="rounded-xl border p-3 sm:p-4">
              <div className="flex items-center gap-1.5 text-[10px] sm:text-xs uppercase tracking-wide text-muted-foreground min-w-0">
                <Icon aria-hidden="true" className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" style={{ color: severityColor(sev) }} />
                <span className="truncate">{severityLabel(sev)}</span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold tabular-nums mt-2" style={{ color: severityColor(sev) }}>
                {counts[sev]}
              </div>
            </div>
          );
        })}
      </section>

      {/* Categories summary */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Оценки по разделам</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {report.score.categories.map((c) => (
            <div key={c.key} className="flex items-center gap-3 rounded-lg border p-3">
              <span className="flex-1 min-w-0 truncate text-sm" title={c.label}>{c.label}</span>
              <span className="text-sm tabular-nums font-semibold">{c.score}</span>
              <span className="inline-flex shrink-0 w-6 h-6 items-center justify-center rounded text-xs font-bold text-white"
                    style={{ backgroundColor: gradeColor(c.grade) }}>
                {c.grade}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Issues */}
      {ORDER.map((sev) => {
        const list = report.issues.filter((i) => i.severity === sev);
        if (!list.length) return null;
        const Icon = ICONS[sev];
        return (
          <section key={sev} className="mb-8">
            <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
              <Icon aria-hidden="true" className="w-5 h-5" style={{ color: severityColor(sev) }} />
              {severityLabel(sev)} — {list.length}
            </h2>
            <div className="space-y-4">
              {list.map((issue) => (
                <div key={issue.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <h3 className="font-semibold">{issue.title}</h3>
                    <span className="text-xs text-muted-foreground">
                      {categoryRu(issue.category)} · {affectedLabel(issue.mode, issue.affectedCount)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{issue.detail}</p>
                  <div
                    className="mt-3 rounded border-l-4 bg-muted/40 p-3 text-sm"
                    style={{ borderColor: severityColor(sev) }}
                  >
                    <span className="font-medium">Что делать: </span>
                    {issue.fix}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <footer className="pt-6 mt-8 border-t text-center text-xs text-muted-foreground">
        Сделано в SiteReady
      </footer>
    </article>
  );
}

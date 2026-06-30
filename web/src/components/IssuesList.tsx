import { useState } from "react";
import { affectedLabel, categoryRu, severityColor, severityLabel } from "@/lib/format";
import type { Issue, Severity } from "@/types/report";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Info } from "lucide-react";

const ICONS: Record<Severity, typeof AlertCircle> = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

interface Props {
  issues: Issue[];
}

export function IssuesList({ issues }: Props) {
  const [filter, setFilter] = useState<Severity | "all">("all");

  if (issues.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-3">
          <CheckCircle2 aria-hidden="true" className="w-6 h-6" style={{ color: "var(--color-grade-good)" }} />
        </div>
        <h3 className="text-base font-semibold">Проблем не найдено</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Аудит не выявил проблем на проверенных страницах — отличный результат.
        </p>
      </div>
    );
  }

  const filtered = filter === "all" ? issues : issues.filter((i) => i.severity === filter);

  const counts = {
    all: issues.length,
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  };

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 p-4 border-b">
        <h3 className="text-base font-semibold mr-auto">Проблемы</h3>
        {(["all", "critical", "warning", "info"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === s ? "bg-foreground text-background" : "bg-muted hover:bg-accent"
            }`}
          >
            {s !== "all" && (
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: severityColor(s) }} />
            )}
            {s === "all" ? "Все" : severityLabel(s)}
            <span className="tabular-nums opacity-70">{counts[s]}</span>
          </button>
        ))}
      </div>
      <ul className="divide-y">
        {filtered.map((issue) => (
          <IssueRow key={issue.id} issue={issue} />
        ))}
        {filtered.length === 0 && (
          <li className="p-8 text-center text-sm text-muted-foreground">Нет проблем этого уровня.</li>
        )}
      </ul>
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[issue.severity];
  const color = severityColor(issue.severity);

  return (
    <li>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
      >
        <Icon aria-hidden="true" className="w-5 h-5 mt-0.5 shrink-0" style={{ color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{issue.title}</span>
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {categoryRu(issue.category)}
            </span>
            {!issue.scored && (
              <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground">
                информативно
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-1 line-clamp-1">{issue.detail}</div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-semibold text-foreground tabular-nums">
            {affectedLabel(issue.mode, issue.affectedCount)}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-5 pl-12 grid gap-4">
          <p className="text-sm">{issue.detail}</p>
          {issue.affectedPages.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Затронутые страницы
              </div>
              <div className="flex flex-wrap gap-1.5">
                {issue.affectedPages.map((p) => (
                  <code key={p} className="text-xs rounded bg-muted px-1.5 py-0.5">
                    {p}
                  </code>
                ))}
                {issue.mode === "prevalence" && issue.affectedCount > issue.affectedPages.length && (
                  <span className="text-xs text-muted-foreground">
                    и ещё {issue.affectedCount - issue.affectedPages.length}…
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="rounded-lg border-l-4 bg-muted/50 p-3" style={{ borderColor: color }}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Как починить</div>
            <p className="text-sm">{issue.fix}</p>
          </div>
          {issue.sample.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Примеры</div>
              <ul className="text-xs space-y-1">
                {issue.sample.map((s, i) => (
                  <li key={i} className="font-mono bg-muted rounded px-2 py-1">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

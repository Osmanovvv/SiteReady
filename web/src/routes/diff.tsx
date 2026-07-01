import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { fetchDiff, type DiffResult } from "@/lib/api";
import { gradeColor, formatDate, severityColor, categoryRu } from "@/lib/format";
import type { Grade, Severity } from "@/types/report";
import { ArrowLeft, ArrowRight } from "lucide-react";

interface Search {
  a: string;
  b: string;
}

export const Route = createFileRoute("/diff")({
  validateSearch: (s: Record<string, unknown>): Search => ({ a: String(s.a ?? ""), b: String(s.b ?? "") }),
  head: () => ({ meta: [{ title: "Сравнение аудитов — SiteReady" }] }),
  component: DiffPage,
});

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-xs text-muted-foreground">новая</span>;
  const color = delta > 0 ? "var(--color-grade-good)" : delta < 0 ? "var(--color-grade-bad)" : "var(--color-muted-foreground)";
  return (
    <span className="font-semibold tabular-nums" style={{ color }}>
      {delta > 0 ? "+" : ""}
      {delta}
    </span>
  );
}

function RunBadge({ run, label }: { run: DiffResult["a"]; label: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2 mt-0.5">
        <span
          className="inline-flex w-8 h-8 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: gradeColor(run.grade as Grade) }}
        >
          {run.grade}
        </span>
        <span className="text-xl font-bold tabular-nums">{run.overall}</span>
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">
        {formatDate(run.generatedAt)}
        {run.mode === "deep" ? " · deep" : ""}
      </div>
    </div>
  );
}

function IssueList({ title, items, tone, empty }: { title: string; items: DiffResult["fixed"]; tone: "good" | "bad"; empty: string }) {
  const color = tone === "good" ? "var(--color-grade-good)" : "var(--color-grade-bad)";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <h3 className="text-sm font-semibold">
          {title} — {items.length}
        </h3>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.id} className="text-sm flex items-baseline gap-2">
              <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: severityColor(i.severity as Severity) }} />
              <span className="flex-1 min-w-0">{i.title}</span>
              <span className="text-[11px] text-muted-foreground shrink-0">{categoryRu(i.category)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Shell({ children, backUrl }: { children: ReactNode; backUrl?: string }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-4xl mx-auto flex items-center gap-4 px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="w-4 h-4" /> Новый аудит
          </Link>
          {backUrl && (
            <Link to="/history" search={{ url: backUrl }} className="text-sm text-muted-foreground hover:text-foreground">
              ← К истории
            </Link>
          )}
        </div>
      </header>
      <main id="content" tabIndex={-1} className="max-w-4xl mx-auto px-6 py-8 outline-none">
        <h1 className="text-2xl font-bold mb-6">Сравнение аудитов</h1>
        {children}
      </main>
    </div>
  );
}

function DiffPage() {
  const { a, b } = Route.useSearch();
  const [state, setState] = useState<"loading" | "error" | DiffResult>("loading");

  useEffect(() => {
    setState("loading");
    fetchDiff(a, b).then((d) => setState(d ?? "error"));
  }, [a, b]);

  if (state === "loading") return <Shell><p className="text-sm text-muted-foreground">Загрузка…</p></Shell>;
  if (state === "error")
    return (
      <Shell>
        <p className="text-sm text-destructive">Не удалось загрузить сравнение. Возможно, один из прогонов был удалён.</p>
      </Shell>
    );

  const d = state;
  return (
    <Shell backUrl={d.url}>
      <section className="rounded-2xl border bg-card p-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground break-all">{d.url}</div>
        <div className="mt-4 flex items-center gap-4 flex-wrap">
          <RunBadge run={d.a} label="Было" />
          <ArrowRight aria-hidden="true" className="w-5 h-5 text-muted-foreground" />
          <RunBadge run={d.b} label="Стало" />
          <div className="ml-auto text-right">
            <div className="text-xs text-muted-foreground">Δ общего балла</div>
            <div className="text-2xl">
              <DeltaBadge delta={d.overallDelta} />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold mb-3">По категориям</h2>
        <div className="rounded-xl border bg-card divide-y">
          {d.categories.map((c) => (
            <div key={c.key} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="flex-1 min-w-0 truncate">{c.label}</span>
              <span className="tabular-nums text-muted-foreground w-8 text-right">{c.before ?? "—"}</span>
              <ArrowRight aria-hidden="true" className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="tabular-nums font-semibold w-8 text-right">{c.after ?? "—"}</span>
              <span className="w-12 text-right">
                <DeltaBadge delta={c.delta} />
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <IssueList title="Закрыто" items={d.fixed} tone="good" empty="Ничего не закрыто" />
        <IssueList title="Появилось" items={d.added} tone="bad" empty="Новых проблем нет" />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">Осталось без изменений: {d.unchangedCount}.</p>
    </Shell>
  );
}

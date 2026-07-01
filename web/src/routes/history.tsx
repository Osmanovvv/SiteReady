import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchHistory, type HistoryRun } from "@/lib/api";
import { gradeColor, formatDate } from "@/lib/format";
import type { Grade } from "@/types/report";
import { ArrowLeft } from "lucide-react";

interface Search {
  url: string;
}

export const Route = createFileRoute("/history")({
  validateSearch: (s: Record<string, unknown>): Search => ({ url: String(s.url ?? "") }),
  head: () => ({ meta: [{ title: "История аудитов — SiteReady" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const { url } = Route.useSearch();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<HistoryRun[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setRuns(null);
    fetchHistory(url).then(setRuns);
  }, [url]);

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : [cur[1], id]));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-4xl mx-auto flex items-center gap-3 px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="w-4 h-4" /> Новый аудит
          </Link>
        </div>
      </header>

      <main id="content" tabIndex={-1} className="max-w-4xl mx-auto px-6 py-8 outline-none">
        <h1 className="text-2xl font-bold">История аудитов</h1>
        <p className="mt-1 text-sm text-muted-foreground break-all">{url}</p>

        {runs === null ? (
          <p className="mt-8 text-sm text-muted-foreground">Загрузка…</p>
        ) : runs.length === 0 ? (
          <div className="mt-8 rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            Пока нет сохранённых прогонов для этого адреса. Запустите аудит — он появится здесь.
          </div>
        ) : (
          <>
            <p className="mt-6 text-sm text-muted-foreground">
              Выберите два прогона для сравнения ({selected.length}/2).
            </p>
            <ul className="mt-3 space-y-2">
              {runs.map((r) => {
                const on = selected.includes(r.id);
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => toggle(r.id)}
                      aria-pressed={on}
                      className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                        on ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                      }`}
                    >
                      <span
                        className="inline-flex w-9 h-9 items-center justify-center rounded-lg text-sm font-bold text-white shrink-0"
                        style={{ backgroundColor: gradeColor(r.grade as Grade) }}
                      >
                        {r.grade}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold tabular-nums">{r.overall} / 100</span>
                        <span className="block text-xs text-muted-foreground">{formatDate(r.generatedAt)}</span>
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {r.mode === "deep" ? "deep · " : ""}
                        {r.issues} проблем
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6">
              <button
                disabled={selected.length !== 2}
                onClick={() => navigate({ to: "/diff", search: { a: selected[0], b: selected[1] } })}
                className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Сравнить выбранные
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

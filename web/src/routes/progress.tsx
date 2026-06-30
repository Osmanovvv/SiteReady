import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { startAudit } from "@/lib/api";
import { saveReport } from "@/lib/report-store";
import { Check, Loader2 } from "lucide-react";

interface Search {
  url: string;
  limit?: number;
  checkExternal?: boolean;
  allowLocal?: boolean;
}

export const Route = createFileRoute("/progress")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    url: String(s.url ?? ""),
    limit: s.limit != null ? Number(s.limit) : undefined,
    checkExternal: s.checkExternal === true || s.checkExternal === "true",
    allowLocal: s.allowLocal === true || s.allowLocal === "true",
  }),
  head: () => ({ meta: [{ title: "Анализируем сайт — SiteReady" }] }),
  component: ProgressPage,
});

const PHASES = ["Обход", "Проверка ссылок", "Анализ", "Готово"] as const;

function ProgressPage() {
  const { url, limit, checkExternal, allowLocal } = Route.useSearch();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<string>("Обход");
  const [pagesCrawled, setPagesCrawled] = useState(0);
  const [pagesDiscovered, setPagesDiscovered] = useState(0);
  const [currentUrl, setCurrentUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const maxPctRef = useRef(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!url) {
      navigate({ to: "/" });
      return;
    }
    setError(null);
    setErrorCode(undefined);
    maxPctRef.current = 0; // reset the monotonic clamp for a fresh audit
    let doneTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = startAudit({ url, limit, checkExternal, allowLocal }, (ev) => {
      if (ev.type === "meta") setPagesDiscovered(ev.pagesDiscovered);
      else if (ev.type === "progress") {
        setPhase(ev.phase);
        setPagesCrawled(ev.pagesCrawled);
        setPagesDiscovered(ev.pagesDiscovered);
        if (ev.currentUrl) setCurrentUrl(ev.currentUrl);
      } else if (ev.type === "done") {
        setPhase("Готово");
        setPagesCrawled(ev.report.meta.pagesCrawled);
        setPagesDiscovered(ev.report.meta.pagesDiscovered);
        saveReport(ev.report);
        doneTimer = setTimeout(() => navigate({ to: "/report" }), 400);
      } else if (ev.type === "error") {
        setError(ev.message);
        setErrorCode(ev.code);
      }
    });
    return () => {
      stop();
      if (doneTimer) clearTimeout(doneTimer);
    };
  }, [url, limit, checkExternal, allowLocal, navigate]);

  const phaseIndex = PHASES.indexOf(phase as (typeof PHASES)[number]);
  // Progress tracks phase progression, NOT crawl coverage: a sampled crawl covers
  // only a fraction of discovered pages, yet the bar must still reach 100% on done.
  const crawlDenom = limit || pagesDiscovered || 0;
  const rawPct =
    phase === "Готово"
      ? 100
      : phaseIndex < 0
      ? 5
      : Math.min(
          95,
          Math.round(
            phaseIndex * 25 +
              (phase === "Обход" && crawlDenom ? Math.min(1, pagesCrawled / crawlDenom) * 25 : 25),
          ),
        );
  // Never let the bar regress: with no page limit the denominator is the growing
  // pagesDiscovered, so the raw fraction can dip — clamp to the max seen so far.
  maxPctRef.current = Math.max(maxPctRef.current, rawPct);
  const totalPct = maxPctRef.current;

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-16 bg-background">
      <div id="content" tabIndex={-1} className="w-full max-w-xl outline-none">
        <div className="rounded-2xl border bg-card p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-1">
            <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin text-primary" />
            <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
              Анализируем сайт
            </h1>
          </div>
          <p className="text-sm text-muted-foreground break-all">{url}</p>

          {error ? (
            <div className="mt-6 space-y-3">
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
              >
                {error}
              </div>
              <div className="flex flex-wrap gap-2">
                {errorCode === "PRIVATE_BLOCKED" && (
                  <button
                    onClick={() =>
                      navigate({ to: "/progress", search: { url, limit, checkExternal, allowLocal: true } })
                    }
                    className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Разрешить локальные адреса
                  </button>
                )}
                <button
                  onClick={() => navigate({ to: "/" })}
                  className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  Изменить адрес
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                className="mt-6 h-2 rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-valuenow={totalPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Прогресс аудита"
              >
                <div
                  className="h-full bg-primary"
                  style={{ width: `${totalPct}%`, transition: "width 400ms ease" }}
                />
              </div>
              <div
                className="mt-2 flex justify-between text-xs text-muted-foreground tabular-nums"
                role="status"
                aria-live="polite"
              >
                <span>Просканировано {pagesCrawled} из {pagesDiscovered || "—"}</span>
                <span>{totalPct}%</span>
              </div>

              <ol className="mt-6 space-y-2">
                {PHASES.map((p, i) => {
                  const done = i < phaseIndex || phase === "Готово";
                  const active = i === phaseIndex && phase !== "Готово";
                  return (
                    <li key={p} className="flex items-center gap-3 text-sm">
                      <span
                        className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-medium ${
                          done
                            ? "bg-primary text-primary-foreground"
                            : active
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {done ? <Check aria-hidden="true" className="w-3.5 h-3.5" /> : i + 1}
                      </span>
                      <span className={active ? "font-medium" : done ? "" : "text-muted-foreground"}>
                        {p}
                      </span>
                      {done && <span className="sr-only"> — готово</span>}
                      {active && (
                        <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin text-primary ml-1" />
                      )}
                    </li>
                  );
                })}
              </ol>

              {currentUrl && (
                <div className="mt-6 text-xs text-muted-foreground truncate">
                  Текущая страница: <code className="font-mono">{currentUrl}</code>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

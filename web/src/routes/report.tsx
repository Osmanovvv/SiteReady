import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScoreDial } from "@/components/ScoreDial";
import { CategoryCard } from "@/components/CategoryCard";
import { IssuesList } from "@/components/IssuesList";
import { PagesTable } from "@/components/PagesTable";
import { ClientReport } from "@/components/ClientReport";
import { loadStoredReport } from "@/lib/report-store";
import { downloadHtml } from "@/lib/export-html";
import { formatDuration } from "@/lib/format";
import type { Report } from "@/types/report";
import { ArrowLeft, Download, Printer, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/report")({
  head: () => ({ meta: [{ title: "Отчёт — SiteReady" }] }),
  component: ReportPage,
});

type View = "quick" | "client";

function ReportPage() {
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [view, setView] = useState<View>("quick");
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const r = loadStoredReport();
    if (!r) {
      navigate({ to: "/" });
      return;
    }
    setReport(r);
  }, [navigate]);

  useEffect(() => {
    if (report) mainRef.current?.focus();
  }, [report]);

  if (!report) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="no-print sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 px-6 py-3">
          <Link
            to="/"
            aria-label="Новый аудит"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="w-4 h-4" />
            <span className="hidden sm:inline">Новый аудит</span>
          </Link>

          <div className="inline-flex rounded-lg bg-muted p-1">
            <button
              onClick={() => setView("quick")}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                view === "quick" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
              }`}
            >
              Быстрый вид
            </button>
            <button
              onClick={() => setView("client")}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                view === "client" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
              }`}
            >
              Клиентский отчёт
            </button>
          </div>

          {view === "client" ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" aria-label="Скачать HTML" onClick={() => downloadHtml(report)}>
                <Download aria-hidden="true" className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">HTML</span>
              </Button>
              <Button size="sm" aria-label="Печать в PDF" onClick={() => window.print()}>
                <Printer aria-hidden="true" className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">PDF</span>
              </Button>
            </div>
          ) : (
            <div className="w-[88px]" />
          )}
        </div>
      </header>

      <main ref={mainRef} id="content" tabIndex={-1} className="max-w-6xl mx-auto px-6 py-8 outline-none">
        {view === "quick" ? (
          <>
            <div className="no-print">
              <QuickView report={report} />
            </div>
            {/* Ctrl+P from Quick view still prints the clean client report */}
            <div className="hidden print:block">
              <ClientReport report={report} />
            </div>
          </>
        ) : (
          <ClientReport report={report} />
        )}
      </main>
    </div>
  );
}

function QuickView({ report }: { report: Report }) {
  return (
    <div className="space-y-8">
      <section className="grid md:grid-cols-[auto_1fr] gap-8 items-start rounded-2xl border bg-card p-6">
        <ScoreDial score={report.score.overall} grade={report.score.grade} />
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Аудит сайта</div>
            <div className="text-xl font-semibold break-all">{report.meta.finalUrl}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {report.meta.mode === "deep" && (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                отрендерено браузером
              </span>
            )}
            {report.meta.sampled && (
              <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs">
                выборка: {report.meta.pagesCrawled} из {report.meta.pagesDiscovered}
              </span>
            )}
            <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs">
              длительность: {formatDuration(report.meta.durationMs)}
            </span>
          </div>
          <Link
            to="/history"
            search={{ url: report.meta.finalUrl }}
            className="no-print text-sm text-primary hover:underline w-fit"
          >
            История аудитов этого адреса →
          </Link>
          {report.meta.flags.spa && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
              <span>
                Сайт рендерится на клиенте — статический аудит ограничен. Для полной проверки нужен deep-режим.
              </span>
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Категории</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {report.score.categories.map((c) => (
            <CategoryCard key={c.key} c={c} />
          ))}
        </div>
      </section>

      <section>
        <IssuesList issues={report.issues} />
      </section>

      <section>
        <PagesTable pages={report.pages} />
      </section>
    </div>
  );
}

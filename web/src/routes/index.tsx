import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, Gauge, ShieldCheck, Sparkles } from "lucide-react";
import { isMockMode, fetchCapabilities } from "@/lib/api";
import { clearReport } from "@/lib/report-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SiteReady — аудит сайта под ключ" },
      {
        name: "description",
        content:
          "Введите URL и получите готовый отчёт об аудите: SEO, тех/QA, скорость, доступность и адаптивность.",
      },
    ],
  }),
  component: StartPage,
});

function StartPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [limit, setLimit] = useState(50);
  const [checkExternal, setCheckExternal] = useState(false);
  const [allowLocal, setAllowLocal] = useState(false);
  const [deep, setDeep] = useState(false);
  const [deepAvailable, setDeepAvailable] = useState<boolean | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    fetchCapabilities().then((c) => setDeepAvailable(c.deep));
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const safeLimit = Number.isFinite(limit) && limit >= 1 ? Math.min(500, Math.floor(limit)) : 50;
    clearReport();
    navigate({
      to: "/progress",
      search: { url: normalized, limit: safeLimit, checkExternal, allowLocal, deep: deep && deepAvailable !== false },
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold text-sm">
              SR
            </div>
            <span className="font-semibold">SiteReady</span>
          </div>
          {isMockMode() && (
            <span className="text-xs rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
              мок-данные
            </span>
          )}
        </div>
      </header>

      <main id="content" className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-10">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-4xl md:text-5xl font-bold tracking-tight outline-none"
            >
              Аудит сайта <span className="text-primary">под ключ</span>
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              SEO, тех/QA, производительность, доступность и адаптивность — один понятный отчёт.
            </p>
          </div>

          <form onSubmit={onSubmit} className="rounded-2xl border bg-card shadow-sm p-6">
            <Label htmlFor="url" className="text-sm font-medium">
              Адрес сайта
            </Label>
            <div className="mt-2 flex flex-col sm:flex-row gap-2">
              <Input
                id="url"
                type="text"
                placeholder="example.ru"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1 h-12 text-base"
                autoFocus
              />
              <Button type="submit" className="h-12 px-6 text-base">
                Проверить
              </Button>
            </div>

            <button
              type="button"
              onClick={() => setShowOptions((s) => !s)}
              aria-expanded={showOptions}
              className="mt-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronDown
                aria-hidden="true"
                className={`w-4 h-4 transition-transform ${showOptions ? "rotate-180" : ""}`}
              />
              Дополнительные опции
            </button>

            {showOptions && (
              <div className="mt-4 grid gap-4 rounded-lg bg-muted/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label htmlFor="deep" className="text-sm">
                      Глубокий режим
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {deepAvailable === false
                        ? "Недоступно на этом сервере — не установлен браузер (npm i playwright && npx playwright install chromium)."
                        : "Рендер в реальном браузере — точнее для SPA (React/Vue), но медленнее."}
                    </p>
                  </div>
                  <Switch
                    id="deep"
                    checked={deep && deepAvailable !== false}
                    onCheckedChange={setDeep}
                    disabled={deepAvailable === false}
                    className="mt-0.5 shrink-0"
                  />
                </div>
                <div>
                  <Label htmlFor="limit" className="text-sm">
                    Лимит страниц
                  </Label>
                  <Input
                    id="limit"
                    type="number"
                    min={1}
                    max={500}
                    value={Number.isNaN(limit) ? "" : limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    className="mt-1 max-w-[140px]"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="ext" className="text-sm">
                    Проверять внешние ссылки
                  </Label>
                  <Switch id="ext" checked={checkExternal} onCheckedChange={setCheckExternal} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="local" className="text-sm">
                    Разрешить локальные адреса
                  </Label>
                  <Switch id="local" checked={allowLocal} onCheckedChange={setAllowLocal} />
                </div>
              </div>
            )}
          </form>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            {[
              { Icon: Sparkles, t: "Понятные рекомендации" },
              { Icon: Gauge, t: "5 направлений в одном отчёте" },
              { Icon: ShieldCheck, t: "Готово к клиенту: PDF и HTML" },
            ].map(({ Icon, t }) => (
              <div key={t} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
                <Icon className="w-4 h-4 text-primary shrink-0" />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

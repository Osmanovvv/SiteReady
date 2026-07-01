import type { Report } from "@/types/report";
import { isReport } from "@/lib/validate";
import { errorText } from "@/lib/errors";

export interface AuditOptions {
  url: string;
  limit?: number;
  checkExternal?: boolean;
  allowLocal?: boolean;
  deep?: boolean;
  token?: string; // one-time session token (auth flow) — replaces url/params in the SSE
  auth?: { cookie?: string; headers?: Record<string, string> };
}

export type ProgressEvent =
  | { type: "meta"; pagesDiscovered: number }
  | { type: "progress"; phase: string; pagesCrawled: number; pagesDiscovered: number; currentUrl?: string }
  | { type: "done"; report: Report }
  | { type: "error"; code?: string; message: string };

// Real backend is used when VITE_API_BASE is DEFINED (even as ""). An empty value
// means "same origin" — the engine serves this SPA and the API together.
const API_BASE = import.meta.env.VITE_API_BASE as string | undefined;
function useRealBackend(): boolean {
  return API_BASE !== undefined;
}
function streamBase(): string {
  return API_BASE && API_BASE.length ? API_BASE : window.location.origin;
}

/**
 * Streams audit progress. Real SSE when a backend is configured; otherwise the
 * animated mock from /sample-report.json.
 */
export function startAudit(opts: AuditOptions, onEvent: (e: ProgressEvent) => void): () => void {
  if (useRealBackend()) {
    const u = new URL("/api/audit/stream", streamBase());
    if (opts.token) {
      // Auth flow: everything (incl. credentials) is stashed server-side behind the
      // token; nothing sensitive goes in the URL.
      u.searchParams.set("token", opts.token);
    } else {
      u.searchParams.set("url", opts.url);
      if (opts.limit != null) u.searchParams.set("limit", String(opts.limit));
      if (opts.checkExternal != null) u.searchParams.set("checkExternal", String(opts.checkExternal));
      if (opts.allowLocal != null) u.searchParams.set("allowLocal", String(opts.allowLocal));
      if (opts.deep != null) u.searchParams.set("deep", String(opts.deep));
    }

    const es = new EventSource(u.toString());
    es.addEventListener("meta", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        onEvent({ type: "meta", pagesDiscovered: data.pagesDiscovered ?? 0 });
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("progress", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        onEvent({ type: "progress", ...data });
      } catch {
        /* ignore */
      }
    });
    let settled = false;
    const finish = () => {
      settled = true;
      es.close();
    };

    es.addEventListener("done", (ev) => {
      if (settled) return;
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (isReport(data)) {
          onEvent({ type: "done", report: data });
        } else {
          onEvent({ type: "error", message: "Сервер вернул отчёт в неожиданном формате" });
        }
      } catch (e) {
        console.error(e);
        onEvent({ type: "error", message: "Не удалось обработать ответ сервера." });
      } finally {
        finish();
      }
    });

    // The server's named `error` event is a MessageEvent WITH data ({code, message}).
    // A transport-level drop fires a plain Event with no data. We terminate on it
    // rather than let EventSource auto-reconnect: the engine runs a fresh audit per
    // connection (reconnect would restart, not resume) and a client disconnect
    // already aborts the server-side crawl.
    es.addEventListener("error", (ev) => {
      if (settled) return;
      const raw = (ev as MessageEvent).data as string | undefined;
      if (raw) {
        let code: string | undefined;
        let serverMessage: string | undefined;
        try {
          const d = JSON.parse(raw);
          code = d.code;
          serverMessage = d.message;
        } catch {
          /* keep undefined */
        }
        onEvent({ type: "error", code, message: errorText(code, serverMessage) });
      } else {
        onEvent({ type: "error", message: errorText(null) });
      }
      finish();
    });

    return () => finish();
  }

  // Mock path: animate phases, then load sample-report.json
  let cancelled = false;
  const phases = [
    { phase: "Обход", duration: 1400 },
    { phase: "Проверка ссылок", duration: 1100 },
    { phase: "Анализ", duration: 1200 },
  ];

  (async () => {
    const res = await fetch("/sample-report.json");
    const parsed = await res.json();
    if (cancelled) return;
    if (!isReport(parsed)) {
      onEvent({ type: "error", message: "Не удалось загрузить демо-отчёт" });
      return;
    }
    const report = parsed;

    const total = report.meta.pagesDiscovered || 50;
    onEvent({ type: "meta", pagesDiscovered: total });

    let crawled = 0;
    const samplePages =
      report.pages.map((p) => p.url).concat(["/blog", "/contacts", "/gallery", "/docs", "/catalog/b"]);

    for (const { phase, duration } of phases) {
      const steps = 12;
      const stepMs = duration / steps;
      for (let i = 0; i < steps; i++) {
        if (cancelled) return;
        crawled = Math.min(report.meta.pagesCrawled, crawled + Math.ceil(report.meta.pagesCrawled / (phases.length * steps)));
        const currentUrl = samplePages[(i + phase.length) % samplePages.length];
        onEvent({
          type: "progress",
          phase,
          pagesCrawled: crawled,
          pagesDiscovered: total,
          currentUrl,
        });
        await new Promise((r) => setTimeout(r, stepMs));
      }
    }
    if (cancelled) return;
    onEvent({ type: "done", report });
  })().catch((e) => {
    console.error(e);
    if (!cancelled) onEvent({ type: "error", message: errorText(null) });
  });

  return () => {
    cancelled = true;
  };
}

export function isMockMode(): boolean {
  return !useRealBackend();
}

export interface HistoryRun {
  id: string;
  url: string;
  generatedAt: string;
  overall: number;
  grade: string;
  mode: "static" | "deep";
  issues: number;
}

export interface DiffIssue {
  id: string;
  title: string;
  severity: string;
  category: string;
}

export interface DiffResult {
  a: { generatedAt: string; overall: number; grade: string; mode: string };
  b: { generatedAt: string; overall: number; grade: string; mode: string };
  url: string;
  overallDelta: number;
  categories: { key: string; label: string; before: number | null; after: number | null; delta: number | null }[];
  fixed: DiffIssue[];
  added: DiffIssue[];
  unchangedCount: number;
}

export async function fetchHistory(url: string): Promise<HistoryRun[]> {
  if (!useRealBackend()) return [];
  try {
    const res = await fetch(new URL(`/api/history?url=${encodeURIComponent(url)}`, streamBase()).toString());
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function fetchDiff(a: string, b: string): Promise<DiffResult | null> {
  if (!useRealBackend()) return null;
  try {
    const res = await fetch(new URL(`/api/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`, streamBase()).toString());
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Prepare an audit with credentials: POST the options to the server, which stashes
 * them behind a one-time token. The credentials never touch the SSE URL / history.
 */
export async function prepareAudit(opts: {
  url: string;
  limit?: number;
  checkExternal?: boolean;
  allowLocal?: boolean;
  deep?: boolean;
  auth?: { cookie?: string; headers?: Record<string, string> };
}): Promise<string | null> {
  if (!useRealBackend()) return null;
  try {
    const res = await fetch(new URL("/api/audit/prepare", streamBase()).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j.token === "string" ? j.token : null;
  } catch {
    return null;
  }
}

/** Server feature flags. In mock mode there is no server → deep is unavailable. */
export async function fetchCapabilities(): Promise<{ deep: boolean }> {
  if (!useRealBackend()) return { deep: false };
  try {
    const res = await fetch(new URL("/api/capabilities", streamBase()).toString());
    if (!res.ok) return { deep: false };
    const j = await res.json();
    return { deep: !!j.deep };
  } catch {
    return { deep: false };
  }
}
